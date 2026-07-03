# =============================================================================
# ETAPA 4 - Conferencia A (pipeline fiel ao corpus)
# Extracts the 19 sampled records from dataset/1.0.0/*.ndjson and prints them
# side by side with the expected values drawn from D1 on 2026-07-02.
#
# Scope: this automates ONLY check A of the worksheet
# (docs/etapa4-validacao-proveniencia.md). Checks B (live selector inspection)
# and C (live sanity + derived recomputation) remain strictly manual.
#
# Source file is ASCII-only; non-Latin-1 characters in expected data strings
# are written as \uXXXX escapes (connector encoding constraint).
#
# Usage: source("docs/etapa4-extract.R") from the repo root, or run as-is.
# =============================================================================

library(tidyverse)
library(jsonlite)

REPO <- "C:/Users/SIDNEY/OneDrive/programacao/mcp/senado-br-mcp-cloudflare"
DATASET_DIR <- file.path(REPO, "dataset", "1.0.0")

# Envelope constants (must match src/dataset/schema.ts)
EXPECTED_SCHEMA_VERSION <- "1.0.0"
EXPECTED_LICENSE <- "Dados Abertos do Senado Federal \u2014 uso livre com atribui\u00e7\u00e3o da fonte."
ENVELOPE_FIELDS <- c("value", "sourceEndpoint", "sourceField",
                     "retrievedAt", "license", "schemaVersion")

# ── Sampled entity ids ───────────────────────────────────────────────────────
SAMPLE_IDS <- list(
  consultas       = c(155307, 141006, 135228, 169214, 167850, 174759),
  ideias          = c(218615, 216031, 177199, 90152, 135228),
  eventos         = c(39710, 39349, 38311, 15127, 13835),
  consultas_votos = c(135228, 122990, 132598)
)

# ── Expected record-level retrievedAt (scraped_at of the D1 row) ─────────────
EXPECTED_RETRIEVED_AT <- tribble(
  ~entidade,         ~id,     ~retrievedAt,
  "consultas",       155307,  "2026-07-02T08:11:09.537Z",
  "consultas",       141006,  "2026-07-02T08:11:09.537Z",
  "consultas",       135228,  "2026-07-02T08:11:09.537Z",
  "consultas",       169214,  "2026-06-29T09:22:43.983Z",
  "consultas",       167850,  "2026-06-22T10:33:42.692Z",
  "consultas",       174759,  "2026-07-02T08:11:09.537Z",
  "ideias",          218615,  "2026-07-02T08:13:51.918Z",
  "ideias",          216031,  "2026-07-02T08:13:51.918Z",
  "ideias",          177199,  "2026-07-02T08:13:51.918Z",
  "ideias",          90152,   "2026-07-02T08:13:51.918Z",
  "ideias",          135228,  "2026-07-02T08:13:51.918Z",
  "eventos",         39710,   "2026-07-02T16:00:13.820Z",
  "eventos",         39349,   "2026-07-02T12:00:13.817Z",
  "eventos",         38311,   "2026-07-02T08:12:45.622Z",
  "eventos",         15127,   "2026-07-02T08:12:45.622Z",
  "eventos",         13835,   "2026-07-02T08:12:45.622Z",
  "consultas_votos", 135228,  "2026-06-29T14:10:26.338Z",
  "consultas_votos", 122990,  "2026-06-29T14:10:26.338Z",
  "consultas_votos", 132598,  "2026-06-29T14:10:26.338Z"
)

