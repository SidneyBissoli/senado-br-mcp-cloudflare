-- Migration 0006 — autoria oficial das matérias (E1.b do ROADMAP, 25/11/2026).
--
-- Controle do coletor `index-autoria.ts`: uma linha por matéria cuja autoria JÁ FOI LIDA INTEIRA (a
-- lista `/processo?codigoMateria=N` e o detalhe de cada processo, no Senado; `/proposicoes/N/autores`,
-- na Câmara). As respostas em si ficam no arquivo bruto (balde `ecidadania-arquivos` + índice); esta
-- tabela só diz ao coletor o que não precisa ler de novo e liga o código da matéria aos processos.
-- Falha não grava linha: a matéria volta na fila do run seguinte. A linha só é gravada DEPOIS de o
-- índice do arquivo ter sido descarregado (nunca "lida" sem a leitura registrada).
-- Tabela nova, não ALTER TABLE: as migrations são reaplicadas em todo run e precisam ser idempotentes.

CREATE TABLE IF NOT EXISTS ecidadania_autoria_estado (
  casa         TEXT    NOT NULL,  -- 'SF' (código da matéria no Senado) | 'CD' (idProposicao na Câmara)
  codigo       INTEGER NOT NULL,  -- codigoMateria (SF) ou idProposicao (CD)
  situacao     TEXT    NOT NULL,  -- 'lida' | 'sem-processo' (lista vazia) | 'nao-encontrada' (HTTP 404)
  processos    TEXT,              -- SF: ids dos processos da lista, separados por vírgula; CD: null
  lida_em      TEXT    NOT NULL,  -- ISO 8601 UTC
  leitor       TEXT    NOT NULL,  -- `<job>@<commit>`, como no índice do arquivo
  PRIMARY KEY (casa, codigo)
);
