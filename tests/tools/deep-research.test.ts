/**
 * `search`/`fetch` — o contrato Deep Research da OpenAI sobre senadores e comissões.
 *
 * Dois níveis: as peças puras (entradas do índice, títulos, urls, renderização
 * Markdown) e o fio inteiro — `createServer` + cliente MCP em memória, com o
 * upstream mockado por caminho. O fio é o que prova o desenho "coletor + shim":
 * as duas passam pelo shim (título de `tool-titles.ts`, annotations, o MESMO
 * outputSchema permissivo das outras 67), o `content` é exatamente o JSON do
 * contrato (sem rodapé) e a proveniência viaja em `structuredContent`/`_meta`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { DEEP_RESEARCH_TOOLS } from "@sbissoli/mcp-search";

vi.mock("../../src/throttle/upstream.js", () => ({
  upstreamFetch: vi.fn(),
}));

import { upstreamFetch } from "../../src/throttle/upstream.js";
import { createServer } from "../../src/server.js";
import {
  entradasComissoes,
  entradasSenadores,
  limparIndices,
  renderizarComissao,
  renderizarSenador,
  tituloComissao,
  tituloSenador,
  urlPaginaComissao,
  urlPerfilSenador,
} from "../../src/tools/deep-research.js";
import { parseComissaoResumo } from "../../src/tools/comissoes.js";
import { PROVENANCE_META_KEY } from "../../src/utils/provenance.js";

const LISTA_ATUAL = {
  ListaParlamentarEmExercicio: {
    Parlamentares: {
      Parlamentar: [
        {
          IdentificacaoParlamentar: {
            CodigoParlamentar: "5322",
            NomeParlamentar: "Rodrigo Pacheco",
            NomeCompletoParlamentar: "Rodrigo Otavio Soares Pacheco",
            SiglaPartidoParlamentar: "PSD",
            UfParlamentar: "MG",
          },
        },
        {
          IdentificacaoParlamentar: {
            CodigoParlamentar: "5012",
            NomeParlamentar: "Simone Tebet",
            NomeCompletoParlamentar: "Simone Nassar Tebet",
            SiglaPartidoParlamentar: "MDB",
            UfParlamentar: "MS",
          },
        },
      ],
    },
  },
};

const COLEGIADOS = {
  ListaColegiados: {
    Colegiados: {
      Colegiado: [
        { Codigo: "34", Sigla: "CCJ", Nome: "Comissão de Constituição, Justiça e Cidadania", DescricaoTipoColegiado: "Comissão Permanente", SiglaCasa: "SF" },
        { Codigo: "38", Sigla: "CAE", Nome: "Comissão de Assuntos Econômicos", DescricaoTipoColegiado: "Comissão Permanente", SiglaCasa: "SF" },
        { Codigo: "449", Sigla: "CCAI", Nome: "Comissão Mista de Controle das Atividades de Inteligência", DescricaoTipoColegiado: "Comissão Mista", SiglaCasa: "CN" },
      ],
    },
  },
};

const DETALHE_SENADOR = {
  DetalheParlamentar: {
    Parlamentar: {
      IdentificacaoParlamentar: {
        CodigoParlamentar: "5322",
        NomeParlamentar: "Rodrigo Pacheco",
        NomeCompletoParlamentar: "Rodrigo Otavio Soares Pacheco",
        SexoParlamentar: "Masculino",
        SiglaPartidoParlamentar: "PSD",
        UfParlamentar: "MG",
        EmailParlamentar: "sen.rodrigopacheco@senado.leg.br",
      },
      DadosBasicosParlamentar: { DataNascimento: "1976-11-03", Naturalidade: "Passos", UfNaturalidade: "MG" },
    },
  },
};

const MANDATOS = {
  MandatoParlamentar: {
    Parlamentar: {
      Mandatos: {
        Mandato: [
          { PrimeiraLegislaturaDoMandato: { NumeroLegislatura: "56" }, UfParlamentar: "MG", DescricaoParticipacao: "Titular", DataInicio: "2019-02-01" },
        ],
      },
    },
  },
};

const DETALHE_COMISSAO = {
  ComissoesCongressoNacional: {
    Colegiados: {
      Colegiado: {
        CodigoColegiado: "34",
        SiglaColegiado: "CCJ",
        NomeColegiado: "Comissão de Constituição, Justiça e Cidadania",
        TipoColegiado: { TipoColegiado: "Comissão Permanente" },
        Cargos: { Cargo: [{ TipoCargo: "PRESIDENTE", NomeParlamentar: "Otto Alencar", CodigoParlamentar: "4988", Bancada: "PSD/BA" }] },
        QuantidadesMembros: { Distribuicao: { Senadores: "54", SenadoresTitulares: "27", SenadoresSuplentes: "27" } },
      },
    },
  },
};

/** Upstream por caminho — o que cada rota do adapter pede. */
function mockUpstream() {
  vi.mocked(upstreamFetch).mockImplementation(async (path: string) => {
    if (path === "/senador/lista/atual") return LISTA_ATUAL;
    if (path === "/comissao/lista/colegiados") return COLEGIADOS;
    if (path === "/senador/5322") return DETALHE_SENADOR;
    if (path === "/senador/5322/mandatos") return MANDATOS;
    if (path === "/comissao/34") return DETALHE_COMISSAO;
    if (path === "/comissao/999999") return { ComissoesCongressoNacional: { Colegiados: {} } };
    throw new Error(`upstream não mockado: ${path}`);
  });
}

