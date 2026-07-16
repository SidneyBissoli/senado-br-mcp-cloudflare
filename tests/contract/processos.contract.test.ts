/**
 * Upstream shape-drift contract tests for src/tools/processos.ts.
 *
 * Contract tier: runs via `npm run test:contract` (vitest.contract.config.ts),
 * NOT part of the default `npm test` suite. Fixtures in tests/contract/fixtures/
 * are raw upstream JSON captures (sorted keys, arrays truncated to 3 items),
 * refreshed by `npm run contract:refresh`. A failure right after a live refresh
 * means real upstream shape drift, not a code bug.
 *
 * Per endpoint: (a) the RAW fixture still carries the wrapper/root and keys the
 * parser depends on, and (b) the REAL exported parser produces defined/typed
 * fields from the fixture. Presence/shape only — never exact values.
 */
import { describe, it, expect } from "vitest";
import {
  parseProcessoResumo,
  parseProcessoDetalhe,
  parseEmendaProcesso,
  parseRelatoriaProcesso,
  parseAutorAtual,
  ensureISODate,
  normalizeTramitando,
  compactAutoria,
  TABELAS_PROCESSO,
} from "../../src/tools/processos.js";
import processoListaRaw from "./fixtures/v3/processo-lista.json?raw";
import processoDetalheRaw from "./fixtures/v3/processo-detalhe.json?raw";
import processoEmendaRaw from "./fixtures/v3/processo-emenda.json?raw";
import processoRelatoriaRaw from "./fixtures/v3/processo-relatoria.json?raw";
import autoresAtuaisRaw from "./fixtures/legado/autores-atuais.json?raw";
import tabelasSiglasRaw from "./fixtures/v3/tabelas-processo-siglas.json?raw";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

// ── /processo (search list, flat camelCase root array) ────────────────────

describe("contract: /processo list (v3)", () => {
  const items = JSON.parse(processoListaRaw);

  it("raw fixture is a flat root array carrying the keys parseProcessoResumo depends on", () => {
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      // parser-critical fields — strict presence
      for (const k of ["id", "codigoMateria", "identificacao", "ementa", "autoria", "dataApresentacao", "tramitando"]) {
        expect(item, `key "${k}" missing from /processo item`).toHaveProperty(k);
      }
      expect(typeof item.id).toBe("number");
      expect(typeof item.codigoMateria).toBe("number");
      expect(typeof item.identificacao).toBe("string");
      expect(item.dataApresentacao).toMatch(ISO_DATE);
      // tramitando must still be a value normalizeTramitando understands
      expect(normalizeTramitando(item.tramitando)).not.toBeNull();
      // autoria must still be a compactAutoria-splittable author string
      expect(compactAutoria(item.autoria).totalAutores).toBeGreaterThan(0);
      // optional: tipoDocumento — if present, string
      if (item.tipoDocumento != null) expect(typeof item.tipoDocumento).toBe("string");
    }
  });

  it("parseProcessoResumo yields defined/typed fields from the fixture", () => {
    for (const parsed of items.map(parseProcessoResumo)) {
      expect(typeof parsed.id).toBe("number");
      expect(typeof parsed.codigoMateria).toBe("number");
      expect(typeof parsed.identificacao).toBe("string");
      expect((parsed.identificacao as string).length).toBeGreaterThan(0);
      expect(typeof parsed.ementa).toBe("string");
      expect(parsed.dataApresentacao).toMatch(ISO_DATE);
      expect(typeof parsed.autoria).toBe("string");
      expect(parsed.totalAutores).toBeGreaterThan(0);
      expect(typeof parsed.tramitando).toBe("boolean");
      // dataDeliberacao/normaGerada are absent from list items in the capture → null
      expect(parsed).toHaveProperty("dataDeliberacao");
      expect(parsed).toHaveProperty("normaGerada");
    }
  });
});

// ── /processo/{id} (detail, flat camelCase single object) ─────────────────

