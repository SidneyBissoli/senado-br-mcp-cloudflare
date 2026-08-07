/**
 * Vetor A — Proveniência no payload, contrato v1.0 do portfólio.
 *
 * pt-BR adapter over `@sbissoli/mcp-provenance`: o modelo canônico, os modos
 * (`concise`/`detailed`), o determinismo de serialização, o fuso e o rodapé vivem no
 * pacote (contrato v1.0 — ver `docs/contrato-proveniencia-v1.md` lá); este módulo mantém
 * a API interna que as 20 tools consomem (`provenanceFor`, `resultWithProvenance`,
 * `withFieldSources`…), aceitando os nomes de entrada históricos do senado
 * (`dataset_id`, `reference_period`) e mapeando-os ao canônico (`dataset.id`,
 * `data_vintage`).
 *
 * O QUE O v1.0 MUDOU NA RESPOSTA (release 3.5.0 — ver README/CHANGELOG):
 *  - `structuredContent.provenance` e o espelho em `_meta` passam a ser a projeção
 *    **concise** do contrato: exatamente 6 chaves — `source`, `source_url`,
 *    `data_vintage` (ex-`reference_period`), `retrieved_at`, `citation`, `license` —
 *    com `null` explícito quando desconhecido (antes: campos opcionais omitidos).
 *  - O rodapé de texto segue a redação fixada do contrato: linha de fonte
 *    ("Fonte: … · url · dados de … · extraído em …"), linha de licença e o aviso ao
 *    leitor de que a referência completa pode ser solicitada na própria conversa.
 *  - `attribution` (RFC modelcontextprotocol#711) não muda: lista canônica de
 *    `source_url` distintas, incluindo as de `field_sources`.
 *  - O bloco canônico completo (com `dataset`, `api_version`, `field_sources`,
 *    `notices`, `derived`…) é validado server-side a cada build; a projeção `detailed`
 *    existe no contrato mas este servidor emite `concise` (decisão 5 da Fase 0).
 *
 * Três canais para o mesmo envelope (estratégia herdada deste servidor, hoje no
 * pacote): (1) `structuredContent.provenance` + `attribution` — canal parseável visível
 * ao modelo; (2) `_meta` sob chaves namespaced — out-of-band, auditoria/UI, zero tokens;
 * (3) rodapé compacto no `content` — clientes text-only. A medição de Δ tokens
 * (scripts/measure-provenance-tokens.ts, gate §1.7) segue válida: a proveniência não é
 * duplicada no JSON textual.
 *
 * FIDELIDADE do `retrieved_at`: a camada de cache (`cachedFetchWithMeta`) persiste o
 * instante real da ida ao upstream e o devolve mesmo em cache hit; todo caminho que
 * emite proveniência passa esse `retrieved_at` explícito. O default `new Date()` só
 * sobra para catálogos estáticos mantidos em código. Timestamps são serializados no
 * horário de Brasília com offset explícito (-03:00 fixo — o Brasil não adota horário
 * de verão desde 2019); o fuso do IP do requisitante não serve (conectores remotos
 * mostram o IP do backend do provedor de IA, não o da pessoa).
 */

import {
  createProvenanceContext,
  ptBR,
  toCanonicalIso,
  type CanonicalProvenance,
  type ProvenanceInput,
} from "@sbissoli/mcp-provenance";

/** Contexto único do servidor: namespace de `_meta`, idioma, fuso e modo default. */
export const provenanceContext = createProvenanceContext({
  metaNamespace: "com.sidneybissoli.senado",
  locale: "pt-BR",
  timezone: { offset: "-03:00", label: "horário de Brasília" },
  defaultMode: "concise",
});

/** Envelope canônico v1.0 (pós-validação). */
export type Provenance = CanonicalProvenance;

const BRASILIA = provenanceContext.timezone;

/**
 * Converte um instante para ISO-8601 no fuso de Brasília (ex.: "2026-07-14T21:23:45-03:00").
 * Datas puras (sem hora) e strings não-parseáveis passam inalteradas — nunca corrompe um
 * vintage "2026-06-28" nem inventa horário onde não há.
 */
export const toBrasiliaIso = (value: string | Date): string => toCanonicalIso(value, BRASILIA);

/**
 * Versão humana do `retrieved_at` (já normalizado p/ Brasília):
 * "14/07/2026 às 21:23 (horário de Brasília)"; datas puras viram "14/07/2026". Strings
 * fora do padrão passam inalteradas.
 */
export const humanizeRetrievedAt = (value: string): string =>
  ptBR.formatTimestamp(value, "horário de Brasília");

/**
 * Sub-fonte por campo, nos nomes de entrada históricos do senado (`reference_period`);
 * mapeada ao canônico (`data_vintage`) no build. Usada pelas poucas tools cuja resposta
 * funde recortes/endpoints upstream (ex.: `senado_obter_materia` secao=detalhe).
 */
