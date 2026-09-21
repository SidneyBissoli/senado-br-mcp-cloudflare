/**
 * O backfill de DETALHE e a tabela de runs: o que ele pode e o que não pode gravar.
 *
 * Ele compartilha `entidade` com o crawl do corpus de ideias, e daí saem DUAS
 * regras opostas que precisam conviver:
 *
 *   - NUNCA 'ok'. Não é um crawl de corpus; uma linha 'ok' deslocaria o baseline
 *     de freshness e o de linhas, fazendo parecer que o corpus foi recoletado
 *     quando só os detalhes foram preenchidos.
 *   - SEMPRE 'erro' quando falha. Até 21/09/2026 este job era o único dos quatro
 *     sem rastro nenhum no D1 — e foi justamente ele que morreu 3 das 4 vezes no
 *     episódio de portal fora de 20-21/09.
 *
 * A segunda regra não reabre a primeira porque os TRÊS leitores da tabela
 * filtram por status='ok' (pipeline.ts, store.ts, d1.ts): linha de erro informa
 * sem deslocar baseline.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  generateRunOnlySql,
  generateDetalheLoadSqlBatches,
} from "../../scripts/ingest-ecidadania/sql.js";
import { contentHash, type SyncRecord } from "../../src/scraper/pipeline.js";

const NOW = "2026-09-21T12:00:00Z";
const FONTE = "scripts/ingest-ecidadania/index-ideias-detalhe.ts";

const rec = (id: number): SyncRecord => {
  const payloadJson = JSON.stringify({ id });
  return {
    entityId: id,
    sourceUrl: `https://x/${id}`,
    payloadJson,
    status: "aberta",
    metrica: 0,
    comissao: null,
    contentHash: contentHash(payloadJson),
  };
};

describe("linha de run do backfill de detalhe", () => {
  it("a linha de ERRO sai com a entidade do corpus e o status certo", () => {
    const sql = generateRunOnlySql(NOW, "erro", 0, "fatal: portal fora", "ideias");
    expect(sql).toContain("ecidadania_scrape_runs");
    expect(sql).toContain("'erro'");
    expect(sql).toContain("'ideias'");
    expect(sql).toContain("portal fora");
  });

  it("a linha de erro NÃO é 'ok' — é o que a mantém invisível para os três leitores", () => {
    const sql = generateRunOnlySql(NOW, "erro", 0, "fatal: portal fora", "ideias");
    expect(sql).not.toContain("'ok'");
  });

  it("o load do backfill continua SEM emitir run row (a regra que não pode regredir)", () => {
    const files = generateDetalheLoadSqlBatches(
      [{ rec: rec(1), changed: true }, { rec: rec(2), changed: false }],
      NOW,
      "ideias",
      "-- cursor",
      10,
    );
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f).not.toContain("ecidadania_scrape_runs");
  });
});

describe("o job de detalhe, lido da fonte", () => {
  const src = readFileSync(FONTE, "utf8");

  it("grava run row de erro no handler fatal", () => {
    expect(src).toMatch(/writeRunOnly\(new Date\(\)\.toISOString\(\), "erro"/);
  });

  it("limpa os lotes parciais ANTES de escrever — senão o cursor avançaria sobre o que não foi buscado", () => {
    const i = src.indexOf("cleanOldOutputs();", src.indexOf("main().catch"));
    const j = src.indexOf("writeRunOnly(", src.indexOf("main().catch"));
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });

  it("NUNCA grava run row 'ok' — nenhuma chamada com esse status na fonte", () => {
    expect(src).not.toMatch(/writeRunOnly\([^)]*"ok"/);
    expect(src).not.toMatch(/generateRunOnlySql\([^)]*"ok"/);
  });
});