describe("contract: /processo/{id} detail (v3)", () => {
  const det = JSON.parse(processoDetalheRaw);

  it("raw fixture carries the nested keys parseProcessoDetalhe depends on", () => {
    // parser-critical top-level fields — strict presence
    for (const k of ["id", "codigoMateria", "identificacao", "sigla", "numero", "ano", "objetivo", "tramitando", "situacaoAtual", "dataSituacaoAtual"]) {
      expect(det, `key "${k}" missing from /processo/{id}`).toHaveProperty(k);
    }
    expect(typeof det.id).toBe("number");
    expect(typeof det.codigoMateria).toBe("number");
    // parser-critical nested containers
    expect(det).toHaveProperty("conteudo");
    expect(typeof det.conteudo.ementa).toBe("string");
    expect(det).toHaveProperty("documento");
    expect(det.documento.dataApresentacao).toMatch(ISO_DATE);
    expect(typeof det.documento.resumoAutoria).toBe("string");
    expect(typeof det.documento.url).toBe("string");
    // deliberacao/normaGerada arrive as objects (empty {} when absent in fact)
    expect(typeof det.deliberacao).toBe("object");
    expect(typeof det.normaGerada).toBe("object");
    // optional: indexacao — if present, string
    if (det.documento.indexacao != null) expect(typeof det.documento.indexacao).toBe("string");
  });

  it("parseProcessoDetalhe (processos.ts version) yields defined/typed fields", () => {
    const parsed = parseProcessoDetalhe(det);
    expect(typeof parsed.id).toBe("number");
    expect(typeof parsed.codigoMateria).toBe("number");
    expect(typeof parsed.identificacao).toBe("string");
    expect(typeof parsed.sigla).toBe("string");
    expect(parsed.numero).not.toBeNull();
    expect(parsed.ano).not.toBeNull();
    expect(typeof parsed.ementa).toBe("string");
    expect((parsed.ementa as string).length).toBeGreaterThan(0);
    expect(parsed.dataApresentacao).toMatch(ISO_DATE);
    expect(typeof parsed.autoria).toBe("string");
    expect(typeof parsed.tramitando).toBe("boolean");
    expect(typeof parsed.situacaoAtual).toBe("string");
    expect(parsed.dataSituacaoAtual).toMatch(ISO_DATE);
    // empty {} upstream objects must collapse to null, not leak as {}
    expect(parsed.deliberacao).toBeNull();
    expect(parsed.normaGerada).toBeNull();
  });
});

// ── /processo/emenda (flat root array) ────────────────────────────────────

describe("contract: /processo/emenda (v3)", () => {
  const items = JSON.parse(processoEmendaRaw);

  it("raw fixture carries the keys parseEmendaProcesso depends on", () => {
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      for (const k of ["id", "identificacao", "numero", "tipo", "autoria", "dataApresentacao", "decisoes"]) {
        expect(item, `key "${k}" missing from /processo/emenda item`).toHaveProperty(k);
      }
      expect(typeof item.id).toBe("number");
      expect(typeof item.identificacao).toBe("string");
      expect(item.dataApresentacao).toMatch(ISO_DATE);
      // decisoes is null in the capture (no decision yet) — if present, array of objects
      if (item.decisoes != null) expect(Array.isArray(item.decisoes)).toBe(true);
      // optional colegiado/url fields — if present, strings
      if (item.siglaColegiado != null) expect(typeof item.siglaColegiado).toBe("string");
      if (item.urlDocumentoEmenda != null) expect(typeof item.urlDocumentoEmenda).toBe("string");
    }
  });

  it("parseEmendaProcesso yields defined/typed fields from the fixture", () => {
    for (const parsed of items.map(parseEmendaProcesso)) {
      expect(typeof parsed.id).toBe("number");
      expect(typeof parsed.identificacao).toBe("string");
      expect(parsed.numero).not.toBeNull();
      expect(typeof parsed.tipo).toBe("string");
      expect(typeof parsed.autoria).toBe("string");
      expect(parsed.data).toMatch(ISO_DATE);
      // decisoes: null upstream → normalized to [] (never null)
      expect(Array.isArray(parsed.decisoes)).toBe(true);
    }
  });
});

// ── /processo/relatoria (flat root array) ─────────────────────────────────

