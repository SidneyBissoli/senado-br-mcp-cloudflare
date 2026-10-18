/**
 * Unit tests for the linger re-status (§2) — pure functions, no network.
 *
 * selectRestatus decides flips by /processo membership (NOT crawl-absence); buildRestatusRecords
 * rebuilds the row with only `status` changed (votes/text preserved), so the hash changes exactly
 * because the status changed.
 */

import { describe, it, expect } from "vitest";
import { selectRestatus, selectNaoListadasSemDetalhe, buildRestatusRecords } from "../../scripts/ingest-ecidadania/restatus.js";
import { buildConsultaResumo } from "../../src/scraper/ecidadania.js";
import { contentHash } from "../../src/scraper/pipeline.js";

describe("selectRestatus", () => {
  const tramitando = new Set<number>([10, 11]); // 10,11 still in tramitação
  const existing = [
    { id: 10, status: "aberta" }, // in tramitando, stored aberta → no change
    { id: 20, status: "aberta" }, // NOT in tramitando, stored aberta → flip to encerrada
    { id: 21, status: "encerrada" }, // NOT in tramitando, already encerrada → no change
    { id: 11, status: "encerrada" }, // back in tramitando, stored encerrada → flip to aberta (reopened)
    { id: 30, status: "aberta" }, // would flip, but it's in this crawl → skip
  ];

  it("flips only non-crawled rows whose membership-derived status differs", () => {
    const flips = selectRestatus(existing, new Set([30]), tramitando);
    expect(flips).toEqual([
      { id: 20, newStatus: "encerrada" },
      { id: 11, newStatus: "aberta" },
    ]);
  });

  it("never flips a row present in the crawl (normal load path restates it)", () => {
    const flips = selectRestatus([{ id: 20, status: "aberta" }], new Set([20]), tramitando);
    expect(flips).toEqual([]);
  });

  it("does not flip a non-crawled row that is still in tramitando (absence is not closure)", () => {
    const flips = selectRestatus([{ id: 10, status: "aberta" }], new Set(), tramitando);
    expect(flips).toEqual([]);
  });
});

describe("buildRestatusRecords", () => {
  const original = buildConsultaResumo({ id: 20, materia: "PL 1/2020", ementa: "X", votosSim: 100, votosNao: 40, totalVotos: 140, status: "aberta" });
  const payloads = new Map<number, string>([[20, JSON.stringify(original)]]);

  it("rebuilds with only status changed; votes/text preserved and hash differs", () => {
    const [rec] = buildRestatusRecords([{ id: 20, newStatus: "encerrada" }], payloads);
    const obj = JSON.parse(rec.payloadJson);
    expect(obj.status).toBe("encerrada");
    expect(obj.votosSim).toBe(100);
    expect(obj.materia).toBe("PL 1/2020");
    expect(rec.status).toBe("encerrada");
    expect(rec.metrica).toBe(140);
    expect(rec.contentHash).toBe(contentHash(rec.payloadJson));
    expect(rec.contentHash).not.toBe(contentHash(JSON.stringify(original)));
  });

  it("skips flips whose payload is missing", () => {
    expect(buildRestatusRecords([{ id: 99, newStatus: "encerrada" }], payloads)).toEqual([]);
  });
});

// Até 18/10/2026 o detalhe só era buscado para as consultas da listagem (só abertas): 390 encerradas
// ficaram sem autoria para sempre. As fora da listagem agora entram pela mesma etapa.
describe("consultas fora da listagem sem autoria", () => {
  const guardada = (id: number, autoria: string | null, status = "encerrada") =>
    JSON.stringify(buildConsultaResumo({ id, materia: `PL ${id}/2020`, votosSim: 5, votosNao: 1, autoria, status }));
  const payloads = new Map<number, string>([
    [40, guardada(40, null)], // encerrada sem autoria → entra
    [41, guardada(41, "Senador A (PT/BA)")], // encerrada com autoria → não entra
    [42, guardada(42, null, "aberta")], // na listagem deste run → o caminho normal cuida
    [43, guardada(43, null)],
  ]);

  it("seleciona só as fora da listagem ainda sem autoria, em ordem de id", () => {
    expect(selectNaoListadasSemDetalhe(payloads, new Set([42]))).toEqual([40, 43]);
  });

  it("detalhe lido grava a autoria e preserva status e votos", () => {
    const [rec] = buildRestatusRecords([], payloads, new Map([[40, { autoria: "Senador B (PL/SP)", relator: null }]]));
    const obj = JSON.parse(rec.payloadJson);
    expect(rec.entityId).toBe(40);
    expect(obj.autoria).toBe("Senador B (PL/SP)");
    expect(obj.status).toBe("encerrada");
    expect(obj.votosSim).toBe(5);
    expect(rec.contentHash).toBe(contentHash(rec.payloadJson));
  });

  it("detalhe vazio não gera upsert (nada mudou) e nunca apaga autoria guardada", () => {
    const vazio = { autoria: null, relator: null };
    expect(buildRestatusRecords([], payloads, new Map([[43, vazio]]))).toEqual([]);
    expect(buildRestatusRecords([], payloads, new Map([[41, vazio]]))).toEqual([]);
  });

  it("consulta que muda de situação E ganha autoria vira UM registro com as duas mudanças", () => {
    const recs = buildRestatusRecords(
      [{ id: 40, newStatus: "aberta" }],
      payloads,
      new Map([[40, { autoria: "Senador B (PL/SP)", relator: null }]]),
    );
    expect(recs).toHaveLength(1);
    const obj = JSON.parse(recs[0].payloadJson);
    expect(obj.status).toBe("aberta");
    expect(obj.autoria).toBe("Senador B (PL/SP)");
  });
});
