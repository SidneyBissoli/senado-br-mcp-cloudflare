/**
 * Upstream shape-drift contract tests for src/tools/votacoes.ts (/votacao, v3).
 *
 * Contract tier: run with `npm run test:contract` (vitest.contract.config.ts) —
 * excluded from the default `npm test` suite. Fixtures in tests/contract/fixtures/
 * are raw upstream captures (sorted keys, arrays truncated to 3 items), refreshed
 * by `npm run contract:refresh`. A failure right after a live refresh means the
 * upstream changed shape (renamed wrapper/keys), not a bug in these tests.
 *
 * Per endpoint: (a) the RAW fixture still carries the keys the parser depends on;
 * (b) the real exported parser yields defined/typed fields. Presence/shape only —
 * never exact values.
 */
import { describe, it, expect } from "vitest";
import {
  parseVotacaoItem,
  toISODate,
  formatISO,
  expandirResultado,
  RESULTADO_VOTACAO,
} from "../../src/tools/votacoes.js";
import votacoesRaw from "./fixtures/v3/votacoes.json?raw";

const items: any[] = JSON.parse(votacoesRaw);

describe("contract: /votacao (flat camelCase v3 array)", () => {
  it("raw fixture is a non-empty flat array at the root", () => {
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
  });

  it("raw items carry the parser-critical keys", () => {
    const v = items[0];
    for (const k of [
      "codigoSessao",
      "codigoSessaoVotacao",
      "dataSessao",
      "identificacao",
      "sigla",
      "numero",
      "ano",
      "codigoMateria",
      "descricaoVotacao",
      "resultadoVotacao",
      "votacaoSecreta",
      // totals are PRESENT but null for open roll calls (this capture) —
      // the parser recomputes them from votos[] via computarPlacar.
      "totalVotosSim",
      "totalVotosNao",
      "totalVotosAbstencao",
      "votos",
    ]) {
      expect(v).toHaveProperty(k);
    }
  });

  it("raw votos[] entries carry the per-senator vote keys", () => {
    const comVotos = items.find((v) => Array.isArray(v.votos) && v.votos.length > 0);
    // Every item in this capture has votos; if the refresh ever drops them,
    // the totals shape test above still covers the tally contract.
    expect(comVotos).toBeDefined();
    const vt = comVotos!.votos[0];
    for (const k of [
      "codigoParlamentar",
      "nomeParlamentar",
      "siglaPartidoParlamentar",
      "siglaUFParlamentar",
      "descricaoVotoParlamentar",
    ]) {
      expect(vt).toHaveProperty(k);
    }
    // descricaoVotoParlamentar may be null (open roll calls) — the parser then
    // falls back to siglaVotoParlamentar; one of the two must be a usable string.
    const votoTexto = vt.descricaoVotoParlamentar ?? vt.siglaVotoParlamentar;
    expect(typeof votoTexto).toBe("string");
    expect(votoTexto.length).toBeGreaterThan(0);
  });

  it("parseVotacaoItem(v, true) yields typed fields, tally and nominal votes", () => {
    const comVotos = items.find((v) => Array.isArray(v.votos) && v.votos.length > 0)!;
    const parsed = parseVotacaoItem(comVotos, true);
    expect(typeof parsed.codigoSessao).toBe("number");
    expect(typeof parsed.codigoVotacao).toBe("number");
    expect(parsed.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof parsed.materia).toBe("string");
    expect(typeof parsed.codigoMateria).toBe("number");
    expect(typeof parsed.descricao).toBe("string");
    expect(typeof parsed.resultado).toBe("string");
    expect(typeof parsed.resultadoCodigo).toBe("string");
    // If the raw code is a known single-letter code, the parser must expand it.
    if (parsed.resultadoCodigo! in RESULTADO_VOTACAO) {
      expect(parsed.resultado).toBe(RESULTADO_VOTACAO[parsed.resultadoCodigo!]);
    }
    expect(typeof parsed.secreta).toBe("boolean");
    // Totals: number when provided or recomputed; null only for secret votes without votos.
    for (const total of [parsed.totalSim, parsed.totalNao, parsed.totalAbstencao]) {
      expect(total === null || typeof total === "number").toBe(true);
    }
    // This capture has null upstream totals + non-empty votos → recomputed tally.
    if (
      comVotos.totalVotosSim == null &&
      comVotos.totalVotosNao == null &&
      comVotos.totalVotosAbstencao == null
    ) {
      expect(parsed.placarComputado).toBe(true);
      expect(typeof parsed.totalSim).toBe("number");
      expect(typeof parsed.totalNao).toBe("number");
      expect(typeof parsed.totalAbstencao).toBe("number");
    }
    // Nominal votes
    expect(Array.isArray(parsed.votos)).toBe(true);
    expect(parsed.votos.length).toBeGreaterThan(0);
    const vt = parsed.votos[0];
    expect(typeof vt.codigoSenador).toBe("number");
    expect(typeof vt.nomeSenador).toBe("string");
    expect(vt.nomeSenador.length).toBeGreaterThan(0);
    expect(typeof vt.partido).toBe("string");
    expect(typeof vt.uf).toBe("string");
    expect(typeof vt.voto).toBe("string");
    expect(vt.voto.length).toBeGreaterThan(0);
  });

  it("date helpers keep the YYYYMMDD → ISO bridge the endpoint requires", () => {
    expect(toISODate("20250311")).toBe("2025-03-11");
    expect(formatISO(new Date(2025, 2, 11))).toBe("2025-03-11");
  });

  it("expandirResultado expands known codes and passes unknown text through", () => {
    expect(expandirResultado("A")).toEqual({ resultado: "Aprovada", resultadoCodigo: "A" });
    expect(expandirResultado(null)).toEqual({ resultado: null, resultadoCodigo: null });
    // Every resultadoVotacao code in the capture must stay resolvable to a non-empty label.
    for (const v of items) {
      const { resultado } = expandirResultado(v.resultadoVotacao);
      if (v.resultadoVotacao != null && v.resultadoVotacao !== "") {
        expect(typeof resultado).toBe("string");
        expect(resultado!.length).toBeGreaterThan(0);
      }
    }
  });
});
