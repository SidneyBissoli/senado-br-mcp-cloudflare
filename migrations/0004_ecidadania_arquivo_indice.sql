-- Migration 0004 — e-Cidadania fase B1: índice do arquivo bruto de páginas (30/10/2026).
--
-- As páginas ficam no balde R2 PRIVADO `ecidadania-arquivos` (gzip, chave = sha256 dos bytes
-- originais: paginas/ab/cd/<sha256>.html.gz; trava contra apagar/sobrescrever). Esta tabela registra
-- CADA leitura do portal — inclusive a que trouxe uma página já guardada (nova = 0) —, para responder
-- "todas as versões da ideia N" e "o que o portal mostrou no dia D". Só acrescenta: nenhum UPDATE ou
-- DELETE no código. Cada rodada também deixa as mesmas linhas como manifesto no balde
-- (manifestos/<job>/<rodada>/parte-NNN.jsonl.gz), para o arquivo se explicar sem o banco.

CREATE TABLE IF NOT EXISTS ecidadania_arquivo_indice (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT    NOT NULL,   -- URL pedida ao portal
  entidade    TEXT    NOT NULL,   -- 'ideias' (fase B2); consultas/eventos na B4
  entity_id   TEXT,               -- id da página de detalhe (?id=N); NULL nas listagens
  instante    TEXT    NOT NULL,   -- ISO 8601 UTC em que a resposta chegou
  status_http INTEGER NOT NULL,   -- status final (200, 404, 410, 5xx esgotado…)
  sha256      TEXT    NOT NULL,   -- sha256 dos bytes originais = chave da página no balde
  bytes       INTEGER NOT NULL,   -- tamanho original (antes do gzip)
  leitor      TEXT    NOT NULL,   -- quem baixou: '<job>@<commit>'
  rodada      TEXT    NOT NULL,   -- GITHUB_RUN_ID-attempt (ou local-<instante>)
  nova        INTEGER NOT NULL    -- 1 = página gravada nesta leitura; 0 = já estava no balde
);

CREATE INDEX IF NOT EXISTS idx_arquivo_indice_entidade_id ON ecidadania_arquivo_indice (entidade, entity_id, instante);
CREATE INDEX IF NOT EXISTS idx_arquivo_indice_sha ON ecidadania_arquivo_indice (sha256);
CREATE INDEX IF NOT EXISTS idx_arquivo_indice_rodada ON ecidadania_arquivo_indice (rodada);
