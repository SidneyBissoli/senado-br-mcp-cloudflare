/**
 * Upstream shape-drift contract tests for the SENATORS/ADMIN tool module
 * (src/tools/senadores-admin.ts) — administrative API (adm.senado.gov.br).
 *
 * Runs in the CONTRACT tier (`npm run test:contract`, config
 * vitest.contract.config.ts) — excluded from the default `npm test` suite.
 * Fixtures in tests/contract/fixtures/adm/ are raw upstream JSON captures
 * (sorted keys, arrays truncated to 3 items), refreshed by
 * `npm run contract:refresh`. A failure right after a live refresh means the
 * upstream changed shape (renamed field / envelope change), not a code bug.
 *
 * Per dataset: (a) the RAW fixture still carries the envelope + record keys
 * the tool reads; (b) the REAL exported CEAPS helpers produce well-typed
 * output. Presence/shape only — never exact values (fixtures get refreshed).
 */
import { describe, it, expect } from "vitest";
import {
  parseCeapsItem,
  valorCeaps,
  filtrarCeaps,
  agregarCeaps,
  estatisticasCeaps,
} from "../../src/tools/senadores-admin.js";
import { unwrapAdmEnvelope } from "../../src/utils/upstream-parse.js";
import { ensureArray } from "../../src/utils/validation.js";
import ceapsRaw from "./fixtures/adm/ceaps.json?raw";
import auxilioMoradiaRaw from "./fixtures/adm/auxilio-moradia.json?raw";
import escritoriosRaw from "./fixtures/adm/escritorios.json?raw";
import aposentadosRaw from "./fixtures/adm/aposentados.json?raw";

const ceaps = JSON.parse(ceapsRaw);
const auxilioMoradia = JSON.parse(auxilioMoradiaRaw);
const escritorios = JSON.parse(escritoriosRaw);
const aposentados = JSON.parse(aposentadosRaw);

// ── /senadores/despesas_ceaps/{ano} — flat array, no envelope ─────────────

