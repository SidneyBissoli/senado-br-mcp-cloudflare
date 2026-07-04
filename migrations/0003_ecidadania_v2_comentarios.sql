-- Migration 0003 — e-Cidadania v2: nível-comentário de audiências + cursor de backfill de detalhe.
--
-- Contexto: enriquecimento por detalhe (ROADMAP CIENTÍFICO ETAPA 5.5 / schema v2). A ingestão passa
-- de só-listagem para listagem + detalhe (+ AJAX de comentários em eventos). Duas estruturas novas:
--
--   1. ecidadania_comentarios — NÍVEL-COMENTÁRIO das audiências (1 linha por comentário). NÃO cabe no
--      modelo (entidade, entity_id) de ecidadania_current (1 evento → N comentários), por isso tabela
--      dedicada. Fonte = fragmento AJAX ajaxcolecaocomentarioaudiencia. VOLÁTIL (comentários acumulam)
--      → re-crawl por ciclo; upsert idempotente por (evento_id, comentario_id), content_hash detecta
--      mudança. PRIVACIDADE: guarda UF + texto + timestamp; NÃO há coluna de nome — o nome do
--      comentarista é descartado na origem (parser), nunca gravado.
--
--   2. ecidadania_detalhe_cursor — progresso do backfill RESUMÍVEL de detalhe por entidade. O crawl de
--      detalhe de ideias (~113,7k) excede o teto de tempo de uma Action; o cursor persiste o último
--      entity_id processado para retomar na próxima execução (varre em faixas de id, dá a volta ao
--      chegar ao fim). Eventos/consultas cabem por ciclo, mas usam o mesmo mecanismo para resiliência.

CREATE TABLE IF NOT EXISTS ecidadania_comentarios (
  evento_id           INTEGER NOT NULL,   -- FK lógica para ecidadania_current(entidade='eventos', entity_id)
  comentario_id       INTEGER NOT NULL,   -- data-id estável do bloco de comentário
  scraped_at          TEXT    NOT NULL,   -- ISO 8601 UTC do fetch que produziu esta linha
  content_hash        TEXT    NOT NULL,   -- hash do payload normalizado (detecção de mudança)
  uf                  TEXT,               -- UF do comentarista (só a sigla; SEM nome, por design)
  texto               TEXT    NOT NULL,   -- texto do comentário (verbatim)
  data                TEXT,               -- data do comentário (ISO)
  hora                TEXT,               -- hora do comentário (HH:MM)
  momento_video_url   TEXT,               -- momento do vídeo ancorado ao comentário, quando houver
  convidado_associado TEXT,               -- convidado (público) associado ao momento, quando houver
  PRIMARY KEY (evento_id, comentario_id)
);
CREATE INDEX IF NOT EXISTS idx_comentarios_evento ON ecidadania_comentarios (evento_id);

CREATE TABLE IF NOT EXISTS ecidadania_detalhe_cursor (
  entidade       TEXT    PRIMARY KEY,     -- 'ideias' | 'eventos' | 'consultas'
  last_entity_id INTEGER NOT NULL DEFAULT 0, -- maior entity_id já enriquecido nesta passada
  full_passes    INTEGER NOT NULL DEFAULT 0, -- nº de passadas completas concluídas (volta ao início)
  updated_at     TEXT    NOT NULL
);
