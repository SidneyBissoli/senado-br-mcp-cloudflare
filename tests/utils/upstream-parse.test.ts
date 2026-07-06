import { describe, it, expect } from "vitest";
import {
  digArrayRoot,
  digObjectRoot,
  unwrapAdmEnvelope,
  RootNotFoundError,
} from "../../src/utils/upstream-parse.js";

describe("digArrayRoot", () => {
  it("resolves the array at a nested candidate path", () => {
    const obj = { A: { B: { C: [1, 2, 3] } } };
    expect(digArrayRoot(obj, [["A", "B", "C"]], "t")).toEqual([1, 2, 3]);
  });

  it("wraps a single object leaf into an array (ensureArray)", () => {
    const obj = { A: { B: { C: { x: 1 } } } };
    expect(digArrayRoot(obj, [["A", "B", "C"]], "t")).toEqual([{ x: 1 }]);
  });

  it("supports a flat array at the response root via empty path", () => {
    const obj = [1, 2];
    expect(digArrayRoot(obj, [[]], "t")).toEqual([1, 2]);
  });

  it("uses the first candidate that resolves", () => {
    const obj = { New: { Items: [9] } };
    const out = digArrayRoot(obj, [["Old", "Items"], ["New", "Items"]], "t");
    expect(out).toEqual([9]);
  });

  it("returns [] for a legitimately empty collection (root present, leaf null)", () => {
    // BUG-024 shape: DiscursosSessao present, Sessoes null (window with no sessions).
    const obj = { DiscursosSessao: { Sessoes: null } };
    expect(digArrayRoot(obj, [["DiscursosSessao", "Sessoes", "Sessao"]], "t")).toEqual([]);
  });

  it("throws RootNotFoundError when no candidate root is present", () => {
    const obj = { SomethingElse: {} };
    expect(() => digArrayRoot(obj, [["MesaSF", "Cargos", "Cargo"]], "senado_mesa")).toThrow(
      RootNotFoundError,
    );
  });

  it("embeds the context in the error message", () => {
    try {
      digArrayRoot({}, [["Nope"]], "senado_mesa");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RootNotFoundError);
      expect((e as RootNotFoundError).message).toContain("senado_mesa");
      expect((e as RootNotFoundError).context).toBe("senado_mesa");
    }
  });
});

describe("digObjectRoot", () => {
  it("resolves the object at a candidate path", () => {
    const obj = { Detalhe: { documento: { id: "1" } } };
    expect(digObjectRoot(obj, [["Detalhe", "documento"]], "t")).toEqual({ id: "1" });
  });

  it("falls through to a later candidate", () => {
    const obj = { blocos: { bloco: { nomeBloco: "X" } } };
    const out = digObjectRoot(obj, [["BlocoParlamentar", "Bloco"], ["blocos", "bloco"]], "t");
    expect(out).toEqual({ nomeBloco: "X" });
  });

  it("does not accept an array as the object node", () => {
    const obj = { A: [1, 2] };
    expect(() => digObjectRoot(obj, [["A"]], "t")).toThrow(RootNotFoundError);
  });

  it("throws when nothing resolves", () => {
    expect(() => digObjectRoot({}, [["Nope"]], "senado_obter_bloco")).toThrow(RootNotFoundError);
  });

  it("uses a caller-supplied notFoundMessage", () => {
    try {
      digObjectRoot({}, [["Nope"]], "senado_obter_bloco", {
        notFoundMessage: "Bloco nao encontrado",
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toBe("Bloco nao encontrado");
    }
  });
});

describe("unwrapAdmEnvelope", () => {
  it("unwraps the {statusCode, msg, data} envelope", () => {
    const payload = { statusCode: 200, msg: "ok", data: [{ id: 1 }, { id: 2 }] };
    expect(unwrapAdmEnvelope(payload)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("returns a flat array unchanged", () => {
    const payload = [{ id: 1 }];
    expect(unwrapAdmEnvelope(payload)).toBe(payload);
  });

  it("returns a plain object without the envelope keys unchanged", () => {
    const payload = { nome: "x", uf: "RS" };
    expect(unwrapAdmEnvelope(payload)).toBe(payload);
  });

  it("does not unwrap when only statusCode is present (no data)", () => {
    const payload = { statusCode: 200, msg: "ok" };
    expect(unwrapAdmEnvelope(payload)).toBe(payload);
  });
});
