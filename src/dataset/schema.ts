/**
 * Dataset de participação do e-Cidadania — ESQUEMA HARMONIZADO (Fase 1.2, sessão C1).
 *
 * Este arquivo é a FONTE ÚNICA da verdade da harmonização: para cada variável canônica do dataset
 * ele declara o tipo, a descrição, e — o que dá valor científico ao produto — a PROVENIÊNCIA por campo
 * (`sourceEndpoint` + `sourceField`) e a operacionalização (como o valor foi produzido a partir da
 * fonte). O mesmo objeto alimenta (a) o envelope de proveniência por registro (`provenance.ts`) e
 * (b) o dicionário de variáveis (`dictionary.ts`) — não há um segundo lugar a manter em sincronia.
 *
 * Base factual: `docs/reconhecimento-ecidadania.md` (recon de escopo fechado, 30/06–01/07/2026) e os
 * parsers reais do repo (`scripts/ingest-ecidadania/{listing,ideias-listing,eventos-listing,csv}.ts`,
 * `src/scraper/ecidadania.ts`). Os `sourceField` apontam para o campo/seletor UPSTREAM verdadeiro —
 * NÃO para o payload já normalizado — porque a ETAPA 4 do ROADMAP valida cada `sourceField` à mão.
 *
 * CONVENÇÃO DE HONESTIDADE (`derived:`): variáveis SEM fonte upstream discreta usam o prefixo
 * `derived:` em `sourceEndpoint`, para que um auditor veja de imediato que o valor nasce do nosso
 * processo, não do Senado:
 *   - `derived:ecidadania_history` — observação do próprio corpus (ex.: `firstSeenAt`).
 *   - `derived:calculo-local`      — cálculo em código a partir de outros campos do mesmo registro
 *                                    (ex.: `totalVotos`, percentuais, `url` construída).
 * Variáveis COM fonte upstream mas transformadas (ex.: `status`, derivado de `/processo?tramitando=S`)
 * mantêm o endpoint real em `sourceEndpoint` e anotam a derivação em `sourceField`.
 */

import type { Entidade } from "../scraper/pipeline.js";
import { ECIDADANIA_ARQUIMEDES_CSV_URL, ECIDADANIA_BASE_URL } from "../utils/provenance.js";

/** Versão do esquema harmonizado. Gravada em CADA registro (load-bearing na máquina de releases, C2). */
export const DATASET_SCHEMA_VERSION = "1.0.0";

/** Licença do DADO (separada da licença de código). Mesma string do registry de proveniência. */
export const DATASET_LICENSE = "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.";

export type VariableType = "string" | "integer" | "number" | "date" | "url" | "object";

/** Contexto passado ao seletor de valor de cada variável. */
export interface HarmonizeMeta {
  /** ISO-8601 do `scraped_at` da linha do corpus que produziu o valor (instante real da extração). */
  retrievedAt: string;
  /** `MIN(scraped_at)` da entidade em `ecidadania_history` — só para entidades vivas (não votos). */
  firstSeenAt?: string | null;
  /** Carimbo "dados atualizados até" do CSV Arquimedes (vintage) — só `consultas_votos`. */
  referencePeriod?: string | null;
}

export interface SelectContext {
  payload: Record<string, unknown>;
  meta: HarmonizeMeta;
}

/** Definição de UMA variável harmonizada. Descreve o dado e sua proveniência por campo. */
export interface VariableDef {
  /** Nome canônico da variável no dataset. */
  name: string;
  type: VariableType;
  unit?: string;
  /** Descrição humana (pt-BR). */
  description: string;
  /** Endpoint/fonte upstream, ou marcador `derived:*` quando não há fonte upstream discreta. */
  sourceEndpoint: string;
  /** Campo/seletor upstream verdadeiro, ou a regra de derivação. Validado à mão na ETAPA 4. */
  sourceField: string;
  /** Como o valor foi operacionalizado a partir da fonte. */
  operationalization: string;
  /** true quando o valor é computado localmente / observado, não lido direto do upstream. */
  derived?: boolean;
  /** Caveat metodológico, quando houver (censura, fold de status, vintage único…). */
  caveat?: string;
  /** Extrai o valor do payload/meta. Default: `payload[name]`. */
  select?: (ctx: SelectContext) => unknown;
}

