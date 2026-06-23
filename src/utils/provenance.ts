/**
 * Vetor A — Proveniência nível 1 no payload (piloto).
 *
 * Envelope de proveniência POR RESPOSTA (não por datapoint): em quase todo o portfólio
 * uma tool = uma fonte, então um único envelope carrega a mesma informação a uma fração
 * do custo de tokens. Proveniência por datapoint só se justifica quando a tool cruza
 * fontes — o que não ocorre neste servidor.
 *
 * Estratégia (guia §1.5): `structuredContent.provenance` validado pelo outputSchema
 * (espinha estruturada/auditável) + uma linha de fonte compacta anexada ao `content`
 * textual para clientes que só renderizam texto.
 *
 * NÍVEL 1 = source + dataset_id + reference_period (vintage) + retrieved_at + attribution
 * (+ license). O campo que separa nível 1 de nível 2 é `retrieved_at`: o instante da
 * extração no upstream.
 *
 * CAVEAT de fidelidade do `retrieved_at` (gancho p/ Vetor B): hoje `cachedFetch` guarda
 * só o dado, sem o instante da busca. Quando a resposta vem do cache (L0/L1), o default
 * `new Date()` aqui reflete o momento DESTA chamada, não o da ida ao upstream. O seam para
 * corrigir já existe: `buildProvenance` aceita `retrieved_at` explícito — basta a camada de
 * cache passar o timestamp real persistido junto ao dado. Até lá, o default é honesto para
 * respostas live (miss) e uma aproximação para hits.
 */

import { z } from "zod";

/** Envelope de proveniência nível 1 (guia §1.3). Exportado p/ compor outputSchema por tool. */
export const ProvenanceSchema = z.object({
  source: z.string().min(1).describe('Nome da fonte oficial (ex.: "Senado Federal — Dados Abertos")'),
  source_url: z.string().min(1).describe("URL canônica do endpoint/fonte oficial consultado"),
  dataset_id: z.string().optional().describe("Identificador do conjunto (código da matéria, da sessão, série, tabela)"),
  reference_period: z.string().optional().describe('Vintage/competência do dado (ex.: "2024", "2024-03-15")'),
  retrieved_at: z.string().min(1).describe("ISO-8601 do momento da extração no upstream (não do build/deploy)"),
  attribution: z.string().min(1).describe("String de citação pronta para uso"),
  license: z.string().optional().describe("Licença/termos da fonte"),
  api_version: z.string().optional().describe("Versão do endpoint upstream, se exposta"),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

/** Metadados estáticos por fonte upstream. source_url é montado por chamada (endpoint real). */
export const SOURCES = {
  /** API legislativa — legis.senado.leg.br/dadosabertos (votações, processos, matérias…). */
  SENADO_LEGIS: {
    source: "Senado Federal — Dados Abertos (Legislativo)",
    attribution:
      "Fonte: Senado Federal, Portal de Dados Abertos (Legislativo) — legis.senado.leg.br/dadosabertos.",
    license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
  },
  /** API administrativa — adm.senado.gov.br/adm-dadosabertos (CEAPS, folha, contratos…). */
  SENADO_ADM: {
    source: "Senado Federal — Dados Abertos (Administrativo)",
    attribution:
      "Fonte: Senado Federal, Portal de Dados Abertos (Administrativo) — adm.senado.gov.br/adm-dadosabertos.",
    license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
  },
  /** Portal e-Cidadania — www12.senado.leg.br/ecidadania. */
  ECIDADANIA: {
    source: "Senado Federal — Portal e-Cidadania",
    attribution: "Fonte: Senado Federal, Portal e-Cidadania — www12.senado.leg.br/ecidadania.",
    license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
  },
  /** Feed de execução orçamentária/financeira — www.senado.gov.br/bi-arqs/Arquimedes/Financeiro. */
  SENADO_ORCAMENTO_EXEC: {
    source: "Senado Federal — Execução Orçamentária e Financeira",
    attribution:
      "Fonte: Senado Federal — Dados Abertos Orçamentários (Arquimedes/Financeiro) — senado.gov.br.",
    license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
  },
} as const;

type SourceKey = keyof typeof SOURCES;

/**
 * Monta um envelope de proveniência validado. `retrieved_at` faz default para o instante
 * atual (ISO-8601) quando não informado — ver CAVEAT no topo do arquivo sobre cache.
 */
export function buildProvenance(input: {
  source: string;
  source_url: string;
  attribution: string;
  dataset_id?: string;
  reference_period?: string;
  retrieved_at?: string;
  license?: string;
  api_version?: string;
}): Provenance {
  return ProvenanceSchema.parse({
    ...input,
    retrieved_at: input.retrieved_at ?? new Date().toISOString(),
  });
}

/**
 * Atalho para fontes conhecidas: preenche source/attribution/license do registry e monta
 * `source_url` como `${baseUrl}${path}`. Passe `dataset_id`/`reference_period` quando houver.
 */
export function provenanceFor(
  key: SourceKey,
  baseUrl: string,
  path: string,
  extra?: {
    dataset_id?: string;
    reference_period?: string;
    retrieved_at?: string;
    api_version?: string;
  },
): Provenance {
  const meta = SOURCES[key];
  return buildProvenance({
    source: meta.source,
    attribution: meta.attribution,
    license: meta.license,
    source_url: `${baseUrl.replace(/\/$/, "")}${path}`,
    ...extra,
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
  extra?: {
    dataset_id?: string;
    reference_period?: string;
    retrieved_at?: string;
  },
): Provenance {
  const meta = SOURCES.ECIDADANIA;
  const source_url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `${ECIDADANIA_BASE_URL}${pathOrUrl}`;
  return buildProvenance({
    source: meta.source,
    attribution: meta.attribution,
    license: meta.license,
    source_url,
    ...extra,
  });
}

/** Linha de fonte compacta (Opção 1) anexada ao texto para clientes que só renderizam texto. */
export function provenanceFooter(p: Provenance): string {
  const parts = [`Fonte: ${p.source}`, p.source_url, `extraído em ${p.retrieved_at}`];
  if (p.reference_period) parts.push(`competência ${p.reference_period}`);
  return `---\n${parts.join(" · ")}`;
}

/**
 * Variante de `toolResult` que injeta o envelope de proveniência, separando os dois canais
 * (guia §1.5) para não duplicar a proveniência no que o modelo lê:
 *  - `structuredContent` = `{ ...data, provenance }` — canal parseável/validável (Opção 2);
 *  - bloco de texto = `JSON(data)` (SEM provenance) + a linha de fonte compacta (Opção 1).
 *
 * A medição de Δ tokens (scripts/measure-provenance-tokens.ts, gate §1.7) mostrou que embutir
 * a proveniência também no texto JSON custava ~3.8× mais por resposta sem benefício: clientes
 * estruturados já leem `structuredContent`, e os text-only já têm o rodapé compacto.
 * `data` deve ser um objeto (structuredContent precisa ser objeto).
 */
export function resultWithProvenance(data: Record<string, unknown>, provenance: Provenance) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
      { type: "text" as const, text: provenanceFooter(provenance) },
    ],
    structuredContent: { ...data, provenance },
  };
}