# ── Expected field values (from D1 payload_json + MIN(scraped_at)) ───────────
# NA_character_ means the value must be JSON null in the dataset.
EXPECTED_VALUES <- tribble(
  ~entidade, ~id, ~campo, ~esperado,

  # consultas 155307 (PL 4606/2019, aberta, grande)
  "consultas", 155307, "materia", "PL 4606/2019",
  "consultas", 155307, "ementa", str_c(
    "Veda qualquer altera\u00e7\u00e3o, adapta\u00e7\u00e3o, edi\u00e7\u00e3o, supress\u00e3o ou adi\u00e7\u00e3o nos textos da ",
    "B\u00edblia Sagrada, para manter a inviolabilidade de seus cap\u00edtulos e vers\u00edculos, ",
    "e garante a prega\u00e7\u00e3o do seu conte\u00fado em todo o territ\u00f3rio nacional."),
  "consultas", 155307, "votosSim", "13386",
  "consultas", 155307, "votosNao", "2103",
  "consultas", 155307, "totalVotos", "15489",
  "consultas", 155307, "percentualSim", "86",
  "consultas", 155307, "percentualNao", "14",
  "consultas", 155307, "status", "aberta",
  "consultas", 155307, "url", "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=155307",
  "consultas", 155307, "firstSeenAt", "2026-06-16T13:15:49.544Z",

  # consultas 141006 (PL 573/2020, aberta, media; rounding edge 100/0)
  "consultas", 141006, "materia", "PL 573/2020",
  "consultas", 141006, "ementa", str_c(
    "Altera a Lei n\u00ba 9.504, de 30 de setembro de 1997, para determinar a redu\u00e7\u00e3o ",
    "\u00e0 metade e a limita\u00e7\u00e3o, pelo prazo de vinte anos, do volume de recursos do ",
    "Fundo Especial de Financiamento de Campanha."),
  "consultas", 141006, "votosSim", "457",
  "consultas", 141006, "votosNao", "2",
  "consultas", 141006, "totalVotos", "459",
  "consultas", 141006, "percentualSim", "100",
  "consultas", 141006, "percentualNao", "0",
  "consultas", 141006, "status", "aberta",
  "consultas", 141006, "url", "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=141006",
  "consultas", 141006, "firstSeenAt", "2026-06-16T13:15:49.544Z",

  # consultas 135228 (PL 726/2019, aberta, pequena)
  "consultas", 135228, "materia", "PL 726/2019",
  "consultas", 135228, "ementa", str_c(
    "Institui o Programa de Gera\u00e7\u00e3o Distribu\u00edda nas Universidades e d\u00e1 outras ",
    "provid\u00eancias."),
  "consultas", 135228, "votosSim", "9",
  "consultas", 135228, "votosNao", "0",
  "consultas", 135228, "totalVotos", "9",
  "consultas", 135228, "percentualSim", "100",
  "consultas", 135228, "percentualNao", "0",
  "consultas", 135228, "status", "aberta",
  "consultas", 135228, "url", "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=135228",
  "consultas", 135228, "firstSeenAt", "2026-06-16T13:15:49.544Z",

  # consultas 169214 (PDL 453/2024, encerrada linger; totalVotos=0 edge)
  "consultas", 169214, "materia", "PDL 453/2024",
  "consultas", 169214, "ementa", str_c(
    "Aprova o ato que renova a permiss\u00e3o outorgada \u00e0 Funda\u00e7\u00e3o Antonio Barbara ",
    "para explorar servi\u00e7o de radiodifus\u00e3o sonora em frequ\u00eancia modulada no ",
    "Munic\u00edpio de Cianorte, Estado do Paran\u00e1."),
  "consultas", 169214, "votosSim", "0",
  "consultas", 169214, "votosNao", "0",
  "consultas", 169214, "totalVotos", "0",
  "consultas", 169214, "percentualSim", "0",
  "consultas", 169214, "percentualNao", "0",
  "consultas", 169214, "status", "encerrada",
  "consultas", 169214, "url", "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=169214",
  "consultas", 169214, "firstSeenAt", "2026-06-16T13:15:49.544Z",

  # consultas 167850 (PLP 73/2025, encerrada linger)
  "consultas", 167850, "materia", "PLP 73/2025",
  "consultas", 167850, "ementa", str_c(
    "Altera o art. 9\u00ba da Lei Complementar n\u00ba 101, de 4 de maio de 2000, para ",
    "ressalvar despesas das ag\u00eancias reguladoras federais da limita\u00e7\u00e3o de empenho ",
    "e movimenta\u00e7\u00e3o financeira."),
  "consultas", 167850, "votosSim", "42",
  "consultas", 167850, "votosNao", "7",
  "consultas", 167850, "totalVotos", "49",
  "consultas", 167850, "percentualSim", "86",
  "consultas", 167850, "percentualNao", "14",
  "consultas", 167850, "status", "encerrada",
  "consultas", 167850, "url", "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=167850",
  "consultas", 167850, "firstSeenAt", "2026-06-16T13:15:49.544Z",

  # consultas 174759 (PDL 618/2026, aberta, cauda pos-baseline)
  "consultas", 174759, "materia", "PDL 618/2026",
  "consultas", 174759, "ementa", str_c(
    "Aprova o texto do Protocolo de Montevid\u00e9u sobre Compromisso com a Democracia ",
    "no Mercosul (Ushuaia II), assinado em Montevid\u00e9u, em 20 de dezembro de 2011, ",
    "durante a XLII Reuni\u00e3o Ordin\u00e1ria do Conselho do Mercado Comum."),
  "consultas", 174759, "votosSim", "0",
  "consultas", 174759, "votosNao", "0",
  "consultas", 174759, "totalVotos", "0",
  "consultas", 174759, "percentualSim", "0",
  "consultas", 174759, "percentualNao", "0",
  "consultas", 174759, "status", "aberta",
  "consultas", 174759, "url", "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=174759",
  "consultas", 174759, "firstSeenAt", "2026-06-22T10:33:42.692Z",

  # ideias
  "ideias", 218615, "titulo", str_c(
    "Aumento de Pena para Produ\u00e7\u00e3o e Distribui\u00e7\u00e3o de Conte\u00fado Abusivo"),
  "ideias", 218615, "apoios", "0",
  "ideias", 218615, "status", "aberta",
  "ideias", 218615, "dataPublicacao", NA_character_,
  "ideias", 218615, "autor", NA_character_,
  "ideias", 218615, "url", "https://www12.senado.leg.br/ecidadania/visualizacaoideia?id=218615",
  "ideias", 218615, "firstSeenAt", "2026-06-29T09:25:21.812Z",

  "ideias", 216031, "titulo", str_c(
    "Escuta do acusado de viol\u00eancia dom\u00e9stica nas primeiras 48h pelo judici\u00e1rio"),
  "ideias", 216031, "apoios", "3",
  "ideias", 216031, "status", "aberta",
  "ideias", 216031, "dataPublicacao", NA_character_,
  "ideias", 216031, "autor", NA_character_,
  "ideias", 216031, "url", "https://www12.senado.leg.br/ecidadania/visualizacaoideia?id=216031",
  "ideias", 216031, "firstSeenAt", "2026-06-29T09:25:21.812Z",

  "ideias", 177199, "titulo", str_c(
    "Garantir banheiros separados por sexo de nascimento para mulheres e ",
    "crian\u00e7as do Brasil."),
  "ideias", 177199, "apoios", "21524",
  "ideias", 177199, "status", "convertida",
  "ideias", 177199, "dataPublicacao", NA_character_,
  "ideias", 177199, "autor", NA_character_,
  "ideias", 177199, "url", "https://www12.senado.leg.br/ecidadania/visualizacaoideia?id=177199",
  "ideias", 177199, "firstSeenAt", "2026-06-29T09:25:21.812Z",

  "ideias", 90152, "titulo", "Lei Rouanet",
  "ideias", 90152, "apoios", "12",
  "ideias", 90152, "status", "encerrada",
  "ideias", 90152, "dataPublicacao", NA_character_,
  "ideias", 90152, "autor", NA_character_,
  "ideias", 90152, "url", "https://www12.senado.leg.br/ecidadania/visualizacaoideia?id=90152",
  "ideias", 90152, "firstSeenAt", "2026-06-29T09:25:21.812Z",

  "ideias", 135228, "titulo", "Direitos iguais.",
  "ideias", 135228, "apoios", "1",
  "ideias", 135228, "status", "encerrada",
  "ideias", 135228, "dataPublicacao", NA_character_,
  "ideias", 135228, "autor", NA_character_,
  "ideias", 135228, "url", "https://www12.senado.leg.br/ecidadania/visualizacaoideia?id=135228",
  "ideias", 135228, "firstSeenAt", "2026-06-29T09:25:21.812Z",

  # eventos (39710 title carries curly quotes U+201C/U+201D in upstream data)
  "eventos", 39710, "titulo", str_c(
    "Impactos sociais, econ\u00f4micos e de sa\u00fade p\u00fablica das apostas esportivas ",
    "on-line (\u201cbets\u201d) no Brasil e prote\u00e7\u00e3o \u00e0 popula\u00e7\u00e3o"),
  "eventos", 39710, "data", "2026-07-02",
  "eventos", 39710, "hora", "10:00",
  "eventos", 39710, "comissao", "CDH",
  "eventos", 39710, "comentarios", "119",
  "eventos", 39710, "status", "agendado",
  "eventos", 39710, "url", "https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id=39710",
  "eventos", 39710, "firstSeenAt", "2026-06-30T20:00:13.654Z",

  "eventos", 39349, "titulo", str_c(
    "Sabatina de Pedro Marcos de Castro Saldanha, indicado para exercer o cargo ",
    "de Delegado Permanente do Brasil junto \u00e0 Organiza\u00e7\u00e3o das Na\u00e7\u00f5es Unidas para ",
    "a Educa\u00e7\u00e3o, a Ci\u00eancia e a Cultura"),
  "eventos", 39349, "data", NA_character_,
  "eventos", 39349, "hora", NA_character_,
  "eventos", 39349, "comissao", "CRE",
  "eventos", 39349, "comentarios", "16",
  "eventos", 39349, "status", "agendado",
  "eventos", 39349, "url", "https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id=39349",
  "eventos", 39349, "firstSeenAt", "2026-06-16T20:00:49.525Z",

  "eventos", 38311, "titulo", str_c(
    "Rotulagem nutricional de produtos ultraprocessados e uso de edulcorantes: ",
    "impactos na sa\u00fade p\u00fablica, obesidade, diabetes e prote\u00e7\u00e3o do consumidor"),
  "eventos", 38311, "data", "2026-05-28",
  "eventos", 38311, "hora", "09:30",
  "eventos", 38311, "comissao", "CAS",
  "eventos", 38311, "comentarios", "0",
  "eventos", 38311, "status", "cancelado",
  "eventos", 38311, "url", "https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id=38311",
  "eventos", 38311, "firstSeenAt", "2026-06-29T12:49:11.266Z",

  "eventos", 15127, "titulo", "2\u00aa Reuni\u00e3o do Conselho de Comunica\u00e7\u00e3o Social",
  "eventos", 15127, "data", "2019-03-18",
  "eventos", 15127, "hora", "10:16",
  "eventos", 15127, "comissao", "CCS",
  "eventos", 15127, "comentarios", "0",
  "eventos", 15127, "status", "encerrado",
  "eventos", 15127, "url", "https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id=15127",
  "eventos", 15127, "firstSeenAt", "2026-06-29T12:49:11.266Z",

  "eventos", 13835, "titulo", "A situa\u00e7\u00e3o ambiental dos assentamentos rurais no Brasil",
  "eventos", 13835, "data", "2018-06-26",
  "eventos", 13835, "hora", "10:58",
  "eventos", 13835, "comissao", "CMA",
  "eventos", 13835, "comentarios", "0",
  "eventos", 13835, "status", "encerrado",
  "eventos", 13835, "url", "https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id=13835",
  "eventos", 13835, "firstSeenAt", "2026-06-29T12:49:11.266Z",

  # consultas_votos (acervo; no firstSeenAt; referencePeriod = vintage stamp)
  "consultas_votos", 135228, "materia", "PL 726/2019",
  "consultas_votos", 135228, "ementa", str_c(
    "Institui o Programa de Gera\u00e7\u00e3o Distribu\u00edda nas Universidades e d\u00e1 outras ",
    "provid\u00eancias."),
  "consultas_votos", 135228, "autoria", "Veneziano Vital Do R\u00eago",
  "consultas_votos", 135228, "status", "Descontinuado",
  "consultas_votos", 135228, "votosSim", "9",
  "consultas_votos", 135228, "votosNao", "0",
  "consultas_votos", 135228, "totalVotos", "9",
  "consultas_votos", 135228, "url", "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=135228",
  "consultas_votos", 135228, "referencePeriod", "2026-06-28",

  "consultas_votos", 122990, "materia", "PEC 119/2015",
  "consultas_votos", 122990, "ementa", str_c(
    "Modifica o art. 56 da Constitui\u00e7\u00e3o Federal, para permitir que o parlamentar ",
    "se licencie para assumir temporariamente outro cargo eletivo e para que o ",
    "suplente p..."),
  "consultas_votos", 122990, "autoria", "Dalirio Beber",
  "consultas_votos", 122990, "status", "Descontinuado",
  "consultas_votos", 122990, "votosSim", "1",
  "consultas_votos", 122990, "votosNao", "50",
  "consultas_votos", 122990, "totalVotos", "51",
  "consultas_votos", 122990, "url", "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=122990",
  "consultas_votos", 122990, "referencePeriod", "2026-06-28",

  "consultas_votos", 132598, "materia", "SUG 9/2018",
  "consultas_votos", 132598, "ementa", "Voto impresso em 100% das urnas",
  "consultas_votos", 132598, "autoria", "Programa E-cidadania",
  "consultas_votos", 132598, "status", "Descontinuado",
  "consultas_votos", 132598, "votosSim", "1768436",
  "consultas_votos", 132598, "votosNao", "1477955",
  "consultas_votos", 132598, "totalVotos", "3246391",
  "consultas_votos", 132598, "url", "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=132598",
  "consultas_votos", 132598, "referencePeriod", "2026-06-28"
)

