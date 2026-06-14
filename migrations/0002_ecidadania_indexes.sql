-- Migration 0002 — indexes on ecidadania_current denormalized filter/sort columns.
--
-- `metrica_principal` semantics by entidade (documented here as the single source of truth):
--   consultas -> total_votos   (votosSim + votosNao)
--   ideias    -> apoios
--   eventos   -> comentarios
--
-- (entidade, entity_id) is already the PRIMARY KEY, so entidade-prefixed lookups are covered;
-- these add cheap filter/sort paths for the list tools without JSON extraction.

CREATE INDEX IF NOT EXISTS idx_current_status   ON ecidadania_current (entidade, status);
CREATE INDEX IF NOT EXISTS idx_current_metrica  ON ecidadania_current (entidade, metrica_principal);
CREATE INDEX IF NOT EXISTS idx_current_comissao ON ecidadania_current (entidade, comissao);
