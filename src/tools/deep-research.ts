/**
 * Group U — Deep Research (2 tools)
 * search, fetch — o contrato Deep Research da OpenAI sobre o acervo do servidor.
 * ChatGPT deep research, company knowledge e os workflows de pesquisa da API
 * Responses exigem EXATAMENTE essas duas tools, com esses nomes — a única
 * exceção admitida ao prefixo `senado_`.
 *
 * Desenho "coletor + shim `host.tool`": a fábrica de `@sbissoli/mcp-search` é
 * apontada para um coletor que só colhe `description` e `callback`; o registro
 * de verdade passa pelo shim de `createServer` como o dos outros 20 grupos —
 * e ganha de graça o filtro de perfil, o título de `tool-titles.ts`, as
 * annotations somente-leitura, o `outputSchema` permissivo único (o gate de
 * `tests/output-contract.test.ts` exige um só; o contrato do ChatGPT lê o JSON
 * do `content`, não exige outputSchema tipado) e o `instrumentTool`. Por isso
 * a fábrica NÃO recebe `record` (a telemetria é do shim) nem
 * `extendOutputSchema` (o outputSchema é do shim).
 *
 * O acervo: senadores em exercício (`/senador/lista/atual`, id `sen:<codigo>`)
 * e colegiados ativos (`/comissao/lista/colegiados`, id `com:<codigo>`) —
 * as duas listas fechadas que a API publica inteiras. Matérias ficam de fora:
 * não há dump (só busca por query/ano). A `url` é a página PÚBLICA humana,
 * nunca a API — é o que o ChatGPT cita: perfil do senador em www25 e a página
 * da comissão em legis.senado.leg.br/comissoes (padrão verificado ao vivo em
 * 03/09/2026: CAE=38, CCJ=34, CCAI=449 respondem 200; código inexistente 404).
 *
 * O índice vive neste módulo com TTL de 24 h (o L0 do cache, `src/cache/`, tem
 * TTL máximo de 600 s e 500 entradas — não serve para um índice); é construído
 * no primeiro `search` e chamadas concorrentes compartilham a construção.
 * `fetch` reusa as leituras reais de `senado_obter_senador` e
 * `senado_obter_comissao` (`fetchSenadorDetalhe`/`fetchComissaoColegiado`),
 * com o mesmo cache e a mesma proveniência — que viaja em `structuredContent`
 * e `_meta` (`provenanceExtras`), sem rodapé no texto.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import {
  DEEP_RESEARCH_TOOLS,
  contractSchemas,
  createIndex,
  registerDeepResearchTools,
  type DeepResearchToolName,
  type FetchReply,
  type IndexEntry,
  type SearchIndex,
  type SearchReply,
} from "@sbissoli/mcp-search";

import type { SenadoToolHost } from "../tool-host.js";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { ensureArray } from "../utils/validation.js";
import { provenanceExtras, provenanceFor, type Provenance } from "../utils/provenance.js";
import { CACHE_SEMI_STATIC } from "../types.js";
import { extractParlamentares, fetchSenadorDetalhe, parseSenadorResumo } from "./senadores.js";
import { fetchComissaoColegiado, parseComissaoItem, parseComissaoResumo } from "./comissoes.js";
import { UFS } from "./referencia.js";

export { DEEP_RESEARCH_TOOLS };

/** Teto de resultados do `search` (o contrato pede uma lista curta e relevante). */
export const DEEP_RESEARCH_LIMIT = 10;

const PREFIXO_SENADOR = "sen:";
const PREFIXO_COMISSAO = "com:";

const PATH_SENADORES = "/senador/lista/atual";
const PATH_COLEGIADOS = "/comissao/lista/colegiados";

/** Página pública do perfil do senador (confirmada nas fixtures de contrato e ao vivo). */
export const urlPerfilSenador = (codigo: number): string =>
  `https://www25.senado.leg.br/web/senadores/senador/-/perfil/${codigo}`;

/** Página pública da comissão (verificada ao vivo em 03/09/2026 — ver cabeçalho). */
export const urlPaginaComissao = (codigo: number): string =>
  `https://legis.senado.leg.br/comissoes/comissao?codcol=${codigo}`;

