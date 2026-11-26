import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createServer } from "../../src/server.js";
import {
  COLS_CONSULTA, COLS_EVENTO, COLS_IDEIA, acervoDaC3, cortar, ideiaInteiraDaC3, metaDaC3, paginaDeIdeiasDaC3, pontosDeApoios, pontosDeVotos,
  proposicoesComOrdem, situacoesNoTempo, votosPorUfDaC3,
} from "../../src/scraper/camada3.js";
import { PROJETADAS } from "../../scripts/publicacao/projecao.js";
import { juntarDetalhe, precisaDoDetalheAoVivo } from "../../src/tools/ecidadania.js";
import type { IdeiaDetalhe } from "../../src/scraper/ideia-detalhe.js";
import { bancoC3, d1De, GERADO_EM, linhasDeExemplo } from "./camada3-fixture.js";
import { COLS_AUTOR, COLS_VINCULO, materiasOficiaisDaC3 } from "../../src/scraper/vinculos-c3.js";

const AGORA = new Date("2026-11-22T18:00:00Z");
const DIAS10 = 14400;

describe("camada 3 — colunas lidas pelo servidor existem na projeção", () => {
  it.each([
    ["ideias/ideias", COLS_IDEIA],
    ["consultas/consultas", COLS_CONSULTA],
    ["eventos/eventos", COLS_EVENTO],
    ["vinculos/materias", COLS_VINCULO],
    ["vinculos/autores", COLS_AUTOR],
  ])("%s", (caminho, cols) => {
    const projetadas = PROJETADAS.find((t) => t.caminho === caminho)!.colunas.map((c) => c.nome);
    expect(cols.split(", ").filter((c) => !projetadas.includes(c))).toEqual([]);
  });
});