# votosPorUf aggregate expectations (n distinct UF keys + totals)
EXPECTED_VOTOS_POR_UF <- tribble(
  ~id,     ~n_ufs, ~soma_sim, ~soma_nao,
  135228,  4L,     9,         0,
  122990,  11L,    1,         50,
  132598,  29L,    1768436,   1477955
)

# Exact per-UF breakdown for the smallest record (deep check)
EXPECTED_UF_135228 <- list(
  CE = list(sim = 1, nao = 0), MG = list(sim = 1, nao = 0),
  RJ = list(sim = 2, nao = 0), SP = list(sim = 5, nao = 0)
)

# ── Extraction (chunked read: ideias.ndjson is large) ────────────────────────
extract_records <- function(path, ids) {
  pattern <- str_c('"entityId":(', str_c(ids, collapse = "|"), ')[,}]')
  hits <- character(0)
  cb <- function(lines, pos) hits <<- c(hits, lines[str_detect(lines, pattern)])
  read_lines_chunked(path, SideEffectChunkCallback$new(cb), chunk_size = 20000)
  map(hits, \(x) fromJSON(x, simplifyVector = FALSE))
}

message("Reading NDJSON files (ideias takes the longest)...")
records <- imap(SAMPLE_IDS, \(ids, entidade) {
  recs <- extract_records(file.path(DATASET_DIR, str_c(entidade, ".ndjson")), ids)
  set_names(recs, map_int(recs, \(r) r$entityId))
})

