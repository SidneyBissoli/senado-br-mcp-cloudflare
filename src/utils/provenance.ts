/**
 * Vetor A — Proveniência nível 1 no payload.
 *
 * Envelope de proveniência POR RESPOSTA (não por datapoint): em quase todo o portfólio
 * uma tool = uma fonte, então um único envelope carrega a mesma informação a uma fração
 * do custo de tokens.
 *
 * GRANULARIDADE POR CAMPO (Sessão 3, tarefa 1): as poucas tools que *cruzam recortes*
 * upstream numa única resposta (ex.: `senado_obter_materia` secao=detalhe, que funde
 * `/processo/{id}` + `/processo?codigoMateria=` + `/processo/relatoria`) preenchem o campo
 * opcional `field_sources` — uma lista de sub-fontes, cada uma com os `fields` que cobre e o
 * seu próprio `source_url`/`retrieved_at`. A maioria das tools (uma fonte) o omite.
 *
 * NOMENCLATURA / FORWARD-COMPAT (Sessão 3, tarefa 2): alinhado à RFC `attribution` do MCP
 * (modelcontextprotocol#711), que define `attribution` como uma **lista** de fontes (URIs)
 * no nível da resposta. Para não colidir com isso, a citação humana legível mora em
 * `provenance.citation` (string), e `resultWithProvenance` emite, no topo do
 * `structuredContent`, a lista `attribution` canônica (todas as `source_url` distintas,
 * incluindo as de `field_sources`). Quando a RFC estabilizar, clientes que leem o
 * `attribution` de topo já encontram a fonte; o envelope `provenance` rico segue como
 * extensão deste servidor.
 *
 * Estratégia (guia §1.5): três canais para o mesmo envelope.
 *  1. `structuredContent.provenance` + `structuredContent.attribution` — canal PARSEÁVEL e
 *     visível ao modelo (para que ele cite fonte/período/retrieved_at, conforme as
 *     SERVER_INSTRUCTIONS pedem). NÃO é validado no cliente pelo outputSchema: o schema
 *     anunciado por tool é permissivo (`z.object({}).passthrough()` em server.ts), então o
 *     cliente não recebe garantia de forma sobre a proveniência. A validação é SERVER-SIDE,
 *     no build, via `ProvenanceSchema.parse` em `buildProvenance` — quem constrói um envelope
 *     inválido estoura aqui, antes de responder.
 *  2. `_meta` (nível de resultado) — MESMO envelope espelhado como metadado OUT-OF-BAND, sob
 *     chaves namespaced (ver `PROVENANCE_META_KEY`/`ATTRIBUTION_META_KEY`). É o canal
 *     recomendado pela convenção emergente do MCP para metadado *sobre* o resultado que não
 *     deve dirigir o modelo (auditoria, UI-chrome) e é forward-compat com a Extensions Track
 *     de trust/attribution annotations (RFC #711 → PR #1913, incubando fora do core).
 *  3. Linha de fonte compacta anexada ao `content` textual, para clientes que só renderizam texto.
 *
 * NÍVEL 1 = source + dataset_id + reference_period (vintage) + retrieved_at + citation
 * (+ license). O campo que separa nível 1 de nível 2 é `retrieved_at`: o instante da
 * extração no upstream.
 *
 * FIDELIDADE do `retrieved_at` (Sessão 3, tarefa 3 — RESOLVIDA): a camada de cache
 * (`cachedFetchWithMeta`) persiste o instante real da ida ao upstream junto ao dado e o
 * devolve mesmo em cache hit (L0/L1). Todo caminho que emite proveniência passa esse
 * `retrieved_at` explícito; o default `new Date()` em `buildProvenance` só sobra para
 * catálogos estáticos mantidos em código (sem extração upstream), onde não há instante
 * melhor a reportar.
 */

import { z } from "zod";

/** Sub-fonte por campo (guia §1.4 — granularidade nível-campo p/ respostas multi-fonte). */
export const FieldSourceSchema = z.object({
  fields: z.array(z.string().min(1)).min(1).describe("Campos do payload atribuídos a esta sub-fonte"),
  source_url: z.string().min(1).describe("URL canônica da sub-fonte que originou estes campos"),
  dataset_id: z.string().optional().describe("Identificador do conjunto da sub-fonte"),
  reference_period: z.string().optional().describe("Vintage/competência da sub-fonte"),
  retrieved_at: z.string().optional().describe("ISO-8601 da extração desta sub-fonte no upstream"),
});

export type FieldSource = z.infer<typeof FieldSourceSchema>;