describe("peças puras", () => {
  it("urls canônicas são as páginas públicas, não a API", () => {
    expect(urlPerfilSenador(5322)).toBe("https://www25.senado.leg.br/web/senadores/senador/-/perfil/5322");
    expect(urlPaginaComissao(34)).toBe("https://legis.senado.leg.br/comissoes/comissao?codcol=34");
  });

  it("entradas do índice: id prefixado, título com bancada/sigla, keywords sem vazios", () => {
    const [s] = entradasSenadores([
      { codigo: 5322, nome: "Rodrigo Pacheco", nomeCompleto: "Rodrigo Otavio Soares Pacheco", partido: "PSD", uf: "MG", foto: null, emExercicio: true },
      { codigo: 0, nome: "sem código", nomeCompleto: "", partido: null, uf: "", foto: null, emExercicio: true },
    ]);
    expect(s).toMatchObject({ id: "sen:5322", title: "Rodrigo Pacheco (PSD/MG)", url: urlPerfilSenador(5322) });
    expect(s!.keywords).not.toContain("");
    expect(entradasSenadores([{ codigo: 0, nome: "x", nomeCompleto: "x", partido: null, uf: "", foto: null, emExercicio: true }])).toHaveLength(0);

    const [c] = entradasComissoes([{ codigo: 34, sigla: "CCJ", nome: "Comissão de Constituição, Justiça e Cidadania", tipo: "Comissão Permanente", casa: "SF", ativa: true }]);
    expect(c).toMatchObject({ id: "com:34", title: "CCJ — Comissão de Constituição, Justiça e Cidadania", url: urlPaginaComissao(34) });
  });

  it("títulos degradam sem bancada/sigla", () => {
    expect(tituloSenador({ nome: "Fulano", partido: null, uf: "" })).toBe("Fulano");
    expect(tituloComissao({ sigla: "", nome: "Comitê" })).toBe("Comitê");
  });

  it("renderiza o senador em Markdown com tratamento por sexo e mandatos", () => {
    const md = renderizarSenador({
      codigo: 5012, nome: "Simone Tebet", nomeCompleto: "Simone Nassar Tebet", nomeCivil: null, sexo: "Feminino",
      dataNascimento: "1970-02-22", naturalidade: "Três Lagoas", ufNaturalidade: "MS", partido: "MDB", uf: "MS",
      foto: null, email: null, emExercicio: true,
      mandatos: [{ legislatura: 56, uf: "MS", participacao: "Titular", dataInicio: "2019-02-01", dataFim: null, suplentes: [] } as never],
    });
    expect(md).toContain("# Senadora Simone Tebet");
    expect(md).toContain("- **Partido/UF:** MDB/MS");
    expect(md).toContain("## Mandatos");
    expect(md).toContain("56ª legislatura — MS Titular (2019-02-01)");
    expect(md).not.toContain("E-mail");
    expect(md).toContain(urlPerfilSenador(5012));
  });

  it("renderiza a comissão com presidência e o aviso de finalidade", () => {
    const resumo = parseComissaoResumo(DETALHE_COMISSAO.ComissoesCongressoNacional.Colegiados.Colegiado, "CCJ", "resumo");
    const md = renderizarComissao(resumo);
    expect(md).toContain("# CCJ — Comissão de Constituição, Justiça e Cidadania");
    expect(md).toContain("- **Presidência:** Otto Alencar (PSD/BA)");
    expect(md).toContain("- **Membros:** 54 (27 titulares, 27 suplentes)");
    expect(md).toContain("> A fonte só publica `finalidade`");
    expect(md).toContain(urlPaginaComissao(34));
  });
});