export interface EntitySchema {
  titulo: string;
  /** Resumo em uma linha da(s) fonte(s) da entidade (aparece no dicionário). */
  fonteResumo: string;
  variables: VariableDef[];
}

// ── Endpoints canônicos (strings de proveniência) ───────────────────────────
const EP_CONSULTAS_LISTING = `GET ${ECIDADANIA_BASE_URL}/pesquisamateria?p={N}`;
const EP_IDEIAS_LISTING = `GET ${ECIDADANIA_BASE_URL}/pesquisaideia?situacao={S}&p={N}`;
const EP_EVENTOS_LISTING = `GET ${ECIDADANIA_BASE_URL}/principalaudiencia?p={N}`;
const EP_PROCESSO_TRAMITANDO = "GET https://legis.senado.leg.br/dadosabertos/processo?sigla={SIGLA}&tramitando=S";
const EP_CSV_ARQUIMEDES = `GET ${ECIDADANIA_ARQUIMEDES_CSV_URL}`;
const EP_HISTORY = "derived:ecidadania_history";
const EP_CALC = "derived:calculo-local";

// ── consultas (corpus vivo) ─────────────────────────────────────────────────
const consultasSchema: EntitySchema = {
  titulo: "Consultas públicas (Apoie)",
  fonteResumo:
    "Listagem HTML paginada `pesquisamateria` (cobertura integral; votos no gráfico) + status derivado de `/processo?tramitando=S`.",
  variables: [
    {
      name: "materia",
      type: "string",
      description: "Identificação da matéria em consulta (ex.: \"PL 5064/2023\").",
      sourceEndpoint: EP_CONSULTAS_LISTING,
      sourceField: "div.resumo-materia > header > a (texto da âncora)",
      operationalization: "Texto da âncora do cabeçalho do bloco de resultado, com entidades HTML decodificadas.",
    },
    {
      name: "ementa",
      type: "string",
      description: "Ementa da matéria.",
      sourceEndpoint: EP_CONSULTAS_LISTING,
      sourceField: "div.resumo-materia > section > a (texto da âncora)",
      operationalization: "Texto da âncora da seção do bloco, com entidades HTML decodificadas.",
    },
    {
      name: "votosSim",
      type: "integer",
      unit: "votos",
      description: "Total de votos SIM (favoráveis) na consulta.",
      sourceEndpoint: EP_CONSULTAS_LISTING,
      sourceField: "figure.grafico-consulta-publica > header > span[1] (SIM)",
      operationalization: "Primeiro <span> do header do gráfico; número BR (ponto de milhar) via parseBrNum.",
    },
    {
      name: "votosNao",
      type: "integer",
      unit: "votos",
      description: "Total de votos NÃO (contrários) na consulta.",
      sourceEndpoint: EP_CONSULTAS_LISTING,
      sourceField: "figure.grafico-consulta-publica > header > span[2] (NÃO)",
      operationalization: "Segundo <span> do header do gráfico; número BR via parseBrNum.",
    },
    {
      name: "totalVotos",
      type: "integer",
      unit: "votos",
      description: "Soma de votosSim + votosNao.",
      sourceEndpoint: EP_CALC,
      sourceField: "votosSim + votosNao",
      operationalization: "Derivado em código: soma dos dois campos de voto do mesmo registro.",
      derived: true,
    },
    {
      name: "percentualSim",
      type: "integer",
      unit: "%",
      description: "Percentual de votos SIM sobre o total.",
      sourceEndpoint: EP_CALC,
      sourceField: "round(votosSim / totalVotos * 100)",
      operationalization: "Derivado em código; 0 quando totalVotos = 0. Math.round.",
      derived: true,
    },
    {
      name: "percentualNao",
      type: "integer",
      unit: "%",
      description: "Percentual de votos NÃO sobre o total.",
      sourceEndpoint: EP_CALC,
      sourceField: "round(votosNao / totalVotos * 100)",
      operationalization: "Derivado em código; 0 quando totalVotos = 0. Math.round.",
      derived: true,
    },
    {
      name: "status",
      type: "string",
      description: "Situação da consulta: \"aberta\" | \"encerrada\".",
      sourceEndpoint: EP_PROCESSO_TRAMITANDO,
      sourceField: "(derivado) presença de codigoMateria no conjunto tramitando=S",
      operationalization:
        "aberta ⟺ a matéria está no universo /processo?tramitando=S; senão encerrada. A derivação ocorre no MESMO run do scrape da listagem, então o retrievedAt do registro cobre também este campo.",
      derived: true,
      caveat:
        "Linger re-status: matéria que sai de tramitação vira \"encerrada\" e congela com os votos finais (nunca por mera ausência da listagem).",
    },
    {
      name: "url",
      type: "url",
      description: "URL canônica da consulta no portal.",
      sourceEndpoint: EP_CALC,
      sourceField: "visualizacaomateria?id={entityId}",
      operationalization: "Construída a partir do codigoMateria; não é lida do upstream.",
      derived: true,
    },
    {
      name: "firstSeenAt",
      type: "date",
      description: "Primeira vez que o registro foi observado no corpus (proxy prospectivo de ritmo de entrada).",
      sourceEndpoint: EP_HISTORY,
      sourceField: "MIN(scraped_at) per entity_id",
      operationalization:
        "MIN(scraped_at) sobre ecidadania_history (Recon Parte III). Observação do nosso crawler — NÃO é data upstream do Senado.",
      derived: true,
      caveat:
        "Censura à esquerda: piso 14/06/2026; baseline 16/06 (98,6% do corpus) deve ser excluído de análises de ritmo; série interpretável a partir de 22/06/2026. Resolução = cadência do crawl de corpus completo.",
      select: (ctx) => ctx.meta.firstSeenAt ?? null,
    },
  ],
};

