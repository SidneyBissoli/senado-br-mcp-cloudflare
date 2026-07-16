/**
 * Contract tests — upstream shape drift, orcamento-senado module
 * (Arquimedes/Financeiro JSON feeds: execução orçamentária do Senado).
 *
 * Tier: `npm run test:contract` (vitest.contract.config.ts), outside the default
 * `npm test` suite. Fixtures in tests/contract/fixtures/ are raw upstream captures
 * (sorted keys, arrays truncated to 3 items) refreshed by `npm run contract:refresh`.
 * A failure right after a live refresh means REAL upstream shape drift, not flakiness.
 *
 * Calibration notes (from the captures):
 *  - despesas: the exercise key is the ACCENTED "exercício_financeiro_lan_ef"
 *    (the parser also accepts an unaccented fallback); the five value columns are
 *    pt-BR decimal-comma STRINGS ("10800,00") -> parseValorBR.
 *  - receitas: ano/mes are strings ("2026", "01"); the two value columns arrive
 *    as NATIVE numbers (the parser accepts both number and pt-BR string).
 * Monetary columns are asserted strictly (a renamed valor field must fail here).
 */
import { describe, it, expect } from "vitest";
import {
  parseDespesa,
  parseReceita,
  parseValorBR,
  agregarDespesas,
  estatisticasExecucao,
} from "../../src/tools/orcamento-senado.js";
import despesasRaw from "./fixtures/financeiro/execucao-despesas.json?raw";
import receitasRaw from "./fixtures/financeiro/execucao-receitas.json?raw";

const despesasPayload = JSON.parse(despesasRaw);
const receitasPayload = JSON.parse(receitasRaw);

// Feed money style: decimal comma, optional thousands dots ("10800,00", "1.234,56").
const PTBR_MONEY = /^-?\d+(\.\d{3})*,\d{2}$/;

/** The five despesa value columns — strict monetary contract. */
const DESPESA_MONEY_KEYS = [
  "valor_dotacao_inicial", "valor_dotacao_atualizada",
  "valor_total_empenhado", "valor_liquidado", "valor_pago",
] as const;

// ── DespesaSenadoDadosAbertos.json ────────────────────────────────────────

describe("contract: execucao orcamentaria — despesas", () => {
  it("raw fixture keeps the top-level `despesas` root and row keys", () => {
    expect(despesasPayload).toHaveProperty("despesas");
    const itens = despesasPayload.despesas;
    expect(Array.isArray(itens)).toBe(true);
    expect(itens.length).toBeGreaterThan(0);
    for (const row of itens) {
      // Exercise key: accented variant (or the unaccented fallback the parser accepts).
      expect(
        "exercício_financeiro_lan_ef" in row || "exercicio_financeiro_lan_ef" in row,
        "despesa row missing the exercicio key (accented or not)",
      ).toBe(true);
      for (const k of [
        "acao_codigo", "acao_nome", "plano_orcamentario_nome", "grupo_despesa_nome",
        "modalidade_aplicacao_nome", "fonte_nome", "resultado_lei_nome",
      ]) {
        expect(row, `despesa row missing key '${k}'`).toHaveProperty(k);
      }
    }
  });

  it("ALL five value columns are present as pt-BR decimal strings", () => {
    for (const row of despesasPayload.despesas) {
      for (const k of DESPESA_MONEY_KEYS) {
        expect(row, `despesa row missing money key '${k}'`).toHaveProperty(k);
        expect(typeof row[k], `'${k}' should be a string`).toBe("string");
        expect(row[k], `'${k}' should look like a pt-BR amount`).toMatch(PTBR_MONEY);
      }
    }
  });

  it("parseDespesa yields typed fields and finite numbers for every value column", () => {
    for (const row of despesasPayload.despesas) {
      const d = parseDespesa(row);
      expect(typeof d.exercicio).toBe("number");
      expect(typeof d.acao).toBe("string");
      expect(d.acao).toContain(" - "); // "codigo - nome" join
      expect(typeof d.planoOrcamentario).toBe("string");
      expect(typeof d.grupoDespesa).toBe("string");
      expect(typeof d.modalidade).toBe("string");
      expect(typeof d.fonte).toBe("string");
      expect(typeof d.resultadoLei).toBe("string");
      for (const campo of ["dotacaoInicial", "dotacaoAtualizada", "empenhado", "liquidado", "pago"] as const) {
        expect(Number.isFinite(d[campo]), `parsed '${campo}' not finite`).toBe(true);
      }
    }
    // The BRL string parser itself resolves a fixture amount to a finite number.
    expect(Number.isFinite(parseValorBR(despesasPayload.despesas[0].valor_dotacao_inicial))).toBe(true);
  });

  it("agregarDespesas sums the five value columns per group", () => {
    const itens = despesasPayload.despesas.map(parseDespesa);
    const agregado = agregarDespesas(itens, (d) => d.grupoDespesa);
    expect(agregado.length).toBeGreaterThan(0);
    for (const g of agregado) {
      expect(typeof g.chave).toBe("string");
      for (const campo of ["dotacaoInicial", "dotacaoAtualizada", "empenhado", "liquidado", "pago"]) {
        expect(Number.isFinite(g[campo]), `aggregated '${campo}' not finite`).toBe(true);
      }
    }
  });

  it("estatisticasExecucao crunches parsed despesas end to end", () => {
    const itens = despesasPayload.despesas.map(parseDespesa);
    const r: any = estatisticasExecucao(itens, { tipo: "despesas", topN: 3 });
    expect(typeof r.campoAnalisado).toBe("string");
    expect(r.distribuicao).toBeTruthy();
    expect(r.distribuicao.n).toBe(itens.length);
    expect(Number.isFinite(r.distribuicao.media)).toBe(true);
    expect(r.top.length).toBeGreaterThan(0);
    expect(Number.isFinite(r.top[0].valor)).toBe(true);
  });
});

