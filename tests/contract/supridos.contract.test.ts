/**
 * Contract tests — upstream shape drift, supridos module (adm API, suprimento de fundos).
 *
 * Tier: `npm run test:contract` (vitest.contract.config.ts), outside the default
 * `npm test` suite. Fixtures in tests/contract/fixtures/ are raw upstream captures
 * (sorted keys, arrays truncated to 3 items) refreshed by `npm run contract:refresh`.
 * A failure right after a live refresh means REAL upstream shape drift, not flakiness.
 *
 * Unlike the payroll feeds, the supridos endpoints serve money as NATIVE numbers
 * (int/float), never pt-BR strings — `suprimentoValor` only coerces, no parseBRL.
 * Monetary columns are asserted strictly (a renamed valor field must fail here).
 */
import { describe, it, expect } from "vitest";
import {
  suprimentoValor,
  estatisticasSuprimento,
  CAMPOS_POR_TIPO,
  TIPOS_COM_VALOR,
} from "../../src/tools/supridos.js";
import supridosRaw from "./fixtures/adm/supridos.json?raw";
import transacoesRaw from "./fixtures/adm/supridos-transacoes.json?raw";
import empenhosRaw from "./fixtures/adm/supridos-empenhos.json?raw";
import atosRaw from "./fixtures/adm/supridos-atos-concessao.json?raw";

const supridos = JSON.parse(supridosRaw);
const transacoes = JSON.parse(transacoesRaw);
const empenhos = JSON.parse(empenhosRaw);
const atos = JSON.parse(atosRaw);

// ── value-column config sanity ────────────────────────────────────────────

describe("contract: CAMPOS_POR_TIPO covers every tipo with a value column", () => {
  it("each tipo in TIPOS_COM_VALOR has a config whose default is among its campos", () => {
    for (const tipo of TIPOS_COM_VALOR) {
      const cfg = CAMPOS_POR_TIPO[tipo];
      expect(cfg, `missing CAMPOS_POR_TIPO entry for '${tipo}'`).toBeTruthy();
      expect(cfg.campos).toContain(cfg.default);
    }
  });
});

// ── /supridos/{ano} (registry) ────────────────────────────────────────────

describe("contract: supridos registry", () => {
  it("raw fixture rows carry codigo + nome (what nomesSupridos reads)", () => {
    expect(Array.isArray(supridos)).toBe(true);
    expect(supridos.length).toBeGreaterThan(0);
    for (const row of supridos) {
      expect(row).toHaveProperty("codigo");
      expect(row).toHaveProperty("nome");
      expect(typeof row.codigo).toBe("string");
      expect(typeof row.nome).toBe("string");
      expect(row.nome.length).toBeGreaterThan(0);
    }
  });
});

// ── /supridos/transacoes/{ano} ────────────────────────────────────────────

describe("contract: supridos transacoes", () => {
  it("raw fixture carries the keys statistics/grouping rely on", () => {
    expect(Array.isArray(transacoes)).toBe(true);
    expect(transacoes.length).toBeGreaterThan(0);
    for (const row of transacoes) {
      for (const k of ["valor", "fornecedor", "tipo", "tipoInscricao", "rubricas", "data"]) {
        expect(row, `transacao row missing key '${k}'`).toHaveProperty(k);
      }
      // Money is a native number here — strict: a pt-BR string or rename must fail.
      expect(typeof row.valor).toBe("number");
    }
  });

  it("suprimentoValor reads a finite number via the default campo", () => {
    const campo = CAMPOS_POR_TIPO["transacoes"].default;
    for (const row of transacoes) {
      expect(Number.isFinite(suprimentoValor(row, campo))).toBe(true);
    }
  });

  it("estatisticasSuprimento crunches the fixture end to end", () => {
    const r: any = estatisticasSuprimento(transacoes, { tipo: "transacoes", topN: 3 });
    expect(typeof r.campoAnalisado).toBe("string");
    expect(r.distribuicao).toBeTruthy();
    expect(Number.isFinite(r.distribuicao.media)).toBe(true);
    expect(r.top.length).toBeGreaterThan(0);
    expect(Number.isFinite(r.top[0].valor)).toBe(true);
    expect(typeof r.top[0].fornecedor).toBe("string");
  });
});

