-- Migration 0005 — e-Cidadania, arquivo bruto: formato de cada página guardada (15/11/2026).
--
-- Até 15/11 toda página ia em gzip (`paginas/ab/cd/<sha256>.html.gz`). Desde então vai em zstd
-- (`paginas/ab/cd/<sha256>.zst`), com uma página de REFERÊNCIA do mesmo tipo e da mesma versão do
-- portal como dicionário (`referencias/<sha>.html.gz`, em gzip). O formato é do OBJETO, não da
-- leitura: uma linha por página gravada (nova = 1 no índice). Página sem linha aqui = gzip (formato
-- antigo). Para abrir uma `zstd+ref`: descomprimir a referência e `zstd -d -D <referência> <página>`.
-- Tabela nova, não ALTER TABLE: as migrations são reaplicadas em todo run e precisam ser idempotentes.

CREATE TABLE IF NOT EXISTS ecidadania_arquivo_pagina (
  sha256         TEXT    PRIMARY KEY,  -- sha256 dos bytes originais = chave da página no balde
  formato        TEXT    NOT NULL,     -- 'zstd' | 'zstd+ref' (o 'gzip' antigo não tem linha)
  referencia     TEXT,                 -- sha256 da página de referência (só 'zstd+ref')
  bytes_gravados INTEGER NOT NULL,     -- tamanho comprimido no balde
  gravada_em     TEXT    NOT NULL      -- ISO 8601 UTC
);