// ── ideias (corpus vivo) ─────────────────────────────────────────────────────
const ideiasSchema: EntitySchema = {
  titulo: "Ideias legislativas",
  fonteResumo:
    "Listagem HTML paginada `pesquisaideia`, varrida por valor de `situacao` (status vem do parâmetro).",
  variables: [
    {
      name: "titulo",
      type: "string",
      description: "Título da ideia legislativa.",
      sourceEndpoint: EP_IDEIAS_LISTING,
      sourceField: "article.resumo-ideia > section > a (texto da âncora)",
      operationalization: "Texto da âncora da seção, com entidades HTML decodificadas.",
    },
    {
      name: "apoios",
      type: "integer",
      unit: "apoios",
      description: "Número de apoios recebidos pela ideia.",
      sourceEndpoint: EP_IDEIAS_LISTING,
      sourceField: "article.resumo-ideia > figure.grafico-ideia-legislativa > footer > span[1] (\"N apoios\")",
      operationalization: "Primeiro <span> do footer do figure.grafico-ideia-legislativa (\"253.804 apoios\"); número BR via parseBrNum. O span de meta (limiar) é ignorado.",
    },
    {
      name: "status",
      type: "string",
      description: "Situação da ideia: \"aberta\" | \"encerrada\" | \"convertida\".",
      sourceEndpoint: EP_IDEIAS_LISTING,
      sourceField: "(derivado) parâmetro GET situacao da listagem varrida",
      operationalization:
        "A listagem é varrida por situacao=N; o status é o mapa SITUACAO_STATUS ({5,6,8}→aberta, {7,9}→encerrada, 10→convertida) do valor usado no crawl.",
      derived: true,
    },
    {
      name: "dataPublicacao",
      type: "date",
      description: "Data limite/publicação da ideia — indisponível na listagem.",
      sourceEndpoint: EP_IDEIAS_LISTING,
      sourceField: "(ausente na listagem; só na página de detalhe)",
      operationalization: "Nulo no corpus: a listagem não carrega data; só o detalhe (visualizacaoideia) a expõe. Declarado nulo, não inferido.",
      caveat: "Sempre null no dataset harmonizado (campo detail-only fora do crawl de corpus).",
      select: () => null,
    },
    {
      name: "autor",
      type: "string",
      description: "Autor(a) da ideia — indisponível na listagem.",
      sourceEndpoint: EP_IDEIAS_LISTING,
      sourceField: "(ausente na listagem; só na página de detalhe)",
      operationalization: "Nulo no corpus pelo mesmo motivo de dataPublicacao (detail-only).",
      caveat: "Sempre null no dataset harmonizado (campo detail-only fora do crawl de corpus).",
      select: () => null,
    },
    {
      name: "url",
      type: "url",
      description: "URL canônica da ideia no portal.",
      sourceEndpoint: EP_CALC,
      sourceField: "visualizacaoideia?id={entityId}",
      operationalization: "Construída a partir do id; não lida do upstream.",
      derived: true,
    },
    {
      name: "firstSeenAt",
      type: "date",
      description: "Primeira observação do registro no corpus (proxy prospectivo de ritmo de entrada).",
      sourceEndpoint: EP_HISTORY,
      sourceField: "MIN(scraped_at) per entity_id",
      operationalization: "MIN(scraped_at) sobre ecidadania_history. Observação do crawler — NÃO é data upstream.",
      derived: true,
      caveat: "Censura à esquerda: piso 14/06/2026; baseline de ideias = 29/06/2026 (~99,9% do corpus — primeiro crawl completo da entidade) deve ser excluído de análises de ritmo; série interpretável a partir de 30/06/2026. Resolução = cadência do crawl de corpus completo.",
      select: (ctx) => ctx.meta.firstSeenAt ?? null,
    },
  ],
};

