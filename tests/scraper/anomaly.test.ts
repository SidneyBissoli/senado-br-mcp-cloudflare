import { describe, it, expect } from "vitest";
import { classifyRun, parseAnomalyMinPct } from "../../src/scraper/anomaly.js";

describe("classifyRun", () => {
  it("returns 'erro' when the scrape threw", () => {
    expect(classifyRun({ rowsScraped: 100, lastGoodRows: 100, error: new Error("boom") })).toBe("erro");
  });

  it("returns 'anomalo' on zero rows", () => {
    expect(classifyRun({ rowsScraped: 0, lastGoodRows: 100 })).toBe("anomalo");
  });

  it("returns 'anomalo' when below minPct of last good run", () => {
    // 40 of 100 = 40% < default 50%
    expect(classifyRun({ rowsScraped: 40, lastGoodRows: 100 })).toBe("anomalo");
  });

  it("returns 'ok' when at or above minPct of last good run", () => {
    expect(classifyRun({ rowsScraped: 60, lastGoodRows: 100 })).toBe("ok");
    expect(classifyRun({ rowsScraped: 50, lastGoodRows: 100 })).toBe("ok"); // exactly 50% is not < 50
  });

  it("accepts the first run (no baseline) as long as rows > 0", () => {
    expect(classifyRun({ rowsScraped: 5, lastGoodRows: null })).toBe("ok");
    expect(classifyRun({ rowsScraped: 5, lastGoodRows: 0 })).toBe("ok");
  });

  it("respects a custom minPct", () => {
    expect(classifyRun({ rowsScraped: 70, lastGoodRows: 100 }, 80)).toBe("anomalo");
    expect(classifyRun({ rowsScraped: 90, lastGoodRows: 100 }, 80)).toBe("ok");
  });
});

describe("parseAnomalyMinPct", () => {
  it("parses a valid percentage", () => {
    expect(parseAnomalyMinPct("70")).toBe(70);
  });

  it("falls back on undefined / invalid / out-of-range", () => {
    expect(parseAnomalyMinPct(undefined)).toBe(50);
    expect(parseAnomalyMinPct("abc")).toBe(50);
    expect(parseAnomalyMinPct("-5")).toBe(50);
    expect(parseAnomalyMinPct("150")).toBe(50);
  });

  it("uses a custom fallback", () => {
    expect(parseAnomalyMinPct(undefined, 75)).toBe(75);
  });
});