# ── Helpers ──────────────────────────────────────────────────────────────────
value_as_chr <- function(v) {
  if (is.null(v)) NA_character_ else as.character(v)
}

get_field <- function(entidade, id, campo) {
  records[[entidade]][[as.character(id)]]$fields[[campo]]
}

# ── 1) Field-by-field value comparison ───────────────────────────────────────
comparacao <- EXPECTED_VALUES |>
  mutate(
    obtido = pmap_chr(list(entidade, id, campo),
                      \(e, i, c) value_as_chr(get_field(e, i, c)$value)),
    ok = (is.na(esperado) & is.na(obtido)) |
         (!is.na(esperado) & !is.na(obtido) & esperado == obtido)
  )

# ── 2) retrievedAt: every field of a record must carry the expected timestamp ─
retrieved_check <- EXPECTED_RETRIEVED_AT |>
  mutate(
    campos_ok = pmap_int(list(entidade, id, retrievedAt), \(e, i, exp_ts) {
      fs <- records[[e]][[as.character(i)]]$fields
      sum(map_chr(fs, "retrievedAt") == exp_ts)
    }),
    campos_total = map2_int(entidade, id,
                            \(e, i) length(records[[e]][[as.character(i)]]$fields)),
    ok = campos_ok == campos_total
  )

