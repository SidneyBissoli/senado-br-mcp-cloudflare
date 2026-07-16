/**
 * Upstream shape-drift contract tests for src/tools/discursos.ts.
 *
 * Contract tier: `npm run test:contract` (vitest.contract.config.ts) — excluded from the
 * default `npm test` suite. Fixtures are raw upstream captures (sorted keys, arrays
 * truncated to 3 items) refreshed by `npm run contract:refresh`; a failure right after a
 * live refresh means real upstream shape drift, not a test bug.
 *
 * Per endpoint: (a) assert the RAW fixture still carries the wrapper path + keys the
 * parser navigates, and (b) run the REAL exported parser on fixture data asserting
 * presence/types only — never exact values.
 */
import { describe, it, expect } from "vitest";
import {
  parseDiscursoResumo,
  parseDiscursoPlenario,
  buildDiscursosSenadorResult,
  DISCURSOS_SEM_PERIODO_AVISO,
} from "../../src/tools/discursos.js";
import { digArrayRoot } from "../../src/utils/upstream-parse.js";
import { ensureArray } from "../../src/utils/validation.js";
import discursosSenadorRaw from "./fixtures/legado/discursos-senador.json?raw";
import discursosPlenarioRaw from "./fixtures/legado/discursos-plenario.json?raw";

const discursosSenador = JSON.parse(discursosSenadorRaw);
const discursosPlenario = JSON.parse(discursosPlenarioRaw);

// ── /senador/{codigo}/discursos (senado_discursos_senador → parseDiscursoResumo) ──

describe("contract: /senador/{codigo}/discursos", () => {
  const pronunciamentos = ensureArray(
    discursosSenador?.DiscursosParlamentar?.Parlamentar?.Pronunciamentos?.Pronunciamento,
  ) as any[];

  it("raw fixture keeps the wrapper path and per-pronunciamento keys the parser reads", () => {
    expect(discursosSenador).toHaveProperty(
      "DiscursosParlamentar.Parlamentar.Pronunciamentos.Pronunciamento",
    );
    expect(pronunciamentos.length).toBeGreaterThan(0);
    const p0 = pronunciamentos[0];
    for (const k of [
      "CodigoPronunciamento",
      "DataPronunciamento",
      "SiglaCasaPronunciamento",
      "TextoResumo",
    ]) {
      expect(p0).toHaveProperty(k);
    }
    expect(p0.CodigoPronunciamento).toMatch(/^\d+$/);
    expect(p0.DataPronunciamento).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p0).toHaveProperty("TipoUsoPalavra.Descricao");
    // Optional: Indexacao/UrlTexto — if present, must be strings.
    if (p0.Indexacao != null) expect(typeof p0.Indexacao).toBe("string");
    if (p0.UrlTexto != null) expect(typeof p0.UrlTexto).toBe("string");
  });

  it("raw fixture keeps the NomeParlamentar header path the tool injects into items", () => {
    // The name lives ONCE at Parlamentar.IdentificacaoParlamentar, not per item.
    expect(discursosSenador).toHaveProperty(
      "DiscursosParlamentar.Parlamentar.IdentificacaoParlamentar.NomeParlamentar",
    );
    expect(
      typeof discursosSenador.DiscursosParlamentar.Parlamentar.IdentificacaoParlamentar
        .NomeParlamentar,
    ).toBe("string");
  });

  it("parseDiscursoResumo yields typed fields from each fixture pronunciamento", () => {
    for (const p of pronunciamentos) {
      const parsed = parseDiscursoResumo(p);
      expect(parsed.codigo).toBeTruthy();
      expect(typeof parsed.data).toBe("string");
      expect(typeof parsed.casa).toBe("string");
      expect(typeof parsed.tipoUsoPalavra).toBe("string");
      expect(typeof parsed.resumo).toBe("string");
      // Optional in the source: null when absent, string when present.
      expect(parsed.url === null || typeof parsed.url === "string").toBe(true);
      expect(parsed.indexacao === null || typeof parsed.indexacao === "string").toBe(true);
      // Per-item name is NOT served by this endpoint (the tool injects the header
      // name afterwards) — string only if the upstream ever adds it per item.
      expect(parsed.nomeParlamentar === null || typeof parsed.nomeParlamentar === "string").toBe(
        true,
      );
    }
  });
});