export interface FieldSource {
  fields: string[];
  source_url: string;
  dataset_id?: string;
  reference_period?: string;
  retrieved_at?: string;
}

const toCanonicalFieldSource = (fs: FieldSource) => ({
  fields: fs.fields,
  source_url: fs.source_url,
  dataset_id: fs.dataset_id ?? null,
  data_vintage: fs.reference_period ?? null,
  retrieved_at: fs.retrieved_at ?? null,
});

/** Campos por chamada, nos nomes históricos do senado. */
interface ExtraInput {
  dataset_id?: string;
  reference_period?: string;
  retrieved_at?: string;
  api_version?: string;
  field_sources?: FieldSource[];
}

const extraToCanonical = (extra: ExtraInput = {}) => ({
  ...(extra.dataset_id !== undefined ? { dataset: extra.dataset_id } : {}),
  ...(extra.reference_period !== undefined ? { data_vintage: extra.reference_period } : {}),
  ...(extra.retrieved_at !== undefined ? { retrieved_at: extra.retrieved_at } : {}),
  ...(extra.api_version !== undefined ? { api_version: extra.api_version } : {}),
  ...(extra.field_sources !== undefined
    ? { field_sources: extra.field_sources.map(toCanonicalFieldSource) }
    : {}),
});

/** Metadados estáticos por fonte upstream. source_url é montado por chamada (endpoint real). */
export const SOURCES = {
  /** API legislativa — legis.senado.leg.br/dadosabertos (votações, processos, matérias…). */
  SENADO_LEGIS: {
    source: "Senado Federal — Dados Abertos (Legislativo)",
    citation:
      "Fonte: Senado Federal, Portal de Dados Abertos (Legislativo) — legis.senado.leg.br/dadosabertos.",
    license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
  },
  /** API administrativa — adm.senado.gov.br/adm-dadosabertos (CEAPS, folha, contratos…). */
  SENADO_ADM: {
    source: "Senado Federal — Dados Abertos (Administrativo)",
    citation:
      "Fonte: Senado Federal, Portal de Dados Abertos (Administrativo) — adm.senado.gov.br/adm-dadosabertos.",
    license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
  },
  /** Portal institucional — estrutura organizacional (www12.senado.leg.br/institucional/estrutura). */
  SENADO_INSTITUCIONAL: {
    source: "Senado Federal — Portal Institucional (Estrutura Organizacional)",
    citation:
      "Fonte: Senado Federal, Portal Institucional — Estrutura Organizacional (www12.senado.leg.br/institucional/estrutura).",
    license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
  },
  /** Portal e-Cidadania — www12.senado.leg.br/ecidadania. */
  ECIDADANIA: {
    source: "Senado Federal — Portal e-Cidadania",
    citation: "Fonte: Senado Federal, Portal e-Cidadania — www12.senado.leg.br/ecidadania.",
    license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
  },
  /** Feed de execução orçamentária/financeira — www.senado.gov.br/bi-arqs/Arquimedes/Financeiro. */
  SENADO_ORCAMENTO_EXEC: {
    source: "Senado Federal — Execução Orçamentária e Financeira",
    citation:
      "Fonte: Senado Federal — Dados Abertos Orçamentários (Arquimedes/Financeiro) — senado.gov.br.",
    license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
  },
  /** Acervo histórico de votos das consultas e-Cidadania — CSV Arquimedes (bi-arqs/.../ecidadania). */
  ECIDADANIA_ARQUIMEDES: {
    source: "Senado Federal — e-Cidadania (acervo histórico de votos, Arquimedes)",
    citation:
      "Fonte: Senado Federal — e-Cidadania, acervo de votos por matéria/UF (Arquimedes/DadosAbertos) — senado.gov.br.",
    license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
  },
} as const;

/** URL canônica do CSV Arquimedes de votos das consultas e-Cidadania (source_url da proveniência). */
export const ECIDADANIA_ARQUIMEDES_CSV_URL =
  "https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv";

type SourceKey = keyof typeof SOURCES;

/**
 * Monta um envelope canônico validado a partir dos nomes de entrada históricos.
 * `retrieved_at` faz default para o instante atual — só catálogos estáticos em código
 * caem no default; tudo que vem do upstream passa o `retrieved_at` real preservado pela
 * camada de cache.
 */
export function buildProvenance(input: {
  source: string;
  source_url: string;
  citation: string;
  license: string;
  dataset_id?: string;
  reference_period?: string;
  retrieved_at?: string;
  api_version?: string;
  field_sources?: FieldSource[];
}): Provenance {
  const { source, source_url, citation, license, ...extra } = input;
  return provenanceContext.build({
    source,
    source_url,
    citation,
    license,
    ...extraToCanonical(extra),
  });
}

