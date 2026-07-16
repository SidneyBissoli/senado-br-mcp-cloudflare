/**
 * Contract tests — upstream shape drift, contratacoes module (adm API, procurement).
 *
 * Tier: `npm run test:contract` (vitest.contract.config.ts), outside the default
 * `npm test` suite. Fixtures in tests/contract/fixtures/ are raw upstream captures
 * (sorted keys, arrays truncated to 3 items) refreshed by `npm run contract:refresh`.
 * A failure right after a live refresh means REAL upstream shape drift, not flakiness.
 *
 * Calibration notes (from the captures):
 *  - contratos rows carry `numero_formatado` and `unidade_gestora`; atas_registro_preco
 *    rows carry NEITHER — parseContrato falls back to `numero` / null.
 *  - terceirizados `empresa` is a plain string (parseTerceirizado's fallback branch),
 *    while `lotacao` is a {sigla,nome} object.
 *  - This dataset publishes NO contract money column (documented in the tool text),
 *    so there is no strict monetary assertion here.
 */
import { describe, it, expect } from "vitest";
import {
  parseContrato,
  podarLicitacao,
  parseTerceirizado,
  matchesFiltro,
  matchesFiltroCampo,
  ordenarEPaginar,
} from "../../src/tools/contratacoes.js";
import contratosRaw from "./fixtures/adm/contratos.json?raw";
import atasRaw from "./fixtures/adm/atas-registro-preco.json?raw";
import licitacoesRaw from "./fixtures/adm/licitacoes.json?raw";
import terceirizadosRaw from "./fixtures/adm/terceirizados.json?raw";
import empresasRaw from "./fixtures/adm/empresas.json?raw";

const contratos = JSON.parse(contratosRaw);
const atas = JSON.parse(atasRaw);
const licitacoes = JSON.parse(licitacoesRaw);
const terceirizados = JSON.parse(terceirizadosRaw);
const empresas = JSON.parse(empresasRaw);

// ── /contratacoes/contratos ───────────────────────────────────────────────

describe("contract: contratos", () => {
  it("raw fixture carries the keys parseContrato relies on", () => {
    expect(Array.isArray(contratos)).toBe(true);
    expect(contratos.length).toBeGreaterThan(0);
    for (const row of contratos) {
      for (const k of [
        "id", "numero_formatado", "numero", "objeto", "empresa", "licitacao",
        "sub_especie", "data_assinatura", "data_inicio_vigencia", "data_fim_vigencia",
        "ind_mao_de_obra", "unidade_gestora",
      ]) {
        expect(row, `contrato row missing key '${k}'`).toHaveProperty(k);
      }
      expect(row.empresa).toHaveProperty("nome");
      expect(row.empresa).toHaveProperty("cpf_cnpj");
    }
  });

  it("parseContrato yields typed fields from the fixture", () => {
    for (const row of contratos) {
      const c = parseContrato(row);
      expect(typeof c.id).toBe("number");
      expect(typeof c.numero).toBe("string");
      expect(typeof c.objeto).toBe("string");
      expect(c.empresa).toBeTruthy();
      expect(typeof c.empresa!.nome).toBe("string");
      expect(typeof c.empresa!.cnpj).toBe("string");
      expect(c.licitacao).not.toBeUndefined();
      expect(typeof c.subEspecie).toBe("string");
      expect(typeof c.dataAssinatura).toBe("string");
      expect(typeof c.vigencia.inicio).toBe("string");
      expect(c.vigencia).toHaveProperty("fim"); // may be null (open-ended contracts)
      expect(typeof c.maoDeObra).toBe("boolean");
      expect(typeof c.unidadeGestora).toBe("string");
    }
  });

  it("matchesFiltro and ordenarEPaginar operate on parsed rows", () => {
    const parsed = (contratos as any[]).map(parseContrato);
    // Accent/case-insensitive substring match against the row's own objeto.
    expect(matchesFiltro(parsed[0].objeto, String(parsed[0].objeto).slice(0, 12).toUpperCase())).toBe(true);
    // desc = reversed input order; slice window applies after ordering.
    const desc = ordenarEPaginar(parsed, "desc", 0, parsed.length);
    expect(desc[0].id).toBe(parsed[parsed.length - 1].id);
    expect(ordenarEPaginar(parsed, "asc", 1, 1)[0].id).toBe(parsed[1].id);
  });
});

// ── /contratacoes/atas_registro_preco (same parser, leaner rows) ──────────

