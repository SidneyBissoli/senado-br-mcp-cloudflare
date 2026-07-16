/**
 * Upstream shape-drift contract tests for src/tools/materias.ts.
 *
 * Contract tier: runs via `npm run test:contract` (vitest.contract.config.ts),
 * NOT part of the default `npm test` suite. Fixtures in tests/contract/fixtures/
 * are raw upstream JSON captures (sorted keys, arrays truncated to 3 items),
 * refreshed by `npm run contract:refresh`. A failure right after a live refresh
 * means real upstream shape drift, not a code bug.
 *
 * materias.ts has its OWN parseProcessoResumo/parseProcessoDetalhe (distinct
 * from processos.ts — legacy output keys like `codigo`/`idProcesso` are kept
 * stable for the buscar_materias/obter_materia tools). Presence/shape only —
 * never exact values.
 */
import { describe, it, expect } from "vitest";
import {
  parseProcessoResumo,
  parseProcessoDetalhe,
  pickRelatorAtual,
  parseInformesTramitacao,
  parseDocumentoProcesso,
  ensureISODate,
} from "../../src/tools/materias.js";
import processoListaRaw from "./fixtures/v3/processo-lista.json?raw";
import processoDetalheRaw from "./fixtures/v3/processo-detalhe.json?raw";
import processoRelatoriaRaw from "./fixtures/v3/processo-relatoria.json?raw";
import processoDocumentoRaw from "./fixtures/v3/processo-documento.json?raw";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

// ── /processo (search list → materias' parseProcessoResumo) ───────────────

describe("contract: /processo list feeds materias' parseProcessoResumo", () => {
  const items = JSON.parse(processoListaRaw);

  it("raw fixture carries the keys the parser depends on (incl. the identificacao it derives sigla/numero/ano from)", () => {
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      for (const k of ["id", "codigoMateria", "identificacao", "ementa", "dataApresentacao", "tramitando"]) {
        expect(item, `key "${k}" missing from /processo item`).toHaveProperty(k);
      }
      // list items carry no sigla/numero/ano — the parser regexes them out of
      // identificacao, so the "SIGLA N/AAAA" format is itself the contract
      expect(item.identificacao).toMatch(/^\S+\s+\d+\/\d{4}/);
      // optional: situacaoAtual/urlDocumento — if present, strings
      if (item.situacaoAtual != null) expect(typeof item.situacaoAtual).toBe("string");
      if (item.urlDocumento != null) expect(typeof item.urlDocumento).toBe("string");
    }
  });

  it("parseProcessoResumo yields defined/typed fields from the fixture", () => {
    for (const parsed of items.map(parseProcessoResumo)) {
      expect(typeof parsed.sigla).toBe("string");
      expect(parsed.sigla.length).toBeGreaterThan(0);
      expect(typeof parsed.numero).toBe("number");
      expect(parsed.numero).toBeGreaterThan(0);
      expect(typeof parsed.ano).toBe("number");
      expect(parsed.ano).toBeGreaterThan(1900);
      expect(typeof parsed.identificacao).toBe("string");
      expect(parsed.dataApresentacao).toMatch(ISO_DATE);
      expect(typeof parsed.ementa).toBe("string");
      expect(typeof parsed.tramitando).toBe("boolean");
      expect(typeof parsed.codigo).toBe("number");
      expect(typeof parsed.idProcesso).toBe("number");
    }
  });
});

// ── /processo/{id} (detail → parseProcessoDetalhe + parseInformesTramitacao) ─