// ── ReceitasSenadoDadosAbertos.json ───────────────────────────────────────

describe("contract: execucao orcamentaria — receitas", () => {
  it("raw fixture keeps the top-level `receitas` root and row keys", () => {
    expect(receitasPayload).toHaveProperty("receitas");
    const itens = receitasPayload.receitas;
    expect(Array.isArray(itens)).toBe(true);
    expect(itens.length).toBeGreaterThan(0);
    for (const row of itens) {
      for (const k of [
        "ano", "mes", "categoria_economica_cod_desc", "origem_cod_desc",
        "especie_cod_desc", "natureza_receita_cod_desc",
        "receita_anual_prevista", "receita_arrecadada",
      ]) {
        expect(row, `receita row missing key '${k}'`).toHaveProperty(k);
      }
      // Calibrated: this feed serves the two money columns as NATIVE numbers.
      expect(typeof row.receita_anual_prevista).toBe("number");
      expect(typeof row.receita_arrecadada).toBe("number");
    }
  });

  it("parseReceita yields typed fields and finite numbers for the value columns", () => {
    for (const row of receitasPayload.receitas) {
      const r = parseReceita(row);
      expect(typeof r.ano).toBe("number");
      expect(r.ano).toBeGreaterThan(2000);
      expect(typeof r.mes).toBe("number");
      expect(typeof r.categoria).toBe("string");
      expect(typeof r.origem).toBe("string");
      expect(typeof r.especie).toBe("string");
      expect(typeof r.natureza).toBe("string");
      expect(Number.isFinite(r.prevista)).toBe(true);
      expect(Number.isFinite(r.arrecadada)).toBe(true);
    }
  });

  it("estatisticasExecucao crunches parsed receitas end to end", () => {
    const itens = receitasPayload.receitas.map(parseReceita);
    const r: any = estatisticasExecucao(itens, { tipo: "receitas", topN: 3 });
    expect(typeof r.campoAnalisado).toBe("string");
    expect(r.distribuicao).toBeTruthy();
    expect(r.distribuicao.n).toBe(itens.length);
    expect(r.top.length).toBeGreaterThan(0);
    expect(Number.isFinite(r.top[0].valor)).toBe(true);
  });
});
