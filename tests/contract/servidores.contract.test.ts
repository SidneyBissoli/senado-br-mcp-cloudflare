/**
 * Contract tests — upstream shape drift, servidores module (adm API).
 *
 * Tier: `npm run test:contract` (vitest.contract.config.ts), outside the default
 * `npm test` suite. Fixtures in tests/contract/fixtures/ are raw upstream captures
 * (sorted keys, arrays truncated to 3 items) refreshed by `npm run contract:refresh`.
 * A failure right after a live refresh means REAL upstream shape drift, not flakiness.
 *
 * Per endpoint: (a) the raw fixture still carries the envelope/keys the parser
 * depends on; (b) the real exported parser yields defined/typed fields from the
 * fixture. Presence/shape only — never exact values. Monetary fields are asserted
 * strictly (a renamed money key must fail here).
 */
import { describe, it, expect } from "vitest";
import {
  parseServidor,
  resumoRemuneracao,
  normalizarRemuneracao,
  parseHoraExtra,
  estatisticasRemuneracoes,
  estatisticasHorasExtras,
} from "../../src/tools/servidores.js";
import { unwrapAdmEnvelope } from "../../src/utils/upstream-parse.js";
import ativosRaw from "./fixtures/adm/servidores-ativos.json?raw";
import remuneracoesRaw from "./fixtures/adm/remuneracoes.json?raw";
import horasExtrasRaw from "./fixtures/adm/horas-extras.json?raw";
import estagiariosRaw from "./fixtures/adm/pessoal-estagiarios.json?raw";

// adm payroll money arrives as pt-BR decimal strings ("1.234,56", "-2.777,41", "0,00").
const PTBR_MONEY = /^-?\d+(\.\d{3})*,\d{2}$/;

// ── /servidores/servidores/{situacao} ─────────────────────────────────────

describe("contract: servidores ativos (adm flat array, snake_case)", () => {
  const items = JSON.parse(ativosRaw);

  it("raw fixture carries the keys parseServidor relies on", () => {
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      for (const k of [
        "nome", "vinculo", "situacao", "cargo", "especialidade",
        "funcao", "lotacao", "categoria", "cedido", "ano_admissao",
      ]) {
        expect(item, `servidor row missing key '${k}'`).toHaveProperty(k);
      }
      // lotacao is a {sigla,nome} object — the subordinadasA matching depends on it.
      expect(item.lotacao).toHaveProperty("sigla");
      expect(item.lotacao).toHaveProperty("nome");
    }
  });

  it("parseServidor yields typed fields from the fixture", () => {
    for (const item of items) {
      const s = parseServidor(item);
      expect(typeof s.nome).toBe("string");
      expect(s.nome.length).toBeGreaterThan(0);
      expect(typeof s.vinculo).toBe("string");
      expect(typeof s.situacao).toBe("string");
      expect(typeof s.anoAdmissao).toBe("number");
      expect(s.lotacao).toBeTruthy();
      expect(typeof (s.lotacao as any).nome).toBe("string");
    }
  });
});

// ── /servidores/remuneracoes/{ano}/{mes} ──────────────────────────────────

/** Every snake_case column the payroll normalizer reads — ALL must be present. */
const REMUNERACAO_KEYS = [
  "sequencial", "nome", "tipo_folha",
  "remuneracao_basica", "vantagens_pessoais", "funcao_comissionada",
  "gratificacao_natalina", "horas_extras", "outras_eventuais", "abono_permanencia",
  "previdencia", "faltas", "diarias", "auxilios", "imposto_renda",
  "reversao_teto_constitucional", "vantagens_indenizatorias", "remuneracao_liquida",
] as const;

const REMUNERACAO_MONEY_KEYS = REMUNERACAO_KEYS.filter(
  (k) => !["sequencial", "nome", "tipo_folha"].includes(k),
);

