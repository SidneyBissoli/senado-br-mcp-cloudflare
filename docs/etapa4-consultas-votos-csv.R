# ETAPA 4 - Check C for consultas_votos: live CSV vs dataset aggregates
# Companion to etapa4-extract.R (Check A). Worksheet: etapa4-validacao-proveniencia.md
#
# Downloads the official Senado CSV once, then verifies:
#   (1) vintage stamp on line 1 (freshness note only, NOT a pass/fail)
#   (2) actual column names (guardrail before filtering)
#   (3) SIM/NAO sums + distinct-UF counts for the 3 sampled materias
#   (4) per-UF breakdown for 135228 (small enough to eyeball)
#
# Expected (dataset 1.0.0, referencePeriod 2026-06-28, already A-checked vs D1):
#   135228 PL 726/2019  -> sim 9         nao 0         total 9         ufs 4
#   122990 PEC 119/2015 -> sim 1         nao 50        total 51        ufs 11
#   132598 SUG 9/2018   -> sim 1.768.436 nao 1.477.955 total 3.246.391 ufs 29
#   135228 per UF: CE 1/0, MG 1/0, RJ 2/0, SP 5/0
#
# Result 03/07/2026 (stamp "Dados atualizados até 02/07/2026"): ALL MATCH.
# Frozen 2026-06-28 vintage stable in the live CSV, as predicted.

library(tidyverse)

url <- "https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv"

# --- Download once to a temp file (single vintage for stamp + data) ---
csv_path <- tempfile(fileext = ".csv")
download.file(url, csv_path, mode = "wb", quiet = TRUE)
cat("Downloaded:", file.size(csv_path) / 1e6, "MB\n")

# --- (1) Vintage stamp: line 1 carries "Dados atualizados ate DD/MM/AAAA" ---
# A stamp NEWER than 28/06/2026 is EXPECTED (daily republication); only the
# data rows must match the frozen 2026-06-28 vintage.
stamp <- read_lines(csv_path, n_max = 1,
                    locale = locale(encoding = "windows-1252"))
cat("Stamp line:", stamp, "\n")

# --- Read data: header is line 2, so skip = 1 ---
# num_threads: let vroom parallelize the parse (33 MB file)
raw <- read_delim(csv_path, delim = ";", skip = 1,
                  locale = locale(encoding = "windows-1252"),
                  col_types = cols(.default = col_character()),
                  num_threads = parallel::detectCores())

# --- (2) Guardrail: confirm the columns we are about to use exist ---
print(names(raw))
stopifnot(all(c("CÓD. MATÉRIA", "VOTO SIM", "VOTO NÃO", "UF DO CIDADÃO")
              %in% names(raw)))

# --- (3) Aggregate the 3 sampled materias ---
# BR number format: "." = grouping mark, "," = decimal mark
# (both must be set: readr errors if grouping_mark == decimal_mark)
br <- locale(grouping_mark = ".", decimal_mark = ",")

# Empty vote cells encode ZERO (proven 03/07/2026: only numbers and empty
# cells occur verbatim in the vote columns, and the CSV's own TOTAL column
# closes exactly with sim + nao under NA-as-zero, for all 3 ids) -> coalesce
alvo <- raw |>
  filter(`CÓD. MATÉRIA` %in% c("135228", "122990", "132598")) |>
  mutate(across(c(`VOTO SIM`, `VOTO NÃO`, TOTAL),
                ~ coalesce(parse_number(.x, locale = br), 0)))

alvo |>
  group_by(`CÓD. MATÉRIA`) |>
  summarise(votosSim   = sum(`VOTO SIM`),
            votosNao   = sum(`VOTO NÃO`),
            totalVotos = votosSim + votosNao,
            total_csv  = sum(TOTAL),   # witness: must equal totalVotos
            n_ufs      = n_distinct(`UF DO CIDADÃO`),
            .groups = "drop") |>
  print()

# --- (4) Per-UF detail for 135228 (expected: CE 1/0, MG 1/0, RJ 2/0, SP 5/0) ---
alvo |>
  filter(`CÓD. MATÉRIA` == "135228") |>
  select(`UF DO CIDADÃO`, `VOTO SIM`, `VOTO NÃO`) |>
  arrange(`UF DO CIDADÃO`) |>
  print(n = Inf)

# --- Check 2: accent integrity in the NDJSON (win-1252 -> UTF-8 transcode) ---
nd_path <- "../dataset/1.0.0/consultas_votos.ndjson"
nd <- read_lines(nd_path)   # readr::read_lines assumes UTF-8 (correct here)
cat(length(nd), "lines\n")

# Extract the 3 sampled records (line 1 is the envelope; the filter skips it)
alvo_nd <- nd[str_detect(nd, '"entityId":\\s*(135228|122990|132598)\\b')]
length(alvo_nd)   # expect exactly 3

# Byte-level sanity: every line must be valid UTF-8
validUTF8(alvo_nd)   # expect TRUE TRUE TRUE

# Visual: pull autoria and the first ~120 chars of ementa, verbatim
str_extract(alvo_nd, '"autoria"\\s*:\\s*"[^"]*"')
str_extract(alvo_nd, '"ementa"\\s*:\\s*"[^"]{0,120}')

# Mojibake signature: 'Ã' followed by a second accent byte only occurs in
# double-encoded text, never in legitimate Portuguese (avoids the 'SÃO'
# uppercase false positive)
tibble(
  rego_ok  = str_detect(alvo_nd, fixed("Rêgo")),
  mojibake = str_detect(alvo_nd, "Ã[©ªã£§µ¢­]")
  )

# Corrected: field values sit inside a provenance envelope -> "field":{"value":"..."
tibble(
  entityId = str_extract(alvo_nd, '(?<="entityId":)\\d+'),
  autoria  = str_extract(alvo_nd, '(?<="autoria":\\{"value":")[^"]*'),
  ementa   = str_extract(alvo_nd, '(?<="ementa":\\{"value":")[^"]{0,140}')
  ) |> 
  print(width = Inf)











