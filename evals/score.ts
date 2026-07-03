/**
 * Pure scoring core for the tool-selection eval. No network, no model, no I/O.
 *
 * The runner produces, per fixture, the ordered list of tool names the model would call
 * (most-likely first). This module turns those predictions + the fixtures' `expectedTools`
 * into accuracy numbers: top-1, top-k, and a per-area breakdown. These functions are what the
 * offline unit tests exercise with synthetic data of known accuracy.
 */

import type { EvalFixture } from "./fixtures/queries.js";

/** A single model prediction for one fixture: tool names in priority order (best first). */
export interface Prediction {
  id: string;
  /** Ordered candidate tool names, most-likely first. Empty if the model called no tool. */
  predictedTools: string[];
}

export interface ScoredItem {
  id: string;
  area: string;
  expectedTools: string[];
  predictedTools: string[];
  /** True if the top-1 prediction is in expectedTools. */
  top1: boolean;
  /** 1-based rank of the first correct prediction, or null if none in the list. */
  hitRank: number | null;
}

export interface AreaAccuracy {
  area: string;
  total: number;
  top1Correct: number;
  top1Accuracy: number;
}

export interface ScoreReport {
  total: number;
  /** Fixtures with at least one prediction (the model attempted a tool call). */
  attempted: number;
  top1Correct: number;
  top1Accuracy: number;
  /** topKAccuracy[k] = fraction whose first correct hit is at rank <= k, for k in 1..maxK. */
  topKAccuracy: Record<number, number>;
  byArea: AreaAccuracy[];
  items: ScoredItem[];
}

/** Score one fixture against its prediction. `area` is looked up from the catalog by the caller. */
export function scoreItem(
  fixture: Pick<EvalFixture, "id" | "expectedTools">,
  prediction: Prediction | undefined,
  area: string,
): ScoredItem {
  const predicted = prediction?.predictedTools ?? [];
  const expected = new Set(fixture.expectedTools);
  let hitRank: number | null = null;
  for (let i = 0; i < predicted.length; i++) {
    if (expected.has(predicted[i])) {
      hitRank = i + 1;
      break;
    }
  }
  return {
    id: fixture.id,
    area,
    expectedTools: fixture.expectedTools,
    predictedTools: predicted,
    top1: predicted.length > 0 && expected.has(predicted[0]),
    hitRank,
  };
}

/**
 * Aggregate scored items into a report.
 *
 * @param maxK highest k to compute top-k accuracy for (default 3).
 */
export function aggregate(items: ScoredItem[], maxK = 3): ScoreReport {
  const total = items.length;
  const attempted = items.filter((it) => it.predictedTools.length > 0).length;
  const top1Correct = items.filter((it) => it.top1).length;

  const topKAccuracy: Record<number, number> = {};
  for (let k = 1; k <= maxK; k++) {
    const hits = items.filter((it) => it.hitRank !== null && it.hitRank <= k).length;
    topKAccuracy[k] = total === 0 ? 0 : hits / total;
  }

  const areas = new Map<string, { total: number; correct: number }>();
  for (const it of items) {
    const a = areas.get(it.area) ?? { total: 0, correct: 0 };
    a.total += 1;
    if (it.top1) a.correct += 1;
    areas.set(it.area, a);
  }
  const byArea: AreaAccuracy[] = [...areas.entries()]
    .map(([area, v]) => ({
      area,
      total: v.total,
      top1Correct: v.correct,
      top1Accuracy: v.total === 0 ? 0 : v.correct / v.total,
    }))
    .sort((x, y) => x.top1Accuracy - y.top1Accuracy || x.area.localeCompare(y.area));

  return {
    total,
    attempted,
    top1Correct,
    top1Accuracy: total === 0 ? 0 : top1Correct / total,
    topKAccuracy,
    byArea,
    items,
  };
}

/** Convenience: score a whole batch given fixtures, predictions and an area lookup. */
export function scoreAll(
  fixtures: Pick<EvalFixture, "id" | "expectedTools">[],
  predictions: Prediction[],
  areaByExpectedTool: (fixture: Pick<EvalFixture, "id" | "expectedTools">) => string,
  maxK = 3,
): ScoreReport {
  const predById = new Map(predictions.map((p) => [p.id, p]));
  const items = fixtures.map((f) => scoreItem(f, predById.get(f.id), areaByExpectedTool(f)));
  return aggregate(items, maxK);
}

// --- Gate logic (mirrors ROADMAP CIENTIFICO, Sessão 1 — planejamento local em docs/_local/) ---

export type GateDecision = "remediar" | "despriorizar-refatoracao" | "zona-cinzenta";

export interface GateResult {
  decision: GateDecision;
  accuracy: number;
  /** Human-readable recommendation in pt-BR. */
  message: string;
}

export const GATE_REMEDIATION_THRESHOLD = 0.85;
export const GATE_DEPRIORITIZE_THRESHOLD = 0.9;

/**
 * Apply the ROADMAP gate to a top-1 accuracy:
 *   < ~85%  → abrir sessão de remediação (deferred loading / Code Mode / agrupamento).
 *   >= ~90% → despriorizar refatoração de catálogo (seguir só consolidando via enums).
 *   entre os dois → zona cinzenta (manter sob observação).
 */
export function evaluateGate(top1Accuracy: number): GateResult {
  const pct = (top1Accuracy * 100).toFixed(1);
  if (top1Accuracy < GATE_REMEDIATION_THRESHOLD) {
    return {
      decision: "remediar",
      accuracy: top1Accuracy,
      message: `Acurácia top-1 = ${pct}% (< 85%). Recomendação: abrir SESSÃO DE REMEDIAÇÃO (deferred loading / Code Mode / agrupamento por sessão).`,
    };
  }
  if (top1Accuracy >= GATE_DEPRIORITIZE_THRESHOLD) {
    return {
      decision: "despriorizar-refatoracao",
      accuracy: top1Accuracy,
      message: `Acurácia top-1 = ${pct}% (>= 90%) mesmo com 66 tools. Recomendação: DESPRIORIZAR refatoração de catálogo; seguir consolidando via enums.`,
    };
  }
  return {
    decision: "zona-cinzenta",
    accuracy: top1Accuracy,
    message: `Acurácia top-1 = ${pct}% (entre 85% e 90%). Zona cinzenta: manter sob observação; reavaliar após próxima mudança de tool/descrição.`,
  };
}