describe("contract: atas de registro de preco", () => {
  it("raw fixture keeps the contract-like keys (minus numero_formatado/unidade_gestora)", () => {
    expect(Array.isArray(atas)).toBe(true);
    expect(atas.length).toBeGreaterThan(0);
    for (const row of atas) {
      for (const k of ["id", "numero", "objeto", "empresa", "licitacao", "sub_especie", "data_assinatura"]) {
        expect(row, `ata row missing key '${k}'`).toHaveProperty(k);
      }
    }
  });

  it("parseContrato falls back to `numero` and null unidadeGestora on ata rows", () => {
    for (const row of atas) {
      const c = parseContrato(row);
      expect(typeof c.id).toBe("number");
      expect(typeof c.numero).toBe("string"); // fallback path: no numero_formatado in ata rows
      expect(c.numero.length).toBeGreaterThan(0);
      expect(typeof c.empresa!.nome).toBe("string");
      expect(typeof c.subEspecie).toBe("string");
      expect(c).toHaveProperty("unidadeGestora"); // null, but defined
    }
  });
});

// ── /contratacoes/licitacoes ──────────────────────────────────────────────

describe("contract: licitacoes", () => {
  it("raw fixture carries detalhamentos[] with the circular nested licitacao", () => {
    expect(Array.isArray(licitacoes)).toBe(true);
    expect(licitacoes.length).toBeGreaterThan(0);
    const lic = licitacoes[0];
    for (const k of ["id", "numero", "objeto", "modalidade", "situacao", "detalhamentos"]) {
      expect(lic, `licitacao missing key '${k}'`).toHaveProperty(k);
    }
    expect(Array.isArray(lic.detalhamentos)).toBe(true);
    expect(lic.detalhamentos.length).toBeGreaterThan(0);
    // The pruning target: each detail repeats the full parent licitacao.
    expect(lic.detalhamentos[0]).toHaveProperty("licitacao");
  });

  it("podarLicitacao prunes the nested licitacao and keeps the detail fields", () => {
    const podada = podarLicitacao(licitacoes[0]);
    expect(podada.detalhamentos.length).toBe(licitacoes[0].detalhamentos.length);
    for (const d of podada.detalhamentos) {
      expect(d).not.toHaveProperty("licitacao");
      expect(d).toHaveProperty("id");
      expect(d).toHaveProperty("descricao");
      expect(d).toHaveProperty("tipo");
    }
    // Top-level fields untouched.
    expect(typeof podada.numero).toBe("string");
    expect(typeof podada.objeto).toBe("string");
  });
});

// ── /contratacoes/terceirizados ───────────────────────────────────────────

describe("contract: terceirizados", () => {
  it("raw fixture carries the keys parseTerceirizado relies on", () => {
    expect(Array.isArray(terceirizados)).toBe(true);
    expect(terceirizados.length).toBeGreaterThan(0);
    for (const row of terceirizados) {
      for (const k of ["nome", "cpf", "situacao", "empresa", "lotacao", "numeroContrato"]) {
        expect(row, `terceirizado row missing key '${k}'`).toHaveProperty(k);
      }
      // Calibrated: empresa is a plain string; lotacao is a {sigla,nome} object.
      expect(typeof row.empresa).toBe("string");
      expect(row.lotacao).toHaveProperty("sigla");
      expect(row.lotacao).toHaveProperty("nome");
    }
  });

  it("parseTerceirizado yields typed fields; lotacao filter matches its own sigla", () => {
    for (const row of terceirizados) {
      const t = parseTerceirizado(row);
      expect(typeof t.nome).toBe("string");
      expect(t.nome.length).toBeGreaterThan(0);
      expect(typeof t.cpf).toBe("string");
      expect(typeof t.situacao).toBe("string");
      expect(typeof t.empresa).toBe("string"); // string fallback branch
      expect(typeof t.numeroContrato).toBe("string");
      // The tool filters lotacao via matchesFiltroCampo (object with sigla/nome).
      expect(matchesFiltroCampo(t.lotacao, row.lotacao.sigla)).toBe(true);
    }
  });
});

// ── /contratacoes/empresas (inline tool reads — raw-key assertions only) ──

describe("contract: empresas contratadas", () => {
  it("raw fixture carries nome/cpf_cnpj/id and contratos[] with numero fields", () => {
    expect(Array.isArray(empresas)).toBe(true);
    expect(empresas.length).toBeGreaterThan(0);
    for (const row of empresas) {
      for (const k of ["id", "nome", "cpf_cnpj", "contratos"]) {
        expect(row, `empresa row missing key '${k}'`).toHaveProperty(k);
      }
      expect(Array.isArray(row.contratos)).toBe(true);
    }
    // At least one empresa with contracts, whose entries expose the number the tool projects.
    const comContratos = empresas.find((e: any) => e.contratos.length > 0);
    expect(comContratos).toBeTruthy();
    for (const c of comContratos.contratos) {
      expect(c).toHaveProperty("id");
      // The tool reads numero_formatado || numero || id.
      expect("numero_formatado" in c || "numero" in c).toBe(true);
    }
  });
});
