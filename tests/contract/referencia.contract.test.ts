/**
 * Upstream shape-drift contract tests for the REFERENCE-TABLES tool module
 * (src/tools/referencia.ts — senado_tabelas_referencia).
 *
 * Runs in the CONTRACT tier (`npm run test:contract`, config
 * vitest.contract.config.ts) — excluded from the default `npm test` suite.
 * Fixtures in tests/contract/fixtures/legado/ are raw upstream JSON captures
 * (sorted keys, arrays truncated to 3 items), refreshed by
 * `npm run contract:refresh`. A failure right after a live refresh means the
 * upstream changed shape (renamed wrapper / dropped field), not a code bug.
 *
 * TIPOS_MATERIA and UFS are bundled snapshots maintained in code — no upstream
 * contract to test. The remaining tabelas derive from /senador/lista/atual,
 * /legislacao/tiposNorma and /senador/lista/tiposUsoPalavra, covered below.
 */
import { describe, it, expect } from "vitest";
import {
  extractParlamentares,
  parseLegislaturaVigente,
  tabularPartidos,
  tabularUfs,
} from "../../src/tools/referencia.js";
import { digArrayRoot } from "../../src/utils/upstream-parse.js";
import { ensureArray } from "../../src/utils/validation.js";
import senadorListaAtualRaw from "./fixtures/legado/senador-lista-atual.json?raw";
import legislaturaNaDataRaw from "./fixtures/legado/plenario-legislatura-na-data.json?raw";
import tiposNormaRaw from "./fixtures/legado/tipos-norma.json?raw";
import tiposUsoPalavraRaw from "./fixtures/legado/tipos-uso-palavra.json?raw";

const listaAtual = JSON.parse(senadorListaAtualRaw);
const legislaturaNaData = JSON.parse(legislaturaNaDataRaw);
const tiposNorma = JSON.parse(tiposNormaRaw);
const tiposUsoPalavra = JSON.parse(tiposUsoPalavraRaw);

// ── /plenario/legislatura/{data} — source for legislatura-atual ──────────