describe("contract: CEAPS dataset", () => {
  // Every field the tool's filters/aggregation/statistics depend on
  const CRITICAL_FIELDS = [
    "valorReembolsado",
    "nomeSenador",
    "codSenador",
    "mes",
    "data",
    "tipoDespesa",
    "fornecedor",
    "cpfCnpj",
    "detalhamento",
  ] as const;

  it("raw fixture is a flat array carrying ALL parser-critical fields", () => {
    expect(Array.isArray(ceaps)).toBe(true);
    expect(ceaps.length).toBeGreaterThan(0);
    for (const field of CRITICAL_FIELDS) {
      // Strictly present on at least one row (rows may have null optionals)
      expect(ceaps.some((r: any) => field in r)).toBe(true);
    }
    // Type contract on a row that carries the monetary value
    const row = ceaps.find((r: any) => r.valorReembolsado != null);
    expect(row).toBeDefined();
    expect(typeof row.valorReembolsado).toBe("number");
    expect(typeof row.codSenador).toBe("number");
    expect(typeof row.mes).toBe("number");
    expect(typeof row.nomeSenador).toBe("string");
  });

  it("valorCeaps reads a positive monetary total from the fixture rows", () => {
    const total = ceaps.reduce((s: number, r: any) => s + valorCeaps(r), 0);
    expect(Number.isFinite(total)).toBe(true);
    expect(total).toBeGreaterThan(0);
    for (const r of ceaps) expect(typeof valorCeaps(r)).toBe("number");
  });

  it("parseCeapsItem yields a well-typed detail row", () => {
    const item = parseCeapsItem(ceaps[0]);
    expect(typeof item.mes).toBe("number");
    expect(item.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof item.senador).toBe("string");
    expect(item.senador.length).toBeGreaterThan(0);
    expect(typeof item.codSenador).toBe("number");
    expect(item.codSenador).toBeGreaterThan(0);
    expect(typeof item.tipoDespesa).toBe("string");
    expect(item.tipoDespesa.length).toBeGreaterThan(0);
    expect(typeof item.fornecedor).toBe("string");
    expect(typeof item.cnpjCpf).toBe("string");
    expect(typeof item.detalhamento).toBe("string");
    expect(typeof item.valor).toBe("number");
  });

  it("filtrarCeaps matches on the real field names", () => {
    const cod = ceaps[0].codSenador as number;
    const porCodigo = filtrarCeaps(ceaps, { codSenador: cod });
    expect(porCodigo.length).toBeGreaterThan(0);
    for (const r of porCodigo) expect(r.codSenador).toBe(cod);
    // A nonsense name must filter everything out (proves the field is being read)
    expect(filtrarCeaps(ceaps, { nomeSenador: "zzz-nao-existe-zzz" })).toHaveLength(0);
  });

  it("agregarCeaps groups and totals the fixture rows", () => {
    const agregado = agregarCeaps(ceaps, (d: any) => d.codSenador ?? 0, (d: any) => ({ senador: d.nomeSenador || null }));
    expect(agregado.length).toBeGreaterThan(0);
    for (const g of agregado) {
      expect(g.chave).toBeDefined();
      expect(typeof g.total).toBe("number");
      expect(g.total).toBeGreaterThan(0);
      expect(g.despesas).toBeGreaterThanOrEqual(1);
    }
    // Sorted by total desc
    for (let i = 1; i < agregado.length; i++) {
      expect(agregado[i - 1].total).toBeGreaterThanOrEqual(agregado[i].total);
    }
  });

  it("estatisticasCeaps computes a distribution + ranking over the fixture rows", () => {
    const semGrupo = estatisticasCeaps(ceaps, { topN: 3 }) as any;
    expect(semGrupo.distribuicao).toBeDefined();
    expect(semGrupo.distribuicao.n).toBe(ceaps.length);
    expect(typeof semGrupo.distribuicao.soma).toBe("number");
    expect(typeof semGrupo.distribuicao.minimo).toBe("number");
    expect(typeof semGrupo.distribuicao.maximo).toBe("number");
    expect(typeof semGrupo.distribuicao.media).toBe("number");
    expect(typeof semGrupo.distribuicao.mediana).toBe("number");
    expect(Array.isArray(semGrupo.distribuicao.percentis)).toBe(true);
    expect(Array.isArray(semGrupo.top)).toBe(true);
    expect(semGrupo.top.length).toBeGreaterThan(0);
    expect(typeof semGrupo.top[0].valor).toBe("number");
    // The identifier fields carried into the ranking come from the real dataset fields
    expect(semGrupo.top[0]).toHaveProperty("senador");
    expect(semGrupo.top[0]).toHaveProperty("codSenador");

    const porSenador = estatisticasCeaps(ceaps, { agruparPor: "senador", topN: 3 }) as any;
    expect(porSenador.totalGrupos).toBeGreaterThan(0);
    expect(Array.isArray(porSenador.grupos)).toBe(true);
    expect(typeof porSenador.grupos[0].grupo).toBe("string");
    expect(typeof porSenador.grupos[0].soma).toBe("number");
  });
});

// ── /senadores/auxilio-moradia — {statusCode,msg,data} envelope ───────────

describe("contract: auxilio-moradia dataset", () => {
  it("raw fixture keeps the adm envelope and the record keys the tool reads", () => {
    expect(auxilioMoradia).toHaveProperty("statusCode");
    expect(auxilioMoradia).toHaveProperty("data");
    const rows = ensureArray(unwrapAdmEnvelope(auxilioMoradia));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows as any[]) {
      expect(r).toHaveProperty("nomeParlamentar");
      expect(r).toHaveProperty("estadoEleito");
      expect(r).toHaveProperty("partidoEleito");
      expect(r).toHaveProperty("auxilioMoradia");
      expect(r).toHaveProperty("imovelFuncional");
    }
  });

  it("records are well-typed after unwrapAdmEnvelope (same unwrap the tool uses)", () => {
    const rows = ensureArray(unwrapAdmEnvelope(auxilioMoradia)) as any[];
    for (const r of rows) {
      expect(typeof r.nomeParlamentar).toBe("string");
      expect(r.nomeParlamentar.length).toBeGreaterThan(0);
      expect(r.estadoEleito).toMatch(/^[A-Z]{2}$/);
      expect(typeof r.partidoEleito).toBe("string");
      // Flags come as single-letter strings ("S"/"N")
      expect(typeof r.auxilioMoradia).toBe("string");
      expect(typeof r.imovelFuncional).toBe("string");
    }
  });
});