// ==================== ÍNDICE ====================

type SenadorResumo = ReturnType<typeof parseSenadorResumo>;
type ComissaoItem = ReturnType<typeof parseComissaoItem>;

interface IndiceCarregado {
  index: SearchIndex;
  /** Proveniência das duas listas — a do `search`. */
  provenance: Provenance[];
  criadoEm: number;
}

/** O índice muda com posse, licença e criação de colegiado — nada que um dia não absorva. */
const INDICE_TTL_MS = 24 * 60 * 60 * 1000;

/** Título de exibição de um senador: nome parlamentar e a bancada. */
export function tituloSenador(s: { nome: string; partido: string | null; uf: string }): string {
  const bancada = [s.partido, s.uf].filter(Boolean).join("/");
  return bancada ? `${s.nome} (${bancada})` : s.nome;
}

/** Título de exibição de uma comissão: sigla e nome. */
export function tituloComissao(c: { sigla: string; nome: string }): string {
  return c.sigla ? `${c.sigla} — ${c.nome}` : c.nome;
}

// "senadora do mato grosso do sul" tem de achar quem é de MS: a sigla sozinha
// não casa com o nome do estado, então o nome entra nas keywords.
const NOME_UF = new Map(UFS.map((uf) => [uf.sigla, uf.nome]));

export function entradasSenadores(senadores: readonly SenadorResumo[]): IndexEntry[] {
  return senadores
    .filter((s) => s.codigo > 0)
    .map((s) => ({
      id: `${PREFIXO_SENADOR}${s.codigo}`,
      title: tituloSenador(s),
      url: urlPerfilSenador(s.codigo),
      keywords: [s.nomeCompleto, s.partido ?? "", s.uf, NOME_UF.get(s.uf) ?? "", "senador", "senadora", "parlamentar"].filter(Boolean),
      text: `Senador(a) ${s.nomeCompleto} — ${s.partido ?? "sem partido"}/${s.uf} (${NOME_UF.get(s.uf) ?? "UF n/d"}), em exercício no Senado Federal.`,
    }));
}

export function entradasComissoes(comissoes: readonly ComissaoItem[]): IndexEntry[] {
  return comissoes
    .filter((c) => c.codigo > 0)
    .map((c) => ({
      id: `${PREFIXO_COMISSAO}${c.codigo}`,
      title: tituloComissao(c),
      url: urlPaginaComissao(c.codigo),
      keywords: [c.sigla, c.tipo ?? "", c.casa ?? "", "comissão", "colegiado"].filter(Boolean),
      text: `${c.nome} — ${c.tipo ?? "colegiado"} (${c.casa === "CN" ? "Congresso Nacional" : "Senado Federal"}).`,
    }));
}

// Por baseUrl: os testes e o stdio podem apontar para outra base, e o índice de
// uma não pode servir a outra.
const indices = new Map<string, IndiceCarregado>();
const carregando = new Map<string, Promise<IndiceCarregado>>();

async function construirIndice(baseUrl: string): Promise<IndiceCarregado> {
  // As mesmas chaves de cache de `senado_listar_senadores`/`senado_listar_comissoes`:
  // quem já listou pelo tool aquece o índice, e vice-versa.
  const [sen, com] = await Promise.all([
    cachedFetchWithMeta("senado_listar_senadores", { path: PATH_SENADORES }, CACHE_SEMI_STATIC, () =>
      upstreamFetch(PATH_SENADORES, {}, baseUrl),
    ),
    cachedFetchWithMeta("senado_listar_comissoes", {}, CACHE_SEMI_STATIC, () =>
      upstreamFetch(PATH_COLEGIADOS, {}, baseUrl),
    ),
  ]);
  const senadores = extractParlamentares(sen.value).map(parseSenadorResumo);
  const comissoes = ensureArray((com.value as any)?.ListaColegiados?.Colegiados?.Colegiado).map(parseComissaoItem);
  return {
    index: createIndex([...entradasSenadores(senadores), ...entradasComissoes(comissoes)]),
    provenance: [
      provenanceFor("SENADO_LEGIS", baseUrl, PATH_SENADORES, { dataset_id: "lista/atual", retrieved_at: sen.fetchedAt }),
      provenanceFor("SENADO_LEGIS", baseUrl, PATH_COLEGIADOS, { retrieved_at: com.fetchedAt }),
    ],
    criadoEm: Date.now(),
  };
}

