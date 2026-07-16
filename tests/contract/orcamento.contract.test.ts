/**
 * Contract tests — upstream shape drift, orcamento module (legacy legis API,
 * emendas parlamentares ao orçamento da União).
 *
 * Tier: `npm run test:contract` (vitest.contract.config.ts), outside the default
 * `npm test` suite. Fixtures in tests/contract/fixtures/ are raw upstream captures
 * (sorted keys, arrays truncated to 3 items) refreshed by `npm run contract:refresh`.
 * A failure right after a live refresh means REAL upstream shape drift, not flakiness.
 *
 * Calibration notes (from the captures):
 *  - /orcamento/lista is a PascalCase wrapped payload:
 *    ListaLoteEmendas.LotesEmendasOrcamento.LoteEmendasOrcamento[] (all values strings).
 *  - /orcamento/oficios is served as a FLAT camelCase array at the response root
 *    (the tool's digArrayRoot candidates cover both the wrapped and flat shapes).
 *  - Neither feed carries a monetary column: `QuantidadeEmendas` is a COUNT and
 *    `notaEmpenho` is an identifier, not a value (see the estatísticas triage notes).
 */
import { describe, it, expect } from "vitest";
import { parseEmenda, parseOficio } from "../../src/tools/orcamento.js";
import { digArrayRoot } from "../../src/utils/upstream-parse.js";
import listaRaw from "./fixtures/legado/orcamento-lista.json?raw";
import oficiosRaw from "./fixtures/legado/orcamento-oficios.json?raw";

const listaPayload = JSON.parse(listaRaw);
const oficiosPayload = JSON.parse(oficiosRaw);

// ── /orcamento/lista (lotes de emendas) ───────────────────────────────────

describe("contract: orcamento lista (lotes de emendas, PascalCase wrapper)", () => {
  // Same root resolution the tool performs.
  const lotes = digArrayRoot(
    listaPayload,
    [["ListaLoteEmendas", "LotesEmendasOrcamento", "LoteEmendasOrcamento"]],
    "contract:orcamento:lista",
  ) as any[];

  it("wrapped root resolves and rows carry the PascalCase keys parseEmenda reads", () => {
    expect(lotes.length).toBeGreaterThan(0);
    for (const row of lotes) {
      for (const k of [
        "NumeroMateria", "AnoMateria", "SiglaTipoPlOrcamento", "NomeAutorOrcamento",
        "CodigoAutorOrcamento", "QuantidadeEmendas", "AnoExecucao",
        "DescricaoTipoPlOrcamento", "DataOperacao", "IndicadorAtivo",
      ]) {
        expect(row, `lote row missing key '${k}'`).toHaveProperty(k);
      }
    }
  });

  it("parseEmenda yields typed fields from the fixture", () => {
    for (const row of lotes) {
      const e = parseEmenda(row);
      expect(typeof e.autor).toBe("string");
      expect((e.autor as string).length).toBeGreaterThan(0);
      expect(typeof e.codigoAutor).toBe("number");
      expect(e.codigoAutor).toBeGreaterThan(0);
      // QuantidadeEmendas is a numeric string upstream; safeInt must land a count.
      expect(typeof e.quantidadeEmendas).toBe("number");
      expect(e.quantidadeEmendas).toBeGreaterThan(0);
      expect(e.anoExecucao).toBeTruthy();
      // materia = "<sigla> <numero>/<ano>", e.g. "LOA 29/2023".
      expect(typeof e.materia).toBe("string");
      expect(e.materia).toMatch(/\/\d{4}$/);
      expect(typeof e.tipoPl).toBe("string");
      expect(typeof e.dataOperacao).toBe("string");
      expect(typeof e.ativo).toBe("boolean");
    }
  });
});

// ── /orcamento/oficios (indicação de destino) ─────────────────────────────

describe("contract: orcamento oficios (flat camelCase array)", () => {
  // Same candidate list the tool passes to digArrayRoot (wrapped OR flat root).
  const oficios = digArrayRoot(
    oficiosPayload,
    [["OrcamentoOficios", "Oficios", "Oficio"], []],
    "contract:orcamento:oficios",
  ) as any[];

  it("root resolves and rows carry the keys parseOficio reads", () => {
    expect(oficios.length).toBeGreaterThan(0);
    for (const row of oficios) {
      for (const k of ["id", "tratamento", "nome", "numeroProtocoloApresentacao", "dataInclusao", "emendas"]) {
        expect(row, `oficio row missing key '${k}'`).toHaveProperty(k);
      }
      expect(Array.isArray(row.emendas)).toBe(true);
      expect(row.emendas.length).toBeGreaterThan(0);
      for (const em of row.emendas) {
        for (const k of [
          "numero", "ano", "tipo", "autor", "nomeFavorecido", "cnpjFavorecido",
          "nomeOrgaoUge", "acaoOrcamentaria", "notaEmpenho",
        ]) {
          expect(em, `emenda row missing key '${k}'`).toHaveProperty(k);
        }
      }
    }
  });

  it("parseOficio (incluirEmendas=true) yields typed fields and the emendas detail", () => {
    for (const row of oficios) {
      const o = parseOficio(row, undefined, true) as any;
      expect(o.id).not.toBeNull();
      expect(typeof o.autor).toBe("string");
      expect(o.autor).toContain(row.nome); // tratamento + nome joined
      expect(typeof o.protocolo).toBe("string");
      // dataInclusao is an ISO timestamp upstream; the parser keeps the date part.
      expect(o.dataInclusao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof o.quantidadeEmendas).toBe("number");
      expect(o.quantidadeEmendas).toBe(row.emendas.length);
      expect(Array.isArray(o.emendas)).toBe(true);
      for (const em of o.emendas) {
        expect(em.numero).toBeTruthy();
        expect(em.ano).toBeTruthy();
        expect(typeof em.favorecido).toBe("string");
        expect(typeof em.cnpjFavorecido).toBe("string");
        expect(typeof em.orgao).toBe("string");
        expect(typeof em.acaoOrcamentaria).toBe("string");
        expect(typeof em.notaEmpenho).toBe("string");
      }
    }
  });

  it("parseOficio's ano filter counts only that budget year's emendas", () => {
    const row = oficios[0];
    const ano = Number(row.emendas[0].ano);
    const filtrado = parseOficio(row, ano) as any;
    expect(filtrado.quantidadeEmendas).toBeGreaterThan(0);
    expect(filtrado.quantidadeEmendas).toBeLessThanOrEqual(row.emendas.length);
    // Default projection: no emendas detail without incluirEmendas.
    expect(filtrado.emendas).toBeUndefined();
  });
});