describe("camada 3 — séries e mapeamentos puros", () => {
  it("apoios: um ponto por mudança, juntando as origens; o igual estende o `ate`", () => {
    const p = pontosDeApoios([
      { entity_id: "1", origem: "listagem-s5", apoios: 10, desde: "2026-11-01", ate: "2026-11-03", leituras: 3 },
      { entity_id: "1", origem: "corpus", apoios: 5, desde: "2026-06-14", ate: "2026-06-14", leituras: 1 },
      { entity_id: "1", origem: "detalhe", apoios: 10, desde: "2026-11-02", ate: "2026-11-05", leituras: 1 },
      { entity_id: "1", origem: "listagem-s5", apoios: 12, desde: "2026-11-06", ate: "2026-11-07", leituras: 2 },
    ]);
    expect(p).toEqual([
      { apoios: 5, desde: "2026-06-14", ate: "2026-06-14", origem: "corpus" },
      { apoios: 10, desde: "2026-11-01", ate: "2026-11-05", origem: "listagem-s5" },
      { apoios: 12, desde: "2026-11-06", ate: "2026-11-07", origem: "listagem-s5" },
    ]);
  });

  it("votos: pares SIM/NÃO; o mesmo instante vira um ponto só", () => {
    const p = pontosDeVotos([
      { id: 1, voto: "NAO", votos: 3, desde: "a", ate: "a", leituras: 1, origem: "corpus" },
      { id: 1, voto: "SIM", votos: 7, desde: "a", ate: "a", leituras: 1, origem: "corpus" },
      { id: 1, voto: "SIM", votos: 7, desde: "b", ate: "c", leituras: 2, origem: "listagem" },
      { id: 1, voto: "NAO", votos: 4, desde: "c", ate: "c", leituras: 1, origem: "listagem" },
    ]);
    expect(p).toEqual([
      { em: "a", votosSim: 7, votosNao: 3, origem: "corpus" },
      { em: "c", votosSim: 7, votosNao: 4, origem: "listagem" },
    ]);
  });

  it("situação: portal e corpus separados; corpus só nas mudanças", () => {
    const s = situacoesNoTempo([
      { entity_id: "1", origem: "corpus", situacao_codigo: null, situacao_nome: null, status: "aberta", desde: "1", ate: "1", leituras: 1 },
      { entity_id: "1", origem: "corpus", situacao_codigo: null, situacao_nome: null, status: "aberta", desde: "2", ate: "2", leituras: 1 },
      { entity_id: "1", origem: "listagem", situacao_codigo: "5", situacao_nome: "Abertas", status: null, desde: "3", ate: "4", leituras: 2 },
    ]);
    expect(s.corpus).toEqual([{ status: "aberta", desde: "1" }]);
    expect(s.portal).toEqual([{ codigo: "5", nome: "Abertas", desde: "3", ate: "4" }]);
  });

  it("teto: corta os mais antigos e avisa onde está a série inteira", () => {
    const c = cortar([1, 2, 3, 4], 2, "apoios", "ideias/serie-apoios");
    expect(c.pontos).toEqual([3, 4]);
    expect(c.aviso).toMatch(/4 pontos de mudança; mostrando os 2 mais recentes .*ideias\/serie-apoios/);
    expect(cortar([1], 2, "x", "y").aviso).toBeNull();
  });

  it("proposições ganham a posição da linha do tempo; contagem diferente = null, sem chute", () => {
    const props = [
      { id: 1, data: "2021", transformadaPor: "Comissão", sexo: null, parlamentar: null, parlamentarUf: null, tipoSigla: "PL", tipoNome: "PL", numero: "1", ano: 2021, complemento: null, url: null, origem: "arquivo" },
      { id: 1, data: "2022", transformadaPor: "Senador", sexo: "masculino", parlamentar: "F", parlamentarUf: "MG", tipoSigla: "PEC", tipoNome: "PEC", numero: "2", ano: 2022, complemento: null, url: null, origem: "arquivo" },
    ];
    const linha = [
      { id: 1, ordem: 0, data: "2022", tipo: "adocao", texto: "" },
      { id: 1, ordem: 3, data: "2021", tipo: "cdhTransformou", texto: "" },
    ];
    const r = proposicoesComOrdem(props, linha);
    expect(r.map((p) => [p.tipoSigla, p.ordem, p.numero])).toEqual([["PEC", 0, 2], ["PL", 3, 1]]);
    expect(proposicoesComOrdem(props, linha.slice(0, 1)).map((p) => p.ordem)).toEqual([null, null]);
  });

  it("votos por UF: a versão mais recente de cada matéria × UF", () => {
    const m = votosPorUfDaC3([
      { codigo: 1, uf: "SP", sim: 1, nao: 1, desde: "a", ate: "a" },
      { codigo: 1, uf: "SP", sim: 2, nao: 2, desde: "b", ate: "b" },
      { codigo: 1, uf: "AC", sim: 9, nao: 0, desde: "b", ate: "b" },
    ]);
    expect(m.get(1)).toEqual({ AC: { sim: 9, nao: 0 }, SP: { sim: 2, nao: 2 } });
  });
});

describe("camada 3 — detalhe ao vivo para a ideia que o arquivo ainda não leu", () => {
  const daCopia = { titulo: "T", descricao: "do corpus", apoios: 5, linhaDoTempo: [], autorNome: null } as unknown as IdeiaDetalhe;
  const aoVivo = { titulo: "T vivo", descricao: "da página", apoios: 9, linhaDoTempo: [{ ordem: 0 }], autorNome: "ANA" } as unknown as IdeiaDetalhe;
  const linha = { titulo: "T", apoios: 5, origemResumo: "listagem", coletadoEmResumo: "r", origemDetalhe: "corpus", coletadoEmDetalhe: "c" };

  it("só quando o detalhe não vem do arquivo", () => {
    expect(precisaDoDetalheAoVivo({ origemDetalhe: "arquivo" })).toBe(false);
    expect(precisaDoDetalheAoVivo({ origemDetalhe: "corpus" })).toBe(true);
    expect(precisaDoDetalheAoVivo({ origemDetalhe: null })).toBe(true);
  });

  it("título e apoios da cópia; o resto da página; origem ao-vivo com o instante da leitura", () => {
    const j = juntarDetalhe(daCopia, linha, aoVivo, "2026-11-22T20:00:00.000Z");
    expect([j.detalhe.titulo, j.detalhe.apoios, j.detalhe.descricao, j.detalhe.autorNome]).toEqual(["T", 5, "da página", "ANA"]);
    expect(j.detalhe.linhaDoTempo).toHaveLength(1);
    expect(j.origens).toEqual({ origemResumo: "listagem", coletadoEmResumo: "r", origemDetalhe: "ao-vivo", coletadoEmDetalhe: "2026-11-22T20:00:00.000Z" });
  });

  it("sem leitura ao vivo (portal fora), fica a cópia", () => {
    const j = juntarDetalhe(daCopia, linha, null, null);
    expect(j.detalhe).toBe(daCopia);
    expect(j.origens.origemDetalhe).toBe("corpus");
  });
});