describe("contract: /plenario/legislatura/{data} (legislatura-atual)", () => {
  it("raw fixture carries the wrapper path and the keys the parser reads", () => {
    expect(legislaturaNaData).toHaveProperty("ListaLegislatura.Legislaturas.Legislatura");
    const leg = ensureArray(legislaturaNaData.ListaLegislatura.Legislaturas.Legislatura)[0] as any;
    for (const k of ["NumeroLegislatura", "DataInicio", "DataFim"]) expect(leg).toHaveProperty(k);
    expect(typeof leg.NumeroLegislatura).toBe("string");
  });

  it("parseLegislaturaVigente yields the legislature in force on the capture date", () => {
    const leg = parseLegislaturaVigente(legislaturaNaData);
    expect(leg.numero).toBeGreaterThanOrEqual(57); // the capture is never older than 2026
    expect(leg.periodo).toMatch(/^\d{4}-\d{4}$/);
    expect(leg.dataInicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(leg.dataFim > leg.dataInicio).toBe(true);
  });
});

// ── /senador/lista/atual — source for partidos and ufs ──────────────────

describe("contract: /senador/lista/atual (referencia derivations)", () => {
  it("raw fixture carries the wrapper path and the keys the tabulators read", () => {
    expect(listaAtual).toHaveProperty("ListaParlamentarEmExercicio.Parlamentares.Parlamentar");
    const items = listaAtual.ListaParlamentarEmExercicio.Parlamentares.Parlamentar;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    // tabularPartidos falls back to IdentificacaoParlamentar.SiglaPartidoParlamentar
    // (Mandato.Partido is NOT served by this endpoint's current shape)
    expect(items[0]).toHaveProperty("IdentificacaoParlamentar.SiglaPartidoParlamentar");
    // tabularUfs reads Mandato.UfParlamentar (fallback IdentificacaoParlamentar.UfParlamentar)
    expect(items[0]).toHaveProperty("Mandato.UfParlamentar");
  });

  it("extractParlamentares resolves the list", () => {
    const parlamentares = extractParlamentares(listaAtual);
    expect(parlamentares.length).toBeGreaterThan(0);
  });

  it("tabularPartidos resolves real party siglas (not the S/Partido fallback)", () => {
    const parlamentares = extractParlamentares(listaAtual);
    const partidos = tabularPartidos(parlamentares);
    expect(partidos.length).toBeGreaterThan(0);
    let total = 0;
    for (const p of partidos) {
      expect(typeof p.sigla).toBe("string");
      expect(p.sigla.length).toBeGreaterThan(0);
      expect(typeof p.nome).toBe("string");
      expect(p.senadores).toBeGreaterThanOrEqual(1);
      total += p.senadores;
    }
    expect(total).toBe(parlamentares.length);
    // If EVERY group is "S/Partido", the party field moved upstream — that's drift
    expect(partidos.some((p) => p.sigla !== "S/Partido")).toBe(true);
    // Sorted by bench size desc
    for (let i = 1; i < partidos.length; i++) {
      expect(partidos[i - 1].senadores).toBeGreaterThanOrEqual(partidos[i].senadores);
    }
  });

  it("tabularUfs attributes senators to UFs", () => {
    const parlamentares = extractParlamentares(listaAtual);
    const ufs = tabularUfs(parlamentares);
    expect(ufs).toHaveLength(27); // always the full bundled UF table
    for (const u of ufs) {
      expect(u.sigla).toMatch(/^[A-Z]{2}$/);
      expect(u.nome.length).toBeGreaterThan(0);
      expect(typeof u.senadores).toBe("number");
    }
    // If no senator lands on any UF, the UF field moved upstream — that's drift
    const atribuidos = ufs.reduce((s, u) => s + u.senadores, 0);
    expect(atribuidos).toBeGreaterThan(0);
    expect(atribuidos).toBeLessThanOrEqual(parlamentares.length);
  });
});

// ── /legislacao/tiposNorma — ListaTiposDocumento wrapper ──────────────────

describe("contract: /legislacao/tiposNorma", () => {
  it("raw fixture carries the wrapper path and the keys the tool reads", () => {
    expect(tiposNorma).toHaveProperty("ListaTiposDocumento.TiposDocumento.TipoDocumento");
    const items = tiposNorma.ListaTiposDocumento.TiposDocumento.TipoDocumento;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    // PascalCase in the current capture; the tool also tolerates lowercase
    expect("Sigla" in items[0] || "sigla" in items[0]).toBe(true);
    expect("Descricao" in items[0] || "descricao" in items[0]).toBe(true);
  });

  it("the tool's inline mapping (digArrayRoot + Sigla/Descricao fallbacks) yields values", () => {
    // The mapping is inline in the tool callback, so we replicate it here 1:1
    const tipos = digArrayRoot(
      tiposNorma,
      [["ListaTiposDocumento", "TiposDocumento", "TipoDocumento"]],
      "contract:tipos-norma",
    ).map((t: any) => ({
      sigla: t.Sigla || t.sigla || null,
      descricao: t.Descricao || t.descricao || null,
    }));
    expect(tipos.length).toBeGreaterThan(0);
    for (const t of tipos) {
      expect(typeof t.sigla).toBe("string");
      expect(t.sigla.length).toBeGreaterThan(0);
      expect(typeof t.descricao).toBe("string");
      expect(t.descricao.length).toBeGreaterThan(0);
    }
  });
});

// ── /senador/lista/tiposUsoPalavra — ListaTiposUsoPalavra wrapper ─────────

describe("contract: /senador/lista/tiposUsoPalavra", () => {
  it("raw fixture carries the wrapper path and the keys the tool reads", () => {
    expect(tiposUsoPalavra).toHaveProperty("ListaTiposUsoPalavra.TiposUsoPalavra.TipoUsoPalavra");
    const items = tiposUsoPalavra.ListaTiposUsoPalavra.TiposUsoPalavra.TipoUsoPalavra;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    // PascalCase in the current capture; the tool also tolerates lowercase
    expect("Codigo" in items[0] || "codigo" in items[0]).toBe(true);
    expect("Descricao" in items[0] || "descricao" in items[0]).toBe(true);
  });

  it("the tool's inline mapping (wrapper fallbacks + Codigo/Descricao) yields values", () => {
    // The mapping is inline in the tool callback, so we replicate it here 1:1
    const r = tiposUsoPalavra as any;
    const tipos = ensureArray(
      r?.ListaTiposUsoPalavra?.TiposUsoPalavra?.TipoUsoPalavra ??
        r?.TiposUsoPalavra?.TipoUsoPalavra,
    ).map((t: any) => ({
      codigo: t.Codigo || t.codigo || null,
      descricao: t.Descricao || t.descricao || null,
    }));
    expect(tipos.length).toBeGreaterThan(0);
    for (const t of tipos) {
      // Codigo arrives as a numeric STRING in the legacy PascalCase style
      expect(typeof t.codigo).toBe("string");
      expect(t.codigo).toMatch(/^\d+$/);
      expect(typeof t.descricao).toBe("string");
      expect(t.descricao.length).toBeGreaterThan(0);
    }
  });
});