describe("contract: remuneracoes (adm flat array, pt-BR money strings)", () => {
  const items = JSON.parse(remuneracoesRaw);

  it("raw fixture carries ALL the snake_case columns the normalizer reads", () => {
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      for (const k of REMUNERACAO_KEYS) {
        expect(item, `remuneracao row missing key '${k}'`).toHaveProperty(k);
      }
    }
  });

  it("monetary columns are still pt-BR decimal strings (what parseBRL expects)", () => {
    for (const item of items) {
      for (const k of REMUNERACAO_MONEY_KEYS) {
        expect(typeof item[k], `'${k}' should be a string`).toBe("string");
        expect(item[k], `'${k}' should look like a pt-BR amount`).toMatch(PTBR_MONEY);
      }
    }
  });

  it("resumoRemuneracao and normalizarRemuneracao yield finite numbers", () => {
    for (const item of items) {
      const resumo = resumoRemuneracao(item);
      expect(typeof resumo.nome).toBe("string");
      expect(Number.isFinite(resumo.remuneracaoBasica)).toBe(true);
      expect(Number.isFinite(resumo.bruto)).toBe(true);

      const norm = normalizarRemuneracao(item);
      expect(typeof norm.sequencial).toBe("number");
      for (const campo of [
        "remuneracaoBasica", "vantagensPessoais", "funcaoComissionada",
        "gratificacaoNatalina", "horasExtras", "outrasEventuais", "abonoPermanencia",
        "previdencia", "faltas", "diarias", "auxilios", "impostoRenda",
        "reversaoTetoConstitucional", "vantagensIndenizatorias", "liquida", "bruto",
      ] as const) {
        expect(Number.isFinite(norm[campo]), `normalized '${campo}' not finite`).toBe(true);
      }
    }
  });

  it("estatisticasRemuneracoes crunches the fixture end to end", () => {
    const r: any = estatisticasRemuneracoes(items, { campo: "bruto", consolidar: true, topN: 3 });
    expect(typeof r.campoAnalisado).toBe("string");
    expect(r.estatisticas).toBeTruthy();
    expect(Number.isFinite(r.estatisticas.media)).toBe(true);
    expect(Array.isArray(r.top)).toBe(true);
    expect(r.top.length).toBeGreaterThan(0);
    expect(Number.isFinite(r.top[0].valor)).toBe(true);
    expect(typeof r.top[0].nome).toBe("string");
  });
});

// ── /servidores/horas-extras/{ano}/{mes} ──────────────────────────────────

describe("contract: horas extras (adm flat array, camelCase valorTotal)", () => {
  const items = JSON.parse(horasExtrasRaw);

  it("raw fixture carries the keys parseHoraExtra relies on", () => {
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      for (const k of ["nome", "valorTotal", "mes_ano_prestacao", "mes_ano_pagamento", "horas_extras"]) {
        expect(item, `horas-extras row missing key '${k}'`).toHaveProperty(k);
      }
      // The single money column: camelCase (unlike the rest of the row) and a pt-BR string.
      expect(typeof item.valorTotal).toBe("string");
      expect(item.valorTotal).toMatch(PTBR_MONEY);
      expect(Array.isArray(item.horas_extras)).toBe(true);
    }
  });

  it("parseHoraExtra yields a numeric valorTotal and the detail array", () => {
    for (const item of items) {
      const h = parseHoraExtra(item);
      expect(typeof h.nome).toBe("string");
      expect(h.nome.length).toBeGreaterThan(0);
      expect(Number.isFinite(h.valorTotal)).toBe(true);
      expect(h.valorTotal).toBeGreaterThan(0);
      expect(typeof h.competencia).toBe("string");
      expect(typeof h.pagamento).toBe("string");
      expect(Array.isArray(h.horasExtras)).toBe(true);
    }
  });

  it("estatisticasHorasExtras crunches parsed rows end to end", () => {
    const parsed = items.map(parseHoraExtra);
    const r: any = estatisticasHorasExtras(parsed, { topN: 3 });
    expect(r.distribuicao).toBeTruthy();
    expect(Number.isFinite(r.distribuicao.media)).toBe(true);
    expect(Array.isArray(r.top)).toBe(true);
    expect(r.top.length).toBeGreaterThan(0);
    expect(Number.isFinite(r.top[0].valor)).toBe(true);
  });
});

// ── /servidores/estagiarios (enveloped adm endpoint) ──────────────────────

describe("contract: estagiarios (adm {statusCode,msg,data} envelope)", () => {
  const payload = JSON.parse(estagiariosRaw);

  it("raw fixture still carries the adm envelope", () => {
    expect(payload).toHaveProperty("statusCode");
    expect(payload).toHaveProperty("msg");
    expect(payload).toHaveProperty("data");
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.data.length).toBeGreaterThan(0);
  });

  it("unwrapAdmEnvelope unwraps to the rows the tool serves", () => {
    const rows = unwrapAdmEnvelope(payload) as any[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.nome).toBe("string");
      expect(row.nome.length).toBeGreaterThan(0);
    }
  });
});