describe("camada 3 — leitura no D1 (SQLite com o SQL da projeção)", () => {
  it("vínculos: sem as tabelas (ou sem D1), null — a ferramenta responde sem o campo", async () => {
    const { ["vinculos/materias"]: _m, ["vinculos/autores"]: _a, ...sem } = linhasDeExemplo();
    expect(await materiasOficiaisDaC3(d1De(bancoC3(sem)), "consultas", 5000)).toBeNull();
    expect(await materiasOficiaisDaC3(undefined, "consultas", 5000)).toBeNull();
    expect(await materiasOficiaisDaC3(d1De(bancoC3(linhasDeExemplo())), "consultas", 5000)).toHaveLength(1);
  });

  it("sem as tabelas, devolve null (o chamador cai no corpus)", async () => {
    const vazio = d1De(bancoC3({}));
    expect(await metaDaC3(vazio, ["c3_ideias"], DIAS10, AGORA)).toBeNull();
    expect(await paginaDeIdeiasDaC3(vazio, DIAS10, { limite: 5, offset: 0 })).toBeNull();
    expect(await metaDaC3(undefined, ["c3_ideias"], DIAS10, AGORA)).toBeNull();
  });

  it("meta: instante da geração; velha além do limite", async () => {
    const db = d1De(bancoC3(linhasDeExemplo()));
    expect(await metaDaC3(db, ["c3_ideias"], DIAS10, AGORA)).toEqual({ fonte: "camada3", lastScrapedAt: GERADO_EM, possivelDesatualizacao: false });
    expect((await metaDaC3(db, ["c3_ideias"], 10, AGORA))?.possivelDesatualizacao).toBe(true);
  });

  it("página de ideias: ordena no banco e junta a ideia do corpus que ainda não entrou, com origem", async () => {
    const db = d1De(bancoC3(linhasDeExemplo(), [
      { entidade: "ideias", id: 999, scrapedAt: "2026-11-22T11:00:00.000Z", payload: { id: 999, titulo: "Nova", apoios: 50, status: "aberta", url: "u" } },
      { entidade: "ideias", id: 100, scrapedAt: "2026-11-22T11:00:00.000Z", payload: { id: 100, titulo: "já na camada 3", apoios: 1, status: "aberta", url: "u" } },
    ]));
    const r = (await paginaDeIdeiasDaC3(db, DIAS10, { ordenarPorApoios: "desc", limite: 3, offset: 0 }))!;
    expect(r.items.map((i) => [i.id, i.apoios])).toEqual([[100, 25000], [999, 50], [200, 40]]);
    expect(r.meta.itensDoCorpus).toBe(1);
    const nova = r.items.find((i) => i.id === 999)!;
    expect([nova.origemResumo, nova.coletadoEmResumo]).toEqual(["corpus", "2026-11-22T11:00:00.000Z"]);
    const c = r.items.find((i) => i.id === 100)!;
    expect(c.plConvertido).toBe("SUG 12/2020");
    expect(c.proposicoes?.map((p) => [p.tipoSigla, p.ordem])).toEqual([["PEC", 0], ["PL", 1]]);
    // A do corpus (detalhe do corpus) traz a lista do corpus — aqui, sem proposições.
    expect(r.items.find((i) => i.id === 200)!.proposicoes).toEqual([]);
    const abertas = (await paginaDeIdeiasDaC3(db, DIAS10, { status: "aberta", limite: 10, offset: 0 }))!;
    expect(abertas.items.map((i) => i.id)).toEqual([999, 200]);
  });

  it("ideia inteira: campos do leitor reconstruídos da linha do tempo", async () => {
    const db = d1De(bancoC3(linhasDeExemplo()));
    const r = (await ideiaInteiraDaC3(db, 100, DIAS10))!;
    expect(r.detalhe.meta).toBe(20000);
    expect(r.detalhe.dataMeta).toBe("2020-03-01");
    expect(r.detalhe.sugestao).toEqual({ numero: 12, ano: 2020, data: "2020-04-01", url: null });
    expect(r.detalhe.decisaoCdh).toEqual({ data: "2021-01-01", resultado: "transformou", sugestao: { numero: 12, ano: 2020 } });
    expect(r.detalhe.linhaDoTempo[0]).toMatchObject({ ordem: 0, ativo: true, tipo: "adocao" });
    expect(r.detalhe.avisos).toEqual(['acontecimento não reconhecido no item 4 (2020-02-01): "Algo novo no portal"']);
    expect(await ideiaInteiraDaC3(db, 12345, DIAS10)).toBeNull();
  });

  it("acervo: votos só da UF pedida para ordenar; a página é completada com o mapa inteiro", async () => {
    const db = d1De(bancoC3(linhasDeExemplo()));
    const r = (await acervoDaC3(db, DIAS10, "SP"))!;
    expect(r.items.find((i) => i.id === 77)!.votosPorUf).toEqual({ SP: { sim: 10, nao: 2 } });
    expect(r.items.find((i) => i.id === 78)!.votosPorUf).toEqual({});
    const [cheia] = await r.completar(r.items.filter((i) => i.id === 77));
    expect(cheia.votosPorUf).toEqual({ RJ: { sim: 5, nao: 3 }, SP: { sim: 10, nao: 2 } });
  });
});

