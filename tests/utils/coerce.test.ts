import { describe, it, expect } from "vitest";
import {
  parseBRL,
  toBool,
  normalizeText,
  avisoAgregadoZero,
} from "../../src/utils/validation.js";

// Accented literals are written as \u escapes to keep this new file ASCII-only.
const SAO_PAULO = "S\u00e3o Paulo"; // "Sao Paulo" with tilde
const NAO = "N\u00e3o"; // "Nao" with tilde

describe("parseBRL", () => {
  it("parses a pt-BR monetary string with thousands and decimals", () => {
    expect(parseBRL("1.234,56")).toBe(1234.56);
    expect(parseBRL("41.441,26")).toBe(41441.26);
  });

  it("parses negatives", () => {
    expect(parseBRL("-7.139,64")).toBe(-7139.64);
  });

  it("parses a plain decimal-comma string without thousands", () => {
    expect(parseBRL("1234,56")).toBe(1234.56);
    expect(parseBRL("10800,00")).toBe(10800);
  });

  it("returns already-numeric input unchanged (no dot-stripping)", () => {
    expect(parseBRL(123.45)).toBe(123.45);
    expect(parseBRL(0)).toBe(0);
  });

  it("returns fallback for null/undefined/empty", () => {
    expect(parseBRL(null)).toBe(0);
    expect(parseBRL(undefined)).toBe(0);
    expect(parseBRL("")).toBe(0);
    expect(parseBRL(null, -1)).toBe(-1);
  });

  it("returns fallback for unparseable input", () => {
    expect(parseBRL("abc")).toBe(0);
    expect(parseBRL({} as unknown)).toBe(0);
    expect(parseBRL(NaN)).toBe(0);
  });
});

describe("toBool", () => {
  it("passes through real booleans", () => {
    expect(toBool(true)).toBe(true);
    expect(toBool(false)).toBe(false);
  });

  it("coerces the string 'true'/'false' (case/space-insensitive)", () => {
    expect(toBool("true")).toBe(true);
    expect(toBool(" TRUE ")).toBe(true);
    expect(toBool("false")).toBe(false);
    expect(toBool("False")).toBe(false);
  });

  it("treats anything else as false (S/N is not folded in here)", () => {
    expect(toBool("S")).toBe(false);
    expect(toBool("1")).toBe(false);
    expect(toBool(1)).toBe(false);
    expect(toBool(null)).toBe(false);
    expect(toBool(undefined)).toBe(false);
  });
});

describe("normalizeText", () => {
  it("lowercases and strips accents", () => {
    expect(normalizeText(SAO_PAULO)).toBe("sao paulo");
    expect(normalizeText("VIGIL\u00c2NCIA")).toBe("vigilancia"); // "VIGIL\u00c2NCIA"
    expect(normalizeText(NAO)).toBe("nao");
  });

  it("is idempotent on already-normalized text", () => {
    expect(normalizeText("sao paulo")).toBe("sao paulo");
  });

  it("returns empty string for null/undefined", () => {
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
  });

  it("coerces non-strings via String()", () => {
    expect(normalizeText(123)).toBe("123");
  });
});

describe("avisoAgregadoZero", () => {
  it("warns when total is 0 but records were processed", () => {
    const aviso = avisoAgregadoZero(0, 715);
    expect(aviso).not.toBeNull();
    expect(aviso).toContain("715");
  });

  it("returns null when total is non-zero", () => {
    expect(avisoAgregadoZero(1234.56, 715)).toBeNull();
  });

  it("returns null when there are no records", () => {
    expect(avisoAgregadoZero(0, 0)).toBeNull();
  });
});