/**
 * O índice da base, construído no primeiro uso e mantido por `INDICE_TTL_MS`.
 * Chamadas concorrentes compartilham a construção; falha não fica em cache.
 */
export async function obterIndice(baseUrl: string): Promise<IndiceCarregado> {
  const atual = indices.get(baseUrl);
  if (atual && Date.now() - atual.criadoEm < INDICE_TTL_MS) return atual;
  let promessa = carregando.get(baseUrl);
  if (!promessa) {
    promessa = construirIndice(baseUrl)
      .then((indice) => {
        indices.set(baseUrl, indice);
        return indice;
      })
      .finally(() => carregando.delete(baseUrl));
    carregando.set(baseUrl, promessa);
  }
  return promessa;
}

/** Só para testes: esquece os índices construídos. */
export function limparIndices(): void {
  indices.clear();
  carregando.clear();
}

// ==================== DOCUMENTOS ====================

type SenadorDetalhe = Awaited<ReturnType<typeof fetchSenadorDetalhe>>["detalhe"];

const linha = (rotulo: string, valor: unknown): string | null =>
  valor === null || valor === undefined || valor === "" ? null : `- **${rotulo}:** ${String(valor)}`;

export function renderizarSenador(d: SenadorDetalhe): string {
  const tratamento = d.sexo === "Feminino" ? "Senadora" : "Senador";
  const cabecalho = [
    `# ${tratamento} ${d.nome}`,
    "",
    linha("Nome completo", d.nomeCompleto),
    linha("Nome civil", d.nomeCivil),
    linha("Partido/UF", [d.partido, d.uf].filter(Boolean).join("/")),
    linha("Nascimento", d.dataNascimento),
    linha("Naturalidade", [d.naturalidade, d.ufNaturalidade].filter(Boolean).join("/")),
    linha("E-mail", d.email),
  ].filter((l): l is string => l !== null);
  const mandatos = d.mandatos.length
    ? [
        "",
        "## Mandatos",
        ...d.mandatos.map(
          (m) =>
            `- ${m.legislatura ? `${m.legislatura}ª legislatura` : "legislatura n/d"} — ${m.uf ?? ""} ${m.participacao ?? ""}`.trimEnd() +
            (m.dataInicio ? ` (${m.dataInicio}${m.dataFim ? ` a ${m.dataFim}` : ""})` : ""),
        ),
      ]
    : [];
  return [...cabecalho, ...mandatos, "", `Fonte: Senado Federal — Dados Abertos. Perfil público: ${urlPerfilSenador(d.codigo)}`].join("\n");
}

type ComissaoResumo = ReturnType<typeof parseComissaoResumo>;