describe("camada 3 — as ferramentas leem a cópia (servidor real, transporte em memória)", () => {
  let client: Client;
  const chamar = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    return r.structuredContent as Record<string, any>;
  };

  beforeAll(async () => {
    const db = d1De(bancoC3(linhasDeExemplo()));
    const server = createServer({ ECIDADANIA_DB: db } as never);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "d3", version: "0.0.0" });
    await Promise.all([server.connect(st), client.connect(ct)]);
  });
  afterAll(async () => {
    await client.close();
  });

  it("obter_ideia: dataset + séries + origens, sem ir ao portal", async () => {
    const r = await chamar("senado_ecidadania_obter_ideia", { id: 100 });
    expect(r).toMatchObject({ id: 100, apoios: 25000, status: "convertida", dataProposta: "2020-01-02" });
    // Texto de cidadão sai marcado, como no caminho ao vivo (tagUntrustedFields).
    expect(r.titulo).toBe("«texto-enviado-por-cidadao: Ideia convertida »");
    expect(r.autor).toContain("ANA B. (SP)");
    expect([r.origemDetalhe, r.coletadoEmDetalhe]).toEqual(["arquivo", "2026-11-20T09:00:00.000Z"]);
    expect(r.serieApoios.map((p: any) => p.apoios)).toEqual([24000, 25000]);
    expect(r.situacaoNoTempo.corpus.map((p: any) => p.status)).toEqual(["aberta", "convertida"]);
    expect(r.situacaoNoTempo.portal[0].codigo).toBe("10");
    // O bloco mais antigo (a proveniência escreve o instante com o fuso de Brasília).
    expect(new Date(r.provenance.retrieved_at).toISOString()).toBe("2026-11-20T09:00:00.000Z");
  });

  it("obter_consulta: série de votos em pares e percentual da camada 3", async () => {
    const r = await chamar("senado_ecidadania_obter_consulta", { id: 5000 });
    expect(r).toMatchObject({ id: 5000, votosSim: 70, percentualSim: 70, autor: "Senador X", comentarios: null });
    expect(r.serieVotos).toEqual([
      { em: "2026-06-14T00:00:00.000Z", votosSim: 60, votosNao: 30, origem: "corpus" },
      { em: "2026-11-20T00:00:00.000Z", votosSim: 70, votosNao: 30, origem: "listagem" },
    ]);
  });

  it("obter_consulta: matéria oficial com as duas autorias, cada uma com o papel (E1.d)", async () => {
    const r = await chamar("senado_ecidadania_obter_consulta", { id: 5000 });
    expect(r.materiasOficiais).toEqual([{
      casa: "SF", codigo: 5000, identificacao: "PL 5905/2026 (Substitutivo-CD)", metodo: "id-da-consulta", linkPublicado: null, situacao: "lida",
      processos: [9133965], resumoAutoria: "Câmara dos Deputados", conferidoEm: "2026-11-25T19:38:20.000Z",
      fonte: "https://legis.senado.leg.br/dadosabertos/processo?codigoMateria=5000",
      autores: [
        { papel: "iniciativa", posicao: 1, autor: "Marcelo Crivella", tipo: "SENADOR", codigoParlamentar: 3366, idDeputado: null, uf: "RJ", siglaPartido: "REPUBLICANOS" },
        { papel: "texto", posicao: 1, autor: "Câmara dos Deputados", tipo: "CAMARA", codigoParlamentar: null, idDeputado: null, uf: null, siglaPartido: null },
      ],
    }]);
    // A leitura oficial vira sub-fonte com a URL da API; o bloco soma a nota do vínculo à dos percentuais.
    const fs = r.provenance.field_sources as Array<{ fields: string[]; source_url: string }>;
    expect(fs.find((f) => f.fields.includes("materiasOficiais"))?.source_url).toBe("https://legis.senado.leg.br/dadosabertos/processo?codigoMateria=5000");
    expect(fs.some((f) => f.fields.includes("votosSim"))).toBe(true);
    expect(r.provenance.derived).toBe(true);
    expect(r.provenance.derivation_note).toMatch(/Percentuais[\s\S]*nunca por nome/);
  });

  it("vínculos: item sem vínculo dá lista vazia; ideia com proposição ainda não lida dá pendente sem autores", async () => {
    expect((await chamar("senado_ecidadania_obter_consulta", { id: 4000 })).materiasOficiais).toEqual([]);
    const r = await chamar("senado_ecidadania_obter_ideia", { id: 100 });
    expect(r.materiasOficiais).toEqual([expect.objectContaining({
      casa: "CD", codigo: 2295936, situacao: "pendente", autores: [], conferidoEm: null,
      fonte: "https://dadosabertos.camara.leg.br/api/v2/proposicoes/2295936/autores",
    })]);
    // Sem leitura oficial, nada de sub-fonte nova: o instante do topo não muda.
    expect(new Date(r.provenance.retrieved_at).toISOString()).toBe("2026-11-20T09:00:00.000Z");
  });

  it("obter_evento: pauta na ordem da página e contagem canônica", async () => {
    const r = await chamar("senado_ecidadania_obter_evento", { id: 900 });
    expect(r).toMatchObject({ id: 900, comentarios: 12, pauta: ["Primeiro item", "Segundo item"], convidados: ["Fulana, Ministra"], origemComentarios: "arquivo" });
  });

  it("listas: consultas, ideias, eventos e acervo com origens; meta diz camada3", async () => {
    const c = await chamar("senado_ecidadania_listar_consultas", { status: "todas" });
    expect(c.meta.fonte).toBe("camada3");
    expect(c.consultas.map((x: any) => x.id)).toEqual([5000, 4000]);
    const i = await chamar("senado_ecidadania_listar_ideias", { ordenarPor: "apoios", limite: 2 });
    expect(i.ideias.map((x: any) => x.id)).toEqual([100, 200]);
    expect(i.ideias[0].dataCriacaoEstimada).toBe("2020-01-02");
    const e = await chamar("senado_ecidadania_listar_eventos");
    expect(e.eventos[0]).toMatchObject({ id: 900, origemResumo: "listagem" });
    const v = await chamar("senado_ecidadania_consultas_votos", { uf: "SP" });
    expect(v.consultas.map((x: any) => x.id)).toEqual([77]);
    expect(v.consultas[0].recorteUf).toEqual({ uf: "SP", votosSim: 10, votosNao: 2, totalVotos: 12 });
    expect(Object.keys(v.consultas[0].votosPorUf)).toEqual(["RJ", "SP"]);
  });

  it("sugerir_tema_enquete: ideias contadas no banco", async () => {
    const r = await chamar("senado_ecidadania_sugerir_tema_enquete", { criterios: { minimoParticipacao: 30, apenasEmTramitacao: false, evitarConsenso: false, evitarPolarizacao: false } });
    expect(r.totalAnalisados).toBe(2 + 3);
    expect(r.totalQualificados).toBe(1 + 2);
    expect(r.sugestoes.map((s: any) => [s.tipo, s.id])).toEqual([["ideia", 100], ["consulta", 5000], ["ideia", 200]]);
  });
});