describe("contract: /processo/relatoria (v3)", () => {
  const items = JSON.parse(processoRelatoriaRaw);

  it("raw fixture carries the keys parseRelatoriaProcesso depends on", () => {
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      for (const k of ["idProcesso", "codigoMateria", "nomeParlamentar", "dataDesignacao", "siglaColegiado", "dataDestituicao"]) {
        expect(item, `key "${k}" missing from /processo/relatoria item`).toHaveProperty(k);
      }
      expect(typeof item.idProcesso).toBe("number");
      expect(typeof item.codigoMateria).toBe("number");
      expect(typeof item.nomeParlamentar).toBe("string");
      expect(item.dataDesignacao).toMatch(ISO_DATE);
      // optional descriptors — if present, strings
      if (item.descricaoTipoRelator != null) expect(typeof item.descricaoTipoRelator).toBe("string");
      if (item.siglaPartidoParlamentar != null) expect(typeof item.siglaPartidoParlamentar).toBe("string");
      if (item.ufParlamentar != null) expect(typeof item.ufParlamentar).toBe("string");
    }
  });

  it("parseRelatoriaProcesso yields defined/typed fields from the fixture", () => {
    for (const parsed of items.map(parseRelatoriaProcesso)) {
      expect(typeof parsed.idProcesso).toBe("number");
      expect(typeof parsed.codigoMateria).toBe("number");
      expect(typeof parsed.relator).toBe("string");
      expect(parsed.relator.length).toBeGreaterThan(0);
      expect(parsed.dataDesignacao).toMatch(ISO_DATE);
      expect(typeof parsed.comissao).toBe("string");
      // dataDestituicao is null for an active designation — string or null
      expect(parsed.dataDestituicao === null || typeof parsed.dataDestituicao === "string").toBe(true);
    }
  });
});

// ── /autor/lista/atual (legacy PascalCase wrapper) ────────────────────────

describe("contract: /autor/lista/atual (legacy)", () => {
  const root = JSON.parse(autoresAtuaisRaw);

  it("raw fixture keeps the ListaAutores.Autores.Autor[] wrapper and item keys", () => {
    const autores = root?.ListaAutores?.Autores?.Autor;
    expect(Array.isArray(autores)).toBe(true);
    expect(autores.length).toBeGreaterThan(0);
    for (const a of autores) {
      // parser-critical fields — strict presence (legacy values arrive as strings)
      for (const k of ["CodigoParlamentar", "NomeParlamentar", "QuantidadeMaterias"]) {
        expect(a, `key "${k}" missing from Autor item`).toHaveProperty(k);
      }
      expect(typeof a.NomeParlamentar).toBe("string");
      // optional: UfParlamentar is absent for some (ex-)deputados — if present, string
      if (a.UfParlamentar != null) expect(typeof a.UfParlamentar).toBe("string");
    }
  });

  it("parseAutorAtual yields defined/typed fields from the fixture", () => {
    const autores = root.ListaAutores.Autores.Autor;
    for (const parsed of autores.map(parseAutorAtual)) {
      // legacy string codes must be coerced to numbers
      expect(typeof parsed.codigo).toBe("number");
      expect(typeof parsed.nome).toBe("string");
      expect(parsed.nome.length).toBeGreaterThan(0);
      expect(typeof parsed.quantidadeMaterias).toBe("number");
      expect(parsed.uf === null || typeof parsed.uf === "string").toBe(true);
    }
  });
});

// ── /processo/siglas (reference table, flat root array) ───────────────────

describe("contract: /processo/siglas reference table (v3)", () => {
  it("raw fixture is a non-empty flat array of object rows", () => {
    const linhas = JSON.parse(tabelasSiglasRaw);
    expect(Array.isArray(linhas)).toBe(true);
    expect(linhas.length).toBeGreaterThan(0);
    for (const linha of linhas) {
      expect(typeof linha).toBe("object");
      expect(linha).not.toBeNull();
      expect(Array.isArray(linha)).toBe(false);
    }
  });

  it("TABELAS_PROCESSO still routes the 'siglas' table to /processo/siglas", () => {
    expect(TABELAS_PROCESSO["siglas"]).toBe("/processo/siglas");
  });
});

// ── date-format helper contract (fixture dates flow through ensureISODate) ─

describe("contract: ensureISODate accepts the fixture date styles", () => {
  it("passes ISO dates through and converts YYYYMMDD", () => {
    const items = JSON.parse(processoListaRaw);
    // fixture dates are already ISO — must pass through unchanged
    expect(ensureISODate(items[0].dataApresentacao)).toBe(items[0].dataApresentacao);
    // compact form still converts (tool inputs accept YYYYMMDD)
    expect(ensureISODate("20240101")).toBe("2024-01-01");
  });
});