// ── /plenario/lista/discursos/{di}/{df} (senado_discursos_plenario → parseDiscursoPlenario) ──

describe("contract: /plenario/lista/discursos/{dataInicio}/{dataFim}", () => {
  // Same candidate path the tool passes to digArrayRoot.
  const sessoes = digArrayRoot(
    discursosPlenario,
    [["DiscursosSessao", "Sessoes", "Sessao"]],
    "contract:discursos-plenario",
  ) as any[];

  it("raw fixture keeps DiscursosSessao.Sessoes.Sessao[] with nested Pronunciamentos", () => {
    expect(discursosPlenario).toHaveProperty("DiscursosSessao.Sessoes.Sessao");
    expect(sessoes.length).toBeGreaterThan(0);
    for (const s of sessoes) {
      const prons = ensureArray(s?.Pronunciamentos?.Pronunciamento) as any[];
      expect(prons.length).toBeGreaterThan(0);
      const p0 = prons[0];
      // v4 field names differ from the per-senator endpoint: Data/Resumo/NomeAutor.
      for (const k of ["CodigoPronunciamento", "Data", "NomeAutor", "Partido", "UF"]) {
        expect(p0).toHaveProperty(k);
      }
      expect(p0.CodigoPronunciamento).toMatch(/^\d+$/);
      expect(p0.Data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p0).toHaveProperty("TipoUsoPalavra.Descricao");
      // Optional: full-text URL and per-item parliamentarian code — strings if present.
      if (p0.TextoIntegral != null) expect(typeof p0.TextoIntegral).toBe("string");
      if (p0.CodigoParlamentar != null) expect(typeof p0.CodigoParlamentar).toBe("string");
      if (p0.Resumo != null) expect(typeof p0.Resumo).toBe("string");
    }
  });

  it("parseDiscursoPlenario yields typed fields for every fixture pronunciamento", () => {
    const discursos = sessoes.flatMap((s: any) =>
      ensureArray(s?.Pronunciamentos?.Pronunciamento).map(parseDiscursoPlenario),
    );
    expect(discursos.length).toBeGreaterThan(0);
    for (const d of discursos) {
      expect(d.codigo).toBeTruthy();
      expect(typeof d.data).toBe("string");
      expect(typeof d.nomeParlamentar).toBe("string");
      expect(d.nomeParlamentar!.length).toBeGreaterThan(0);
      expect(typeof d.tipoUsoPalavra).toBe("string");
      // codigoParlamentar is safeInt-parsed; null only when the source omits it.
      expect(d.codigoParlamentar === null || typeof d.codigoParlamentar === "number").toBe(true);
      expect(d.partido === null || typeof d.partido === "string").toBe(true);
      expect(d.uf === null || typeof d.uf === "string").toBe(true);
      expect(d.resumo === null || typeof d.resumo === "string").toBe(true);
      expect(d.url === null || typeof d.url === "string").toBe(true);
    }
  });
});

// ── Exported pure helper (behavioral contract, no fixture) ────────────────────────

describe("contract: buildDiscursosSenadorResult", () => {
  it("attaches the 30-day-window aviso only for tipo=discursos without a period", () => {
    const noPeriod = buildDiscursosSenadorResult(123, "discursos", [], false);
    expect(noPeriod.aviso).toBe(DISCURSOS_SEM_PERIODO_AVISO);
    const withPeriod = buildDiscursosSenadorResult(123, "discursos", [], true);
    expect(withPeriod).not.toHaveProperty("aviso");
    const apartes = buildDiscursosSenadorResult(123, "apartes", [], false);
    expect(apartes).not.toHaveProperty("aviso");
  });
});