// ── eventos (corpus vivo) ────────────────────────────────────────────────────
const eventosSchema: EntitySchema = {
  titulo: "Eventos interativos (audiências)",
  fonteResumo: "Listagem HTML paginada `principalaudiencia` (status no sufixo de classe do bloco).",
  variables: [
    {
      name: "titulo",
      type: "string",
      description: "Título/descrição do evento.",
      sourceEndpoint: EP_EVENTOS_LISTING,
      sourceField: "article.resumo-audiencia .descricao > a (texto da âncora)",
      operationalization: "Texto da âncora dentro de .descricao, com entidades HTML decodificadas.",
    },
    {
      name: "data",
      type: "date",
      description: "Data do evento.",
      sourceEndpoint: EP_EVENTOS_LISTING,
      sourceField: "span.data (parte DD/MM/AA)",
      operationalization: "extractDate sobre \"DD/MM/AA | HH:MM\" → ISO YYYY-MM-DD.",
      caveat: "PROVISÓRIO (A3, ETAPA 4): data vem da listagem `principalaudiencia`, que pode divergir da página de detalhe (`visualizacaoaudiencia`). Divergência de horário observada em amostra; magnitude/fonte canônica não caracterizadas — ver estudo de reconciliação listagem×detalhe (C2).",
    },
    {
      name: "hora",
      type: "string",
      description: "Hora do evento (HH:MM).",
      sourceEndpoint: EP_EVENTOS_LISTING,
      sourceField: "span.data (parte HH:MM)",
      operationalization: "extractTime sobre a mesma célula de data.",
      caveat: "PROVISÓRIO (A3, ETAPA 4): hora vem da listagem `principalaudiencia`. Observada divergência de minutos vs. a página de detalhe (ex.: 15127 listagem 10:16 vs detalhe 10:00; 13835 10:58 vs 10:30). Fonte canônica não determinada — não use `hora` para cruzamento fino sem antes conferir o detalhe. Estudo de reconciliação na C2.",
    },
    {
      name: "comissao",
      type: "string",
      description: "Sigla da comissão promotora.",
      sourceEndpoint: EP_EVENTOS_LISTING,
      sourceField: "em.sigla (token após \"|\")",
      operationalization: "Célula \" | CCT\": mantém o token após o último \"|\".",
    },
    {
      name: "comentarios",
      type: "integer",
      unit: "comentários",
      description: "Número de comentários no evento.",
      sourceEndpoint: EP_EVENTOS_LISTING,
      sourceField: "bloco do evento (\"N comentário(s)\"), best-effort",
      operationalization: "Regex de \"N comentário\" no bloco; 0 quando ausente na listagem.",
      caveat: "PROVISÓRIO (A3, ETAPA 4): valor lido só da listagem `principalaudiencia`, que nem sempre expõe a contagem — quando ausente, o campo recebe 0, indistinguível de zero real. Na amostra da ETAPA 4: dataset 0 vs detalhe 62/8/1 (eventos 38311/15127/13835). Frequência do 0 espúrio no corpus e fonte canônica não caracterizadas. Não use como medida de engajamento antes do estudo de reconciliação listagem×detalhe (C2).",
    },
    {
      name: "status",
      type: "string",
      description: "Situação do evento: \"agendado\" | \"encerrado\" | \"cancelado\".",
      sourceEndpoint: EP_EVENTOS_LISTING,
      sourceField: "sufixo da classe resumo-audiencia-STATUS (fallback por data)",
      operationalization:
        "mapEventoStatus: CANCELADO→cancelado; REALIZADO/ENCERRADO→encerrado; AGENDADO→agendado; sem classe → por data.",
      derived: true,
      caveat:
        "Fidelidade (Recon §4.1): o sufixo REGISTRADO (sabatina \"sem data prevista\") cai em \"agendado\" — indistinguível dos agendados genuínos. Não corrigido nesta fase (é dívida de tool, não de dataset); apenas declarado.",
    },
    {
      name: "url",
      type: "url",
      description: "URL canônica do evento no portal.",
      sourceEndpoint: EP_CALC,
      sourceField: "visualizacaoaudiencia?id={entityId}",
      operationalization: "Construída a partir do id; não lida do upstream.",
      derived: true,
    },
    {
      name: "firstSeenAt",
      type: "date",
      description: "Primeira observação do registro no corpus (proxy prospectivo de ritmo de entrada).",
      sourceEndpoint: EP_HISTORY,
      sourceField: "MIN(scraped_at) per entity_id",
      operationalization: "MIN(scraped_at) sobre ecidadania_history. Observação do crawler — NÃO é data upstream.",
      derived: true,
      caveat: "Censura à esquerda: piso 14/06/2026; baseline de eventos = 29/06/2026 (~99,5% do corpus — primeiro crawl completo pós-ruptura do container) deve ser excluído de análises de ritmo; série interpretável a partir de 30/06/2026. Resolução = cadência do crawl de corpus completo.",
      select: (ctx) => ctx.meta.firstSeenAt ?? null,
    },
  ],
};