// ── /senadores/escritorios — {statusCode,msg,data} envelope, nested records ──

describe("contract: escritorios-apoio dataset", () => {
  it("raw fixture keeps the adm envelope and the nested parlamentar/setor keys", () => {
    expect(escritorios).toHaveProperty("statusCode");
    expect(escritorios).toHaveProperty("data");
    const rows = ensureArray(unwrapAdmEnvelope(escritorios));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows as any[]) {
      expect(r).toHaveProperty("parlamentar.nome");
      expect(r).toHaveProperty("parlamentar.estado");
      expect(r).toHaveProperty("parlamentar.partido");
      expect(r).toHaveProperty("setor.nome");
      expect(r).toHaveProperty("setor.endereco");
      expect(r).toHaveProperty("setor.telefone");
    }
  });

  it("records are well-typed after unwrapAdmEnvelope (same unwrap the tool uses)", () => {
    const rows = ensureArray(unwrapAdmEnvelope(escritorios)) as any[];
    for (const r of rows) {
      expect(typeof r.parlamentar.nome).toBe("string");
      expect(r.parlamentar.nome.length).toBeGreaterThan(0);
      expect(r.parlamentar.estado).toMatch(/^[A-Z]{2}$/);
      // partido is null on every sample row — if present, it must be a string
      if (r.parlamentar.partido !== null) expect(typeof r.parlamentar.partido).toBe("string");
      expect(typeof r.setor.nome).toBe("string");
      expect(r.setor.nome.length).toBeGreaterThan(0);
      expect(typeof r.setor.endereco).toBe("string");
      expect(r.setor.endereco.length).toBeGreaterThan(0);
      // telefone is nullable — if present, string
      if (r.setor.telefone !== null) expect(typeof r.setor.telefone).toBe("string");
    }
  });
});

// ── /senadores/aposentados — FLAT array (no envelope; unwrap is a no-op) ──

describe("contract: aposentados dataset", () => {
  it("raw fixture is a flat array (unwrapAdmEnvelope passthrough) with the keys the tool reads", () => {
    // This adm endpoint serves the payload WITHOUT the {statusCode,data} envelope;
    // unwrapAdmEnvelope must return it unchanged.
    expect(Array.isArray(aposentados)).toBe(true);
    const rows = ensureArray(unwrapAdmEnvelope(aposentados));
    expect(rows.length).toBe(aposentados.length);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows as any[]) {
      expect(r).toHaveProperty("nome");
      expect(r).toHaveProperty("tipo");
      expect(r).toHaveProperty("dataInicial");
      expect(r).toHaveProperty("remuneracao");
    }
  });

  it("records are well-typed (remuneracao is a pt-BR monetary STRING in this dataset)", () => {
    const rows = ensureArray(unwrapAdmEnvelope(aposentados)) as any[];
    for (const r of rows) {
      expect(typeof r.nome).toBe("string");
      expect(r.nome.length).toBeGreaterThan(0);
      expect(typeof r.tipo).toBe("string");
      expect(r.tipo.length).toBeGreaterThan(0);
      expect(r.dataInicial).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Monetary value arrives as a pt-BR formatted string ("30.416,22"), not a number
      expect(typeof r.remuneracao).toBe("string");
      expect(r.remuneracao).toMatch(/^\d{1,3}(\.\d{3})*,\d{2}$/);
    }
  });
});