describe("contract: /processo/{id} detail feeds materias' parseProcessoDetalhe", () => {
  const det = JSON.parse(processoDetalheRaw);

  it("raw fixture carries the nested keys the parser depends on", () => {
    for (const k of ["id", "codigoMateria", "identificacao", "sigla", "numero", "ano", "tramitando", "situacaoAtual", "dataSituacaoAtual", "autuacoes"]) {
      expect(det, `key "${k}" missing from /processo/{id}`).toHaveProperty(k);
    }
    expect(det.documento.dataApresentacao).toMatch(ISO_DATE);
    // autoriaIniciativa[0] gives autor/tipoAutor
    const autoria = det.autoriaIniciativa;
    expect(Array.isArray(autoria)).toBe(true);
    expect(autoria.length).toBeGreaterThan(0);
    expect(typeof autoria[0].autor).toBe("string");
    // autuacoes[0] gives localAtual
    expect(Array.isArray(det.autuacoes)).toBe(true);
    expect(det.autuacoes.length).toBeGreaterThan(0);
    expect(typeof det.autuacoes[0].nomeEnteControleAtual).toBe("string");
    // classificacoes rows carry descricaoHierarquia (or descricao)
    for (const c of det.classificacoes ?? []) {
      expect(typeof (c.descricaoHierarquia ?? c.descricao)).toBe("string");
    }
  });

  it("parseProcessoDetalhe (materias.ts version) yields defined/typed fields", () => {
    const parsed = parseProcessoDetalhe(det);
    expect(typeof parsed.codigo).toBe("number");
    expect(typeof parsed.idProcesso).toBe("number");
    expect(typeof parsed.sigla).toBe("string");
    expect(parsed.sigla.length).toBeGreaterThan(0);
    // safeInt coerces the string "numero" upstream field
    expect(typeof parsed.numero).toBe("number");
    expect(typeof parsed.ano).toBe("number");
    expect(typeof parsed.identificacao).toBe("string");
    expect(typeof parsed.autor).toBe("string");
    expect(typeof parsed.situacao).toBe("string");
    expect(typeof parsed.localAtual).toBe("string");
    expect(parsed.dataApresentacao).toMatch(ISO_DATE);
    expect(typeof parsed.tramitando).toBe("boolean");
    expect(Array.isArray(parsed.classificacoes)).toBe(true);
    // empty {} upstream objects must collapse to null, not leak as {}
    expect(parsed.deliberacao).toBeNull();
    expect(parsed.normaGerada).toBeNull();
    // optional: indexacao — string or null (trimmed when string)
    expect(parsed.indexacao === null || typeof parsed.indexacao === "string").toBe(true);
  });

  it("parseInformesTramitacao flattens autuacoes[].informesLegislativos[] with data/local/descricao", () => {
    // raw contract: informesLegislativos rows carry data + descricao + colegiado.nome
    const informesRaw = det.autuacoes[0].informesLegislativos;
    expect(Array.isArray(informesRaw)).toBe(true);
    expect(informesRaw.length).toBeGreaterThan(0);
    expect(typeof informesRaw[0].data).toBe("string");
    expect(typeof informesRaw[0].descricao).toBe("string");
    expect(typeof (informesRaw[0].colegiado?.nome ?? informesRaw[0].enteAdministrativo?.nome)).toBe("string");

    const informes = parseInformesTramitacao(det);
    expect(informes.length).toBeGreaterThan(0);
    for (const inf of informes) {
      expect(typeof inf.data).toBe("string");
      expect(inf.data.length).toBeGreaterThan(0);
      expect(typeof inf.descricao).toBe("string");
      expect(inf.local === null || typeof inf.local === "string").toBe(true);
    }
  });
});

// ── /processo/relatoria (→ pickRelatorAtual) ──────────────────────────────

describe("contract: /processo/relatoria feeds pickRelatorAtual", () => {
  const items = JSON.parse(processoRelatoriaRaw);

  it("raw fixture carries the keys pickRelatorAtual depends on", () => {
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      // parser-critical: name + designation/destitution dates drive the pick
      expect("nomeParlamentar" in item || "nomeCompleto" in item).toBe(true);
      for (const k of ["dataDesignacao", "dataDestituicao"]) {
        expect(item, `key "${k}" missing from relatoria item`).toHaveProperty(k);
      }
    }
  });

  it("pickRelatorAtual yields a defined/typed rapporteur from the fixture", () => {
    const relator = pickRelatorAtual(items);
    expect(relator).not.toBeNull();
    expect(typeof relator!.nome).toBe("string");
    expect(relator!.nome.length).toBeGreaterThan(0);
    expect(relator!.tipo === null || typeof relator!.tipo === "string").toBe(true);
    expect(relator!.partido === null || typeof relator!.partido === "string").toBe(true);
    expect(relator!.uf === null || typeof relator!.uf === "string").toBe(true);
    expect(relator!.comissao === null || typeof relator!.comissao === "string").toBe(true);
    expect(relator!.dataDesignacao).toMatch(ISO_DATE);
  });
});

// ── /processo/documento (→ parseDocumentoProcesso) ────────────────────────

describe("contract: /processo/documento feeds parseDocumentoProcesso", () => {
  const items = JSON.parse(processoDocumentoRaw);

  it("raw fixture carries the keys the parser depends on", () => {
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      // parser-critical: type descriptor + identity + url
      expect("descricaoTipo" in item || "siglaTipo" in item).toBe(true);
      for (const k of ["identificacao", "dataDocumento", "autoria", "urlDocumento"]) {
        expect(item, `key "${k}" missing from /processo/documento item`).toHaveProperty(k);
      }
      expect(typeof item.identificacao).toBe("string");
      expect(typeof item.urlDocumento).toBe("string");
      // dataDocumento is null for some rows in the capture — if present, ISO date
      if (item.dataDocumento != null) expect(item.dataDocumento).toMatch(ISO_DATE);
    }
  });

  it("parseDocumentoProcesso yields defined/typed fields from the fixture", () => {
    for (const parsed of items.map(parseDocumentoProcesso)) {
      expect(typeof parsed.tipo).toBe("string");
      expect(parsed.tipo.length).toBeGreaterThan(0);
      expect(typeof parsed.identificacao).toBe("string");
      expect(typeof parsed.url).toBe("string");
      expect(parsed.url.length).toBeGreaterThan(0);
      expect(typeof parsed.autoria).toBe("string");
      // data: string or null (dataDocumento can be null upstream)
      expect(parsed.data === null || typeof parsed.data === "string").toBe(true);
      expect(parsed.formato === null || typeof parsed.formato === "string").toBe(true);
    }
  });
});

// ── date-format helper contract ────────────────────────────────────────────

describe("contract: ensureISODate (materias.ts) accepts the fixture date styles", () => {
  it("passes ISO dates through and converts YYYYMMDD", () => {
    const items = JSON.parse(processoListaRaw);
    expect(ensureISODate(items[0].dataApresentacao)).toBe(items[0].dataApresentacao);
    expect(ensureISODate("20240101")).toBe("2024-01-01");
  });
});