export function renderizarComissao(r: ComissaoResumo): string {
  const presidente = r.presidente as { nome?: string; bancada?: string | null } | null;
  const vice = r.vicePresidente as { nome?: string; bancada?: string | null } | null;
  const pessoa = (p: typeof presidente) => (p?.nome ? `${p.nome}${p.bancada ? ` (${p.bancada})` : ""}` : null);
  return [
    `# ${tituloComissao({ sigla: String(r.sigla ?? ""), nome: String(r.nome ?? "") })}`,
    "",
    linha("Tipo", r.tipo),
    linha("Finalidade", r.finalidade),
    linha("Presidência", pessoa(presidente)),
    linha("Vice-presidência", pessoa(vice)),
    linha("Membros", r.totalMembros ? `${r.totalMembros} (${r.titulares ?? "?"} titulares, ${r.suplentes ?? "?"} suplentes)` : null),
    r.aviso ? `\n> ${String(r.aviso)}` : null,
    "",
    `Fonte: Senado Federal — Dados Abertos. Página pública: ${urlPaginaComissao(Number(r.codigo))}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

// ==================== HANDLERS ====================

function handlers(baseUrl: string) {
  async function search(query: string): Promise<SearchReply> {
    const indice = await obterIndice(baseUrl);
    const results = indice.index.search(query, { limit: DEEP_RESEARCH_LIMIT }).map(({ id, title, url }) => ({ id, title, url }));
    return { results, extras: provenanceExtras(indice.provenance) };
  }

  async function fetch(id: string): Promise<FetchReply | null> {
    if (id.startsWith(PREFIXO_SENADOR)) {
      const codigo = Number.parseInt(id.slice(PREFIXO_SENADOR.length), 10);
      if (!Number.isInteger(codigo) || codigo <= 0) return null;
      const { path, fetchedAt, detalhe } = await fetchSenadorDetalhe(codigo, baseUrl);
      if (!detalhe.codigo) return null;
      const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
        dataset_id: `codigoParlamentar=${codigo}`,
        retrieved_at: fetchedAt,
      });
      return {
        document: {
          id,
          title: tituloSenador(detalhe),
          text: renderizarSenador(detalhe),
          url: urlPerfilSenador(codigo),
          metadata: {
            tipo: "senador",
            codigo,
            partido: detalhe.partido,
            uf: detalhe.uf,
            mandatos: detalhe.mandatos.length,
          },
        },
        extras: provenanceExtras(prov),
      };
    }
    if (id.startsWith(PREFIXO_COMISSAO)) {
      const codigo = Number.parseInt(id.slice(PREFIXO_COMISSAO.length), 10);
      if (!Number.isInteger(codigo) || codigo <= 0) return null;
      const { path, fetchedAt, colegiado } = await fetchComissaoColegiado(codigo, baseUrl);
      if (!colegiado) return null;
      const resumo = parseComissaoResumo(colegiado, String(colegiado.SiglaColegiado ?? ""), "resumo");
      const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
        dataset_id: `comissao=${resumo.sigla}; codigo=${codigo}`,
        retrieved_at: fetchedAt,
      });
      return {
        document: {
          id,
          title: tituloComissao({ sigla: String(resumo.sigla ?? ""), nome: String(resumo.nome ?? "") }),
          text: renderizarComissao(resumo),
          url: urlPaginaComissao(codigo),
          metadata: {
            tipo: "comissao",
            codigo,
            sigla: resumo.sigla,
            tipoColegiado: resumo.tipo,
          },
        },
        extras: provenanceExtras(prov),
      };
    }
    return null;
  }

  return { search, fetch };
}

// ==================== REGISTRO ====================

interface RegistroCapturado {
  name: string;
  config: { title?: string; description: string };
  callback: (...args: unknown[]) => unknown;
}

/**
 * Aponta a fábrica do pacote para um coletor e devolve o que ela registrou —
 * só `description` e `callback` interessam: título, annotations, outputSchema,
 * perfil e telemetria são do shim.
 */
export function capturarDeepResearchTools(baseUrl: string): Record<DeepResearchToolName, RegistroCapturado> {
  const capturados: RegistroCapturado[] = [];
  const coletor = {
    registerTool: (name: string, config: RegistroCapturado["config"], callback: RegistroCapturado["callback"]) => {
      capturados.push({ name, config, callback });
    },
  };
  registerDeepResearchTools(coletor as unknown as McpServer, {
    ...handlers(baseUrl),
    corpus:
      "Brazilian Federal Senate open data (senators in office and active committees of the Senate and the National Congress)",
    richTools: "the `senado_*` tools",
    limit: DEEP_RESEARCH_LIMIT,
  });
  const porNome = (name: DeepResearchToolName): RegistroCapturado => {
    const reg = capturados.find((c) => c.name === name);
    if (!reg) throw new Error(`fábrica do mcp-search não registrou "${name}"`);
    return reg;
  };
  return { search: porNome("search"), fetch: porNome("fetch") };
}

export function registerDeepResearchToolsSenado(server: SenadoToolHost, baseUrl: string) {
  const { searchInputSchema, fetchInputSchema } = contractSchemas();
  const capturados = capturarDeepResearchTools(baseUrl);

  // U1. search
  server.tool("search", capturados.search.config.description, searchInputSchema.shape, capturados.search.callback);

  // U2. fetch
  server.tool("fetch", capturados.fetch.config.description, fetchInputSchema.shape, capturados.fetch.callback);
}