# ── 3) Envelope shape + constants (license, schemaVersion, 6 fields in order) ─
envelope_check <- EXPECTED_RETRIEVED_AT |>
  select(entidade, id) |>
  mutate(
    ok = map2_lgl(entidade, id, \(e, i) {
      fs <- records[[e]][[as.character(i)]]$fields
      all(map_lgl(fs, \(f) {
        identical(names(f), ENVELOPE_FIELDS) &&
          f$license == EXPECTED_LICENSE &&
          f$schemaVersion == EXPECTED_SCHEMA_VERSION
      }))
    })
  )

# ── 4) consultas_votos specifics: votosPorUf aggregates + no firstSeenAt ─────
uf_check <- EXPECTED_VOTOS_POR_UF |>
  mutate(
    obtido = map(id, \(i) get_field("consultas_votos", i, "votosPorUf")$value),
    n_ufs_ok    = map2_lgl(obtido, n_ufs,    \(v, n) length(v) == n),
    soma_sim_ok = map2_lgl(obtido, soma_sim, \(v, s) sum(map_dbl(v, "sim")) == s),
    soma_nao_ok = map2_lgl(obtido, soma_nao, \(v, s) sum(map_dbl(v, "nao")) == s),
    ok = n_ufs_ok & soma_sim_ok & soma_nao_ok
  ) |>
  select(-obtido)