/**
 * Atalho para fontes conhecidas: preenche source/citation/license do registry e monta
 * `source_url` como `${baseUrl}${path}`. Passe `dataset_id`/`reference_period` quando houver.
 */
export function provenanceFor(
  key: SourceKey,
  baseUrl: string,
  path: string,
  extra?: ExtraInput,
): Provenance {
  return provenanceContext.from(SOURCES[key], {
    source_url: `${baseUrl.replace(/\/$/, "")}${path}`,
    ...extraToCanonical(extra),
  });
}

/** Base canônica do portal e-Cidadania (source_url dos tools do Grupo G). */
export const ECIDADANIA_BASE_URL = "https://www12.senado.leg.br/ecidadania";

/**
 * Atalho para os tools do e-Cidadania (Grupo G). Diferente das demais fontes, o dado é lido
 * do D1 (listas) ou raspado ao vivo (detalhes); por isso o `retrieved_at` deve vir do
 * `meta.lastScrapedAt` (idade real do dado em D1) nos tools de lista, ou do `fetchedAt` do
 * cache nos tools de detalhe — passe-o explicitamente. `pathOrUrl` é o caminho do recurso no
 * portal (ex.: "/principalmateria") OU uma URL canônica completa do item (começando com "http").
 */
export function provenanceEcidadania(
  pathOrUrl: string,
  extra?: Pick<ExtraInput, "dataset_id" | "reference_period" | "retrieved_at">,
): Provenance {
  const source_url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `${ECIDADANIA_BASE_URL}${pathOrUrl}`;
  return provenanceContext.from(SOURCES.ECIDADANIA, { source_url, ...extraToCanonical(extra) });
}

/**
 * Proveniência da tool de votos históricos do e-Cidadania (entidade `consultas_votos`). O dado NÃO
 * vem do portal nem da API, e sim do CSV Arquimedes — então `source_url` é a URL do CSV (constante),
 * `reference_period` é o carimbo "dados atualizados até" do próprio arquivo (passado pela tool a
 * partir do payload) e `retrieved_at` é o `lastScrapedAt` do corpus em D1 (idade real do dado).
 */
export function provenanceArquimedesVotos(
  extra?: Pick<ExtraInput, "reference_period" | "retrieved_at">,
): Provenance {
  return provenanceContext.from(SOURCES.ECIDADANIA_ARQUIMEDES, {
    source_url: ECIDADANIA_ARQUIMEDES_CSV_URL,
    dataset: "consultas_votos",
    ...extraToCanonical(extra),
  });
}

/**
 * Anexa proveniência por-campo a um envelope (granularidade nível-campo). Use nas poucas
 * tools cuja resposta funde campos de mais de um endpoint upstream — o `source_url` de topo
 * cobre o grosso do payload e cada `FieldSource` atribui os campos específicos à sua origem.
 * O envelope é re-validado inteiro no contrato (build).
 */
export function withFieldSources(prov: Provenance, fieldSources: FieldSource[]): Provenance {
  if (fieldSources.length === 0) return prov;
  return provenanceContext.build({
    ...prov,
    field_sources: fieldSources.map(toCanonicalFieldSource),
  } as ProvenanceInput);
}

/** Rodapé de texto (contrato v1.0): fonte · url · vintage · extração, licença e aviso ao leitor. */
export const provenanceFooter = (p: Provenance | Provenance[]): string =>
  provenanceContext.footer(p);

/**
 * Chaves namespaced do espelho em `_meta` (nível de resultado). O prefixo reverse-DNS
 * (`com.sidneybissoli.senado/…`) evita colisão com o namespace reservado do MCP
 * (`modelcontextprotocol.io/`, `mcp.*`) e com o namespace `openai/…` das anotações do
 * ChatGPT App. Mantê-las estáveis — consumidores de auditoria/UI leem por estas chaves.
 */
export const PROVENANCE_META_KEY = provenanceContext.metaKeys.provenance;
export const ATTRIBUTION_META_KEY = provenanceContext.metaKeys.attribution;

/**
 * Variante de `toolResult` que injeta o envelope de proveniência nos três canais
 * (`provenanceContext.result`): `structuredContent.provenance` (projeção concise) +
 * `attribution`; espelho em `_meta` sob as chaves namespaced; e bloco de texto =
 * `JSON(data)` (SEM provenance — Δ tokens, gate §1.7) + rodapé compacto.
 * `data` deve ser um objeto (structuredContent precisa ser objeto).
 */
export const resultWithProvenance = (
  data: Record<string, unknown>,
  provenance: Provenance,
): {
  // Index signature exigida pelo tipo de retorno dos callbacks do MCP SDK.
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
} => ({ ...provenanceContext.result(data, provenance) });