/** Envelope de proveniência nível 1 (guia §1.3). Exportado p/ compor outputSchema por tool. */
export const ProvenanceSchema = z.object({
  source: z.string().min(1).describe('Nome da fonte oficial (ex.: "Senado Federal — Dados Abertos")'),
  source_url: z.string().min(1).describe("URL canônica do endpoint/fonte oficial consultado"),
  dataset_id: z.string().optional().describe("Identificador do conjunto (código da matéria, da sessão, série, tabela)"),
  reference_period: z.string().optional().describe('Vintage/competência do dado (ex.: "2024", "2024-03-15")'),
  retrieved_at: z.string().min(1).describe("ISO-8601 do momento da extração no upstream (não do build/deploy)"),
  citation: z.string().min(1).describe("String de citação pronta para uso (texto humano)"),
  license: z.string().optional().describe("Licença/termos da fonte"),
  api_version: z.string().optional().describe("Versão do endpoint upstream, se exposta"),
  field_sources: z
    .array(FieldSourceSchema)
    .optional()
    .describe("Proveniência por-campo: presente só quando a resposta cruza múltiplas fontes/recortes upstream (a maioria das tools usa uma única fonte e omite isto)"),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

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
 * Monta um envelope de proveniência validado. `retrieved_at` faz default para o instante
 * atual (ISO-8601) quando não informado — ver nota de FIDELIDADE no topo do arquivo: só
 * catálogos estáticos em código caem no default; tudo que vem do upstream passa o
 * `retrieved_at` real preservado pela camada de cache.
 */
export function buildProvenance(input: {
  source: string;
  source_url: string;
  citation: string;
  dataset_id?: string;
  reference_period?: string;
  retrieved_at?: string;
  license?: string;
  api_version?: string;
  field_sources?: FieldSource[];
}): Provenance {
  return ProvenanceSchema.parse({
    ...input,
    retrieved_at: input.retrieved_at ?? new Date().toISOString(),
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
  extra?: {
    dataset_id?: string;
    reference_period?: string;
    retrieved_at?: string;
    api_version?: string;
    field_sources?: FieldSource[];
  },
): Provenance {
  const meta = SOURCES[key];
  return buildProvenance({
    source: meta.source,
    citation: meta.citation,
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
    citation: meta.citation,
    license: meta.license,
    source_url,
    ...extra,
  });
}

/**
 * Proveniência da tool de votos históricos do e-Cidadania (entidade `consultas_votos`). O dado NÃO
 * vem do portal nem da API, e sim do CSV Arquimedes — então `source_url` é a URL do CSV (constante),
 * `reference_period` é o carimbo "dados atualizados até" do próprio arquivo (passado pela tool a
 * partir do payload) e `retrieved_at` é o `lastScrapedAt` do corpus em D1 (idade real do dado).
 */
export function provenanceArquimedesVotos(extra?: {
  reference_period?: string;
  retrieved_at?: string;
}): Provenance {
  const meta = SOURCES.ECIDADANIA_ARQUIMEDES;
  return buildProvenance({
    source: meta.source,
    citation: meta.citation,
    license: meta.license,
    source_url: ECIDADANIA_ARQUIMEDES_CSV_URL,
    dataset_id: "consultas_votos",
    ...extra,
  });
}

/**
 * Anexa proveniência por-campo a um envelope (granularidade nível-campo). Use nas poucas
 * tools cuja resposta funde campos de mais de um endpoint upstream — o `source_url` de topo
 * cobre o grosso do payload e cada `FieldSource` atribui os campos específicos à sua origem.
 */
export function withFieldSources(prov: Provenance, fieldSources: FieldSource[]): Provenance {
  if (fieldSources.length === 0) return prov;
  return { ...prov, field_sources: fieldSources.map((fs) => FieldSourceSchema.parse(fs)) };
}

/** Linha de fonte compacta (Opção 1) anexada ao texto para clientes que só renderizam texto. */
export function provenanceFooter(p: Provenance): string {
  const parts = [`Fonte: ${p.source}`, p.source_url, `extraído em ${p.retrieved_at}`];
  if (p.reference_period) parts.push(`competência ${p.reference_period}`);
  return `---\n${parts.join(" · ")}`;
}

/** Lista canônica de fontes (RFC #711) — todas as `source_url` distintas da resposta. */
function attributionList(p: Provenance): string[] {
  const urls = [p.source_url, ...(p.field_sources?.map((fs) => fs.source_url) ?? [])];
  return [...new Set(urls)];
}

/**
 * Chaves namespaced do espelho em `_meta` (nível de resultado). O prefixo reverse-DNS
 * (`com.sidneybissoli.senado/…`) evita colisão com o namespace reservado do MCP
 * (`modelcontextprotocol.io/`, `mcp.*`) e com o namespace `openai/…` das anotações do
 * ChatGPT App. Mantê-las estáveis — consumidores de auditoria/UI leem por estas chaves.
 */
export const PROVENANCE_META_KEY = "com.sidneybissoli.senado/provenance";
export const ATTRIBUTION_META_KEY = "com.sidneybissoli.senado/attribution";

/**
 * Variante de `toolResult` que injeta o envelope de proveniência, separando os canais
 * (guia §1.5) para não duplicar a proveniência no que o modelo lê:
 *  - `structuredContent` = `{ ...data, provenance, attribution }` — canal parseável e visível
 *    ao modelo. `attribution` é a lista canônica da RFC #711 (todas as `source_url` distintas);
 *  - `_meta` = MESMO `provenance`/`attribution` espelhado como metadado out-of-band, sob chaves
 *    namespaced (`PROVENANCE_META_KEY`/`ATTRIBUTION_META_KEY`). Sobrevive ao minimizador do
 *    perfil openai-app (que só remove `structuredContent.meta`) e não custa tokens do modelo,
 *    servindo auditoria/UI e a forward-compat com a Extensions Track de trust annotations;
 *  - bloco de texto = `JSON(data)` (SEM provenance) + a linha de fonte compacta (Opção 1).
 *
 * A medição de Δ tokens (scripts/measure-provenance-tokens.ts, gate §1.7) mostrou que embutir
 * a proveniência também no texto JSON custava ~3.8× mais por resposta sem benefício: clientes
 * estruturados já leem `structuredContent`, e os text-only já têm o rodapé compacto.
 * `data` deve ser um objeto (structuredContent precisa ser objeto).
 */
export function resultWithProvenance(data: Record<string, unknown>, provenance: Provenance) {
  const attribution = attributionList(provenance);
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
      { type: "text" as const, text: provenanceFooter(provenance) },
    ],
    structuredContent: { ...data, provenance, attribution },
    _meta: {
      [PROVENANCE_META_KEY]: provenance,
      [ATTRIBUTION_META_KEY]: attribution,
    },
  };
}