# JSON has no int/double distinction; jsonlite parses whole numbers as integer
# while the expected literal above uses doubles. Normalize numeric type before
# comparing; key ORDER and names remain part of the check (deterministic JSON).
canon_uf <- function(x) map(x, \(uf) map(uf, as.numeric))
uf_exact_135228 <- identical(
  canon_uf(get_field("consultas_votos", 135228, "votosPorUf")$value),
  canon_uf(EXPECTED_UF_135228)
)

sem_firstseen_votos <- all(map_lgl(
  records$consultas_votos,
  \(r) !"firstSeenAt" %in% names(r$fields)
))

# ── Report ───────────────────────────────────────────────────────────────────
options(pillar.width = Inf)

message("\n===== 1) Valores campo a campo (esperado vs obtido) =====")
print(comparacao, n = Inf)

message("\n===== 2) retrievedAt por registro (todos os campos do envelope) =====")
print(retrieved_check, n = Inf)

message("\n===== 3) Envelope (6 campos na ordem + license + schemaVersion) =====")
print(envelope_check, n = Inf)

message("\n===== 4) consultas_votos: votosPorUf (agregados) =====")
print(uf_check, n = Inf)
message(str_c("votosPorUf exato (135228, CE/MG/RJ/SP): ",
              if (uf_exact_135228) "OK" else "FALHA"))
message(str_c("consultas_votos sem firstSeenAt (acervo): ",
              if (sem_firstseen_votos) "OK" else "FALHA"))

message("\n===== VEREDITO DA CONFERENCIA A =====")
blocos <- c(
  "valores campo a campo"  = nrow(comparacao |> filter(!ok)) == 0,
  "retrievedAt"            = all(retrieved_check$ok),
  "envelope/constantes"    = all(envelope_check$ok),
  "votosPorUf agregados"   = all(uf_check$ok),
  "votosPorUf exato"       = uf_exact_135228,
  "acervo sem firstSeenAt" = sem_firstseen_votos
)
walk2(names(blocos), blocos,
      \(n, ok) message(str_c(if (ok) "OK    " else "FALHA ", n)))
if (all(blocos)) {
  message("Conferencia A APROVADA para os 19 registros.")
  message("Marque a coluna A no worksheet e siga para B e C (manuais).")
} else {
  falhas <- comparacao |> filter(!ok)
  if (nrow(falhas) > 0) print(falhas, n = Inf)
  message("Ha falhas acima: investigar antes de marcar a coluna A.")
}