// ── consultas_votos (acervo histórico Arquimedes) ────────────────────────────
const consultasVotosSchema: EntitySchema = {
  titulo: "Votos históricos por UF (acervo Arquimedes)",
  fonteResumo:
    "CSV Arquimedes `Proposições-com-votos.csv` (~33 MB, windows-1252). Acervo de vintage ÚNICO — não é série temporal.",
  variables: [
    {
      name: "materia",
      type: "string",
      description: "Identificação/nome da matéria.",
      sourceEndpoint: EP_CSV_ARQUIMEDES,
      sourceField: "coluna \"NOME DA MATÉRIA\"",
      operationalization: "Célula da coluna homônima; primeira linha da matéria vence (constante entre UFs).",
    },
    {
      name: "ementa",
      type: "string",
      description: "Ementa da matéria.",
      sourceEndpoint: EP_CSV_ARQUIMEDES,
      sourceField: "coluna \"EMENTA\"",
      operationalization: "Célula da coluna EMENTA (parser RFC-4180 tolerante a quebras de linha embutidas).",
    },
    {
      name: "autoria",
      type: "string",
      description: "Autoria da matéria.",
      sourceEndpoint: EP_CSV_ARQUIMEDES,
      sourceField: "coluna \"AUTORIA\"",
      operationalization: "Célula da coluna homônima.",
    },
    {
      name: "status",
      type: "string",
      description: "Status atual segundo o CSV (uniformemente \"Descontinuado\").",
      sourceEndpoint: EP_CSV_ARQUIMEDES,
      sourceField: "coluna \"STATUS ATUAL\"",
      operationalization: "Mantido verbatim; não usado como opinião atual (acervo congelado).",
      caveat: "Uniformemente \"Descontinuado\" em todo o acervo.",
    },
    {
      name: "votosSim",
      type: "integer",
      unit: "votos",
      description: "Total de votos SIM somando todas as UFs.",
      sourceEndpoint: EP_CSV_ARQUIMEDES,
      sourceField: "soma da coluna \"VOTO SIM\" nas linhas matéria×UF",
      operationalization: "Agregação: soma de VOTO SIM (parseBrNum) sobre todas as linhas da matéria.",
      derived: true,
    },
    {
      name: "votosNao",
      type: "integer",
      unit: "votos",
      description: "Total de votos NÃO somando todas as UFs.",
      sourceEndpoint: EP_CSV_ARQUIMEDES,
      sourceField: "soma da coluna \"VOTO NÃO\" nas linhas matéria×UF",
      operationalization: "Agregação: soma de VOTO NÃO (parseBrNum) sobre todas as linhas da matéria.",
      derived: true,
    },
    {
      name: "totalVotos",
      type: "integer",
      unit: "votos",
      description: "Soma de votosSim + votosNao.",
      sourceEndpoint: EP_CALC,
      sourceField: "votosSim + votosNao",
      operationalization: "Derivado em código.",
      derived: true,
    },
    {
      name: "votosPorUf",
      type: "object",
      description: "Detalhamento de votos SIM/NÃO por UF do cidadão (diferencial regional do acervo).",
      sourceEndpoint: EP_CSV_ARQUIMEDES,
      sourceField: "agregação por coluna \"UF DO CIDADÃO\" de \"VOTO SIM\"/\"VOTO NÃO\"",
      operationalization: "{ UF: { sim, nao } } com chaves de UF ordenadas (JSON determinístico).",
      derived: true,
    },
    {
      name: "url",
      type: "url",
      description: "URL canônica da matéria no portal.",
      sourceEndpoint: EP_CALC,
      sourceField: "visualizacaomateria?id={entityId}",
      operationalization: "Construída a partir do codigoMateria; não lida do upstream.",
      derived: true,
    },
    {
      name: "referencePeriod",
      type: "date",
      description: "Vintage do acervo: data do carimbo \"dados atualizados até\" do CSV.",
      sourceEndpoint: EP_CSV_ARQUIMEDES,
      sourceField: "linha 1 do CSV (\"Dados atualizados até DD/MM/AAAA\")",
      operationalization: "extractDate sobre o carimbo → ISO. É o ÚNICO campo temporal do acervo.",
      caveat: "Acervo de vintage único (profundidade de série = 1): não há série temporal; este é o único carimbo de data.",
      select: (ctx) => ctx.meta.referencePeriod ?? null,
    },
  ],
};

export const ENTITY_SCHEMAS: Record<Entidade, EntitySchema> = {
  consultas: consultasSchema,
  ideias: ideiasSchema,
  eventos: eventosSchema,
  consultas_votos: consultasVotosSchema,
};

/** Resolve o valor de uma variável a partir do payload/meta (default: payload[name]). */
export function selectValue(v: VariableDef, ctx: SelectContext): unknown {
  if (v.select) return v.select(ctx);
  const val = ctx.payload[v.name];
  return val === undefined ? null : val;
}
