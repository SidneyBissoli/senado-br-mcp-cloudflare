-- Migration 0001 — e-Cidadania D1 schema (P2)
--
-- Persists scraped e-Cidadania data so tools read from D1 instead of scraping per call.
-- Design goals:
--   * O(1) tool reads          -> ecidadania_current (1 row per item, upserted by Cron)
--   * time-series ready        -> ecidadania_history (append-on-change; no painful future migration)
--   * rich on-demand detail    -> ecidadania_detalhe (separate table: detail payload is richer
--                                 and differently shaped than the list item)
--   * failure isolation        -> ecidadania_scrape_runs + the rule "never overwrite current
--                                 with a bad/anomalous run" (enforced in the Cron code, step 3)
--
-- `entidade` discriminates 'consultas' | 'ideias' | 'eventos' so we avoid 9 near-identical tables.
-- Timestamps are ISO 8601 UTC strings. content_hash drives change detection / dedup.

-- Latest snapshot per item — source for list/analysis tools. Upserted by the Cron (lists only).
CREATE TABLE IF NOT EXISTS ecidadania_current (
  entidade          TEXT    NOT NULL,   -- 'consultas' | 'ideias' | 'eventos'
  entity_id         INTEGER NOT NULL,   -- e-Cidadania item id
  scraped_at        TEXT    NOT NULL,   -- ISO 8601 UTC of the scrape that produced this row
  content_hash      TEXT    NOT NULL,   -- hash of the normalized payload (change detection)
  source_url        TEXT    NOT NULL,
  payload_json      TEXT    NOT NULL,   -- normalized, tool-ready object (list-level)
  -- denormalized columns for cheap filter/sort without JSON extraction:
  status            TEXT,               -- entity-specific: aberta/encerrada/agendado/...
  metrica_principal INTEGER,            -- total_votos (consultas) | apoios (ideias) | comentarios (eventos)
  comissao          TEXT,               -- sigla (eventos); NULL otherwise
  PRIMARY KEY (entidade, entity_id)
);

-- Append-on-change log — one row per (item, change). Powers future time series (deferred).
CREATE TABLE IF NOT EXISTS ecidadania_history (
  entidade     TEXT    NOT NULL,
  entity_id    INTEGER NOT NULL,
  scraped_at   TEXT    NOT NULL,
  content_hash TEXT    NOT NULL,
  payload_json TEXT    NOT NULL,
  PRIMARY KEY (entidade, entity_id, scraped_at)
);
CREATE INDEX IF NOT EXISTS idx_history_entity ON ecidadania_history (entidade, entity_id, scraped_at);

-- Rich detail payload from obter_* (HTML scrape), written through fire-and-forget, dedup by hash.
-- Separate table on purpose: the detail object is richer than the list item (pauta, convidados,
-- relator, descricao, videoUrl, ...). One row per item (current detail); detail history deferred.
CREATE TABLE IF NOT EXISTS ecidadania_detalhe (
  entidade     TEXT    NOT NULL,
  entity_id    INTEGER NOT NULL,
  scraped_at   TEXT    NOT NULL,
  content_hash TEXT    NOT NULL,
  source_url   TEXT    NOT NULL,
  payload_json TEXT    NOT NULL,
  PRIMARY KEY (entidade, entity_id)
);

-- One row per Cron scrape run per entity — failure alarm + last-good-state bookkeeping.
-- status: 'ok' (healthy) | 'anomalo' (e.g. 0 rows or rows_scraped < threshold of last good) | 'erro'.
-- On 'anomalo'/'erro' the Cron MUST NOT overwrite ecidadania_current (preserve last good state).
CREATE TABLE IF NOT EXISTS ecidadania_scrape_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at       TEXT    NOT NULL,
  entidade     TEXT    NOT NULL,
  status       TEXT    NOT NULL,
  rows_scraped INTEGER NOT NULL DEFAULT 0,
  rows_changed INTEGER NOT NULL DEFAULT 0,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_entity ON ecidadania_scrape_runs (entidade, run_at);
