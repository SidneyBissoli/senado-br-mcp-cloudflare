/**
 * Offline correctness tests for the pure scoring core (evals/score.ts).
 * Synthetic predictions with known accuracy — no network, no model.
 */

import { describe, it, expect } from "vitest";
import {
  scoreItem,
  aggregate,
  scoreAll,
  evaluateGate,
  GATE_REMEDIATION_THRESHOLD,
  GATE_DEPRIORITIZE_THRESHOLD,
  type Prediction,
} from "../../evals/score.js";

const fx = (id: string, expectedTools: string[]) => ({ id, expectedTools });

describe("scoreItem", () => {
  it("marks top-1 hit when first prediction is in expectedTools", () => {
    const item = scoreItem(fx("a", ["tool_x"]), { id: "a", predictedTools: ["tool_x"] }, "area1");
    expect(item.top1).toBe(true);
    expect(item.hitRank).toBe(1);
  });

  it("accepts any member of a multi-tool expected set", () => {
    const item = scoreItem(fx("a", ["tool_x", "tool_y"]), { id: "a", predictedTools: ["tool_y"] }, "area1");
    expect(item.top1).toBe(true);
  });

  it("marks miss but records hitRank when correct tool is lower in the list", () => {
    const item = scoreItem(fx("a", ["tool_x"]), { id: "a", predictedTools: ["wrong", "tool_x"] }, "area1");
    expect(item.top1).toBe(false);
    expect(item.hitRank).toBe(2);
  });

  it("records null hitRank when no prediction matches", () => {
    const item = scoreItem(fx("a", ["tool_x"]), { id: "a", predictedTools: ["wrong", "nope"] }, "area1");
    expect(item.top1).toBe(false);
    expect(item.hitRank).toBeNull();
  });

  it("treats a missing/empty prediction as a miss", () => {
    const item = scoreItem(fx("a", ["tool_x"]), undefined, "area1");
    expect(item.top1).toBe(false);
    expect(item.hitRank).toBeNull();
    expect(item.predictedTools).toEqual([]);
  });
});

describe("aggregate", () => {
  it("computes top-1 accuracy correctly (3/4 = 75%)", () => {
    const items = [
      scoreItem(fx("1", ["a"]), { id: "1", predictedTools: ["a"] }, "x"),
      scoreItem(fx("2", ["b"]), { id: "2", predictedTools: ["b"] }, "x"),
      scoreItem(fx("3", ["c"]), { id: "3", predictedTools: ["c"] }, "y"),
      scoreItem(fx("4", ["d"]), { id: "4", predictedTools: ["wrong"] }, "y"),
    ];
    const report = aggregate(items, 3);
    expect(report.total).toBe(4);
    expect(report.top1Correct).toBe(3);
    expect(report.top1Accuracy).toBeCloseTo(0.75, 5);
  });

  it("computes top-k accuracy as cumulative hit-by-rank-k", () => {
    const items = [
      scoreItem(fx("1", ["a"]), { id: "1", predictedTools: ["a"] }, "x"), // hitRank 1
      scoreItem(fx("2", ["b"]), { id: "2", predictedTools: ["wrong", "b"] }, "x"), // hitRank 2
      scoreItem(fx("3", ["c"]), { id: "3", predictedTools: ["w", "w2", "c"] }, "x"), // hitRank 3
      scoreItem(fx("4", ["d"]), { id: "4", predictedTools: ["nope"] }, "x"), // miss
    ];
    const report = aggregate(items, 3);
    expect(report.topKAccuracy[1]).toBeCloseTo(0.25, 5); // only #1
    expect(report.topKAccuracy[2]).toBeCloseTo(0.5, 5); // #1, #2
    expect(report.topKAccuracy[3]).toBeCloseTo(0.75, 5); // #1, #2, #3
  });

  it("breaks accuracy down per area", () => {
    const items = [
      scoreItem(fx("1", ["a"]), { id: "1", predictedTools: ["a"] }, "alpha"),
      scoreItem(fx("2", ["b"]), { id: "2", predictedTools: ["wrong"] }, "alpha"),
      scoreItem(fx("3", ["c"]), { id: "3", predictedTools: ["c"] }, "beta"),
    ];
    const report = aggregate(items, 3);
    const alpha = report.byArea.find((a) => a.area === "alpha")!;
    const beta = report.byArea.find((a) => a.area === "beta")!;
    expect(alpha.top1Accuracy).toBeCloseTo(0.5, 5);
    expect(beta.top1Accuracy).toBeCloseTo(1.0, 5);
    // byArea is sorted worst-first
    expect(report.byArea[0].area).toBe("alpha");
  });

  it("counts attempted (non-empty prediction) separately from total", () => {
    const items = [
      scoreItem(fx("1", ["a"]), { id: "1", predictedTools: ["a"] }, "x"),
      scoreItem(fx("2", ["b"]), undefined, "x"),
    ];
    const report = aggregate(items, 3);
    expect(report.total).toBe(2);
    expect(report.attempted).toBe(1);
  });

  it("handles an empty item set without dividing by zero", () => {
    const report = aggregate([], 3);
    expect(report.top1Accuracy).toBe(0);
    expect(report.topKAccuracy[1]).toBe(0);
  });
});

describe("scoreAll", () => {
  it("joins fixtures with predictions by id and scores end-to-end", () => {
    const fixtures = [fx("1", ["a"]), fx("2", ["b"])];
    const predictions: Prediction[] = [
      { id: "1", predictedTools: ["a"] },
      { id: "2", predictedTools: ["wrong"] },
    ];
    const report = scoreAll(fixtures, predictions, () => "area", 3);
    expect(report.top1Accuracy).toBeCloseTo(0.5, 5);
  });
});

describe("evaluateGate (ROADMAP Sessão 1)", () => {
  it("recommends remediation below 85%", () => {
    const r = evaluateGate(0.84);
    expect(r.decision).toBe("remediar");
  });

  it("deprioritizes catalog refactor at/above 90%", () => {
    expect(evaluateGate(0.9).decision).toBe("despriorizar-refatoracao");
    expect(evaluateGate(0.97).decision).toBe("despriorizar-refatoracao");
  });

  it("flags the grey zone between 85% and 90%", () => {
    const r = evaluateGate(0.87);
    expect(r.decision).toBe("zona-cinzenta");
  });

  it("uses the documented thresholds", () => {
    expect(GATE_REMEDIATION_THRESHOLD).toBe(0.85);
    expect(GATE_DEPRIORITIZE_THRESHOLD).toBe(0.9);
    // boundary checks
    expect(evaluateGate(GATE_REMEDIATION_THRESHOLD).decision).toBe("zona-cinzenta");
    expect(evaluateGate(GATE_DEPRIORITIZE_THRESHOLD).decision).toBe("despriorizar-refatoracao");
  });
});