describe("no fio (createServer + cliente MCP)", () => {
  let client: Client;
  let tools: Awaited<ReturnType<Client["listTools"]>>["tools"];

  beforeAll(async () => {
    limparIndices();
    mockUpstream();
    const server = createServer({ CACHE_KV: {} as never } as never);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "deep-research", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    ({ tools } = await client.listTools());
  });

  afterAll(async () => {
    await client.close();
    limparIndices();
  });

  it("as duas estão registradas pelo shim: título do mapa, annotations e o outputSchema das outras", () => {
    const outra = tools.find((t) => t.name === "senado_listar_senadores")!;
    for (const name of DEEP_RESEARCH_TOOLS) {
      const t = tools.find((x) => x.name === name);
      expect(t, `${name} não anunciada`).toBeDefined();
      expect(t!.annotations).toEqual(outra.annotations && { ...outra.annotations, title: t!.title });
      expect(t!.outputSchema).toEqual(outra.outputSchema);
      expect(t!.description).toMatch(/Deep Research/);
    }
    expect(tools.find((t) => t.name === "search")!.title).toBe("Busca para Deep Research");
    expect(tools.find((t) => t.name === "fetch")!.title).toBe("Documento para Deep Research");
    expect(tools.find((t) => t.name === "search")!.inputSchema.required).toEqual(["query"]);
    expect(tools.find((t) => t.name === "fetch")!.inputSchema.required).toEqual(["id"]);
  });

  it("search: JSON do contrato no content (sem rodapé) + proveniência das duas listas em structuredContent/_meta", async () => {
    const r = (await client.callTool({ name: "search", arguments: { query: "pacheco" } })) as Record<string, any>;
    expect(r.isError).toBeFalsy();
    expect(r.content).toHaveLength(1);
    const texto = JSON.parse(r.content[0].text);
    expect(texto).toEqual({ results: [{ id: "sen:5322", title: "Rodrigo Pacheco (PSD/MG)", url: urlPerfilSenador(5322) }] });
    expect(r.structuredContent.results).toEqual(texto.results);
    expect(Array.isArray(r.structuredContent.provenance)).toBe(true);
    expect(r.structuredContent.provenance.map((p: any) => p.source_url)).toEqual([
      "https://legis.senado.leg.br/dadosabertos/senador/lista/atual",
      "https://legis.senado.leg.br/dadosabertos/comissao/lista/colegiados",
    ]);
    expect(r._meta[PROVENANCE_META_KEY]).toBeDefined();
  });

  it("search: acha comissão por sigla e por palavra do nome, sem acento", async () => {
    const porSigla = (await client.callTool({ name: "search", arguments: { query: "CCJ" } })) as Record<string, any>;
    expect(porSigla.structuredContent.results[0].id).toBe("com:34");
    const porNome = (await client.callTool({ name: "search", arguments: { query: "assuntos economicos" } })) as Record<string, any>;
    expect(porNome.structuredContent.results[0].id).toBe("com:38");
    const nada = (await client.callTool({ name: "search", arguments: { query: "zzzz" } })) as Record<string, any>;
    expect(nada.structuredContent.results).toEqual([]);
  });

  it("fetch sen: documento do senador com a proveniência de /senador/{codigo}", async () => {
    const r = (await client.callTool({ name: "fetch", arguments: { id: "sen:5322" } })) as Record<string, any>;
    expect(r.isError).toBeFalsy();
    const doc = JSON.parse(r.content[0].text);
    expect(doc).toMatchObject({ id: "sen:5322", title: "Rodrigo Pacheco (PSD/MG)", url: urlPerfilSenador(5322) });
    expect(doc.text).toContain("# Senador Rodrigo Pacheco");
    expect(doc.text).toContain("56ª legislatura");
    expect(doc.metadata).toEqual({ tipo: "senador", codigo: 5322, partido: "PSD", uf: "MG", mandatos: 1 });
    expect(r.structuredContent.provenance.source_url).toBe("https://legis.senado.leg.br/dadosabertos/senador/5322");
    expect(r.structuredContent.provenance.citation).toMatch(/Senado Federal/);
    expect(r._meta[PROVENANCE_META_KEY].source_url).toBe("https://legis.senado.leg.br/dadosabertos/senador/5322");
  });

  it("fetch com: documento da comissão com a proveniência de /comissao/{codigo}", async () => {
    const r = (await client.callTool({ name: "fetch", arguments: { id: "com:34" } })) as Record<string, any>;
    expect(r.isError).toBeFalsy();
    const doc = JSON.parse(r.content[0].text);
    expect(doc).toMatchObject({ id: "com:34", title: "CCJ — Comissão de Constituição, Justiça e Cidadania", url: urlPaginaComissao(34) });
    expect(doc.text).toContain("Otto Alencar");
    expect(doc.metadata).toEqual({ tipo: "comissao", codigo: 34, sigla: "CCJ", tipoColegiado: "Comissão Permanente" });
    expect(r.structuredContent.provenance.source_url).toBe("https://legis.senado.leg.br/dadosabertos/comissao/34");
  });

  it("fetch: id desconhecido, prefixo inválido e comissão sem detalhe respondem isError com a mensagem padrão", async () => {
    for (const id of ["xyz:1", "sen:abc", "com:999999", "sen:"]) {
      const r = (await client.callTool({ name: "fetch", arguments: { id } })) as Record<string, any>;
      expect(r.isError, id).toBe(true);
      expect(r.content[0].text).toContain(`Documento não encontrado: "${id}"`);
    }
  });
});