// ── /supridos/empenhos/{ano} ──────────────────────────────────────────────

describe("contract: supridos empenhos", () => {
  it("raw fixture carries the keys statistics/grouping rely on", () => {
    expect(Array.isArray(empenhos)).toBe(true);
    expect(empenhos.length).toBeGreaterThan(0);
    for (const row of empenhos) {
      for (const k of ["valorExecutado", "valorConcedido", "rubrica", "descricao", "numero", "data"]) {
        expect(row, `empenho row missing key '${k}'`).toHaveProperty(k);
      }
      // Both money columns native numbers — strict.
      expect(typeof row.valorExecutado).toBe("number");
      expect(typeof row.valorConcedido).toBe("number");
    }
  });

  it("suprimentoValor reads a finite number via the default campo (valorExecutado)", () => {
    const campo = CAMPOS_POR_TIPO["empenhos"].default;
    for (const row of empenhos) {
      expect(Number.isFinite(suprimentoValor(row, campo))).toBe(true);
    }
    // The alternative campo must also resolve.
    expect(Number.isFinite(suprimentoValor(empenhos[0], "valorConcedido"))).toBe(true);
  });
});

// ── /supridos/atosConcessao/{ano} ─────────────────────────────────────────

describe("contract: supridos atos de concessao", () => {
  it("raw fixture carries the keys statistics/identification rely on", () => {
    expect(Array.isArray(atos)).toBe(true);
    expect(atos.length).toBeGreaterThan(0);
    for (const row of atos) {
      for (const k of [
        "valorTotalTransacoes", "valorTotalEmpenhos", "valorTotalElementosDespesa",
        "valorTotalMovimentacoes", "elementoDespesa", "regimeEspecial",
        "codigoAtoConcessao", "codigo_suprido", "data",
      ]) {
        expect(row, `ato row missing key '${k}'`).toHaveProperty(k);
      }
      // The four money totals are native numbers — strict.
      for (const k of [
        "valorTotalTransacoes", "valorTotalEmpenhos",
        "valorTotalElementosDespesa", "valorTotalMovimentacoes",
      ]) {
        expect(typeof row[k], `'${k}' should be a number`).toBe("number");
      }
    }
  });

  it("regimeEspecial flag keeps a shape rotuloRegime understands (boolean or S/N)", () => {
    // rotuloRegime is module-private; assert the raw flag's shape instead — it maps
    // boolean true/false and "S"/"N" variants, anything else becomes "não informado".
    for (const row of atos) {
      expect(
        typeof row.regimeEspecial === "boolean" ||
          ["S", "SIM", "s", "N", "NAO", "NÃO", "n"].includes(row.regimeEspecial),
        "regimeEspecial should be a boolean or S/N flag",
      ).toBe(true);
    }
  });

  it("suprimentoValor reads a finite number via the default campo (valorTotalTransacoes)", () => {
    const campo = CAMPOS_POR_TIPO["atos-concessao"].default;
    for (const row of atos) {
      expect(Number.isFinite(suprimentoValor(row, campo))).toBe(true);
    }
  });

  it("estatisticasSuprimento joins beneficiary names from the supridos registry", () => {
    // Mirror nomesSupridos' mapping without fetching: codigo -> nome from the registry fixture.
    const nomePorCodigo = new Map<string, string>(
      supridos.map((s: any) => [String(s.codigo), String(s.nome)]),
    );
    const r: any = estatisticasSuprimento(atos, { tipo: "atos-concessao", topN: 3, nomePorCodigo });
    expect(typeof r.campoAnalisado).toBe("string");
    expect(r.distribuicao).toBeTruthy();
    expect(r.top.length).toBeGreaterThan(0);
    expect(Number.isFinite(r.top[0].valor)).toBe(true);
    // codigo_suprido in the atos fixture exists in the registry fixture -> name resolved.
    expect(typeof r.top[0].suprido).toBe("string");
    expect(typeof r.top[0].codigoAtoConcessao).toBe("string");
  });
});
