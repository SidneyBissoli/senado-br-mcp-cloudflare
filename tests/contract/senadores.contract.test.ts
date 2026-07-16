/**
 * Upstream shape-drift contract tests for the SENATORS tool module
 * (src/tools/senadores.ts).
 *
 * Runs in the CONTRACT tier (`npm run test:contract`, config
 * vitest.contract.config.ts) — excluded from the default `npm test` suite.
 * Fixtures in tests/contract/fixtures/ are raw upstream JSON captures
 * (sorted keys, arrays truncated to 3 items), refreshed by
 * `npm run contract:refresh`. A failure right after a live refresh means the
 * upstream changed shape (renamed wrapper / dropped field), not a code bug.
 *
 * Per endpoint: (a) the RAW fixture still carries the wrapper path + keys the
 * parser depends on; (b) the REAL exported parser produces well-typed output.
 * Presence/shape only — never exact values (fixtures get refreshed).
 */
import { describe, it, expect } from "vitest";
import {
  parseSenadorResumo,
  parseSenadorDetalhe,
  parseMandato,
  parseComissaoMembro,
  parseCargoSenador,
  parseFiliacao,
  parseLicenca,
  parseProfissao,
  parseVotoSenador,
  extractParlamentares,
} from "../../src/tools/senadores.js";
import { digArrayRoot } from "../../src/utils/upstream-parse.js";
import senadorListaAtualRaw from "./fixtures/legado/senador-lista-atual.json?raw";
import senadoresAfastadosRaw from "./fixtures/legado/senadores-afastados.json?raw";
import senadorDetalheRaw from "./fixtures/legado/senador-detalhe.json?raw";
import senadorMandatosRaw from "./fixtures/legado/senador-mandatos.json?raw";
import senadorComissoesRaw from "./fixtures/legado/senador-comissoes.json?raw";
import senadorCargosRaw from "./fixtures/legado/senador-cargos.json?raw";
import senadorFiliacoesRaw from "./fixtures/legado/senador-filiacoes.json?raw";
import senadorLicencasRaw from "./fixtures/legado/senador-licencas.json?raw";
import senadorProfissaoRaw from "./fixtures/legado/senador-profissao.json?raw";
import votacoesRaw from "./fixtures/v3/votacoes.json?raw";

const listaAtual = JSON.parse(senadorListaAtualRaw);
const afastados = JSON.parse(senadoresAfastadosRaw);
const detalhe = JSON.parse(senadorDetalheRaw);
const mandatos = JSON.parse(senadorMandatosRaw);
const comissoes = JSON.parse(senadorComissoesRaw);
const cargos = JSON.parse(senadorCargosRaw);
const filiacoes = JSON.parse(senadorFiliacoesRaw);
const licencas = JSON.parse(senadorLicencasRaw);
const profissao = JSON.parse(senadorProfissaoRaw);
const votacoes = JSON.parse(votacoesRaw);

// ── /senador/lista/atual — ListaParlamentarEmExercicio ────────────────────

describe("contract: /senador/lista/atual", () => {
  it("raw fixture carries the wrapper path and the keys parseSenadorResumo reads", () => {
    expect(listaAtual).toHaveProperty("ListaParlamentarEmExercicio.Parlamentares.Parlamentar");
    const items = listaAtual.ListaParlamentarEmExercicio.Parlamentares.Parlamentar;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty("IdentificacaoParlamentar.CodigoParlamentar");
    expect(items[0]).toHaveProperty("IdentificacaoParlamentar.NomeParlamentar");
    expect(items[0]).toHaveProperty("IdentificacaoParlamentar.NomeCompletoParlamentar");
    expect(items[0]).toHaveProperty("IdentificacaoParlamentar.SiglaPartidoParlamentar");
    expect(items[0]).toHaveProperty("IdentificacaoParlamentar.UfParlamentar");
    expect(items[0]).toHaveProperty("Mandato.UfParlamentar");
  });

  it("extractParlamentares + parseSenadorResumo yield well-typed senators", () => {
    const parlamentares = extractParlamentares(listaAtual);
    expect(parlamentares.length).toBeGreaterThan(0);
    for (const p of parlamentares) {
      const s = parseSenadorResumo(p);
      expect(typeof s.codigo).toBe("number");
      expect(s.codigo).toBeGreaterThan(0);
      expect(typeof s.nome).toBe("string");
      expect(s.nome.length).toBeGreaterThan(0);
      expect(s.nomeCompleto.length).toBeGreaterThan(0);
      // Seated senators always carry a party sigla and a 2-char UF
      expect(typeof s.partido).toBe("string");
      expect(s.uf).toMatch(/^[A-Z]{2}$/);
      expect(typeof s.emExercicio).toBe("boolean");
      // foto is optional in principle; when present it must be a URL string
      if (s.foto !== null) expect(s.foto).toMatch(/^https?:\/\//);
    }
  });
});

// ── /senador/afastados — AfastamentoAtual ─────────────────────────────────

describe("contract: /senador/afastados", () => {
  it("raw fixture carries the wrapper path and the keys parseSenadorResumo reads", () => {
    expect(afastados).toHaveProperty("AfastamentoAtual.Parlamentares.Parlamentar");
    const items = afastados.AfastamentoAtual.Parlamentares.Parlamentar;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty("IdentificacaoParlamentar.CodigoParlamentar");
    expect(items[0]).toHaveProperty("IdentificacaoParlamentar.NomeParlamentar");
    expect(items[0]).toHaveProperty("Mandato.UfParlamentar");
  });

  it("extractParlamentares + parseSenadorResumo yield well-typed senators", () => {
    const parlamentares = extractParlamentares(afastados);
    expect(parlamentares.length).toBeGreaterThan(0);
    for (const p of parlamentares) {
      const s = parseSenadorResumo(p);
      expect(s.codigo).toBeGreaterThan(0);
      expect(s.nome.length).toBeGreaterThan(0);
      expect(s.uf).toMatch(/^[A-Z]{2}$/);
    }
  });
});

// ── /senador/{codigo} — DetalheParlamentar ────────────────────────────────

describe("contract: /senador/{codigo} detail", () => {
  it("raw fixture carries the wrapper path and the keys parseSenadorDetalhe reads", () => {
    expect(detalhe).toHaveProperty("DetalheParlamentar.Parlamentar.IdentificacaoParlamentar.CodigoParlamentar");
    expect(detalhe).toHaveProperty("DetalheParlamentar.Parlamentar.IdentificacaoParlamentar.NomeParlamentar");
    expect(detalhe).toHaveProperty("DetalheParlamentar.Parlamentar.IdentificacaoParlamentar.NomeCompletoParlamentar");
    expect(detalhe).toHaveProperty("DetalheParlamentar.Parlamentar.IdentificacaoParlamentar.UfParlamentar");
    expect(detalhe).toHaveProperty("DetalheParlamentar.Parlamentar.DadosBasicosParlamentar.DataNascimento");
    expect(detalhe).toHaveProperty("DetalheParlamentar.Parlamentar.DadosBasicosParlamentar.Naturalidade");
  });

  it("parseSenadorDetalhe yields well-typed biographical data", () => {
    // The tool passes response.DetalheParlamentar (the parser handles .Parlamentar itself)
    const d = parseSenadorDetalhe(detalhe.DetalheParlamentar);
    expect(typeof d.codigo).toBe("number");
    expect(d.codigo).toBeGreaterThan(0);
    expect(d.nome.length).toBeGreaterThan(0);
    expect(d.nomeCompleto.length).toBeGreaterThan(0);
    expect(d.dataNascimento).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof d.naturalidade).toBe("string");
    expect(d.uf).toMatch(/^[A-Z]{2}$/);
    expect(typeof d.partido).toBe("string");
    expect(typeof d.email).toBe("string");
    // NomeCivilParlamentar is optional — absent in the sample, so: if present, string
    if (d.nomeCivil !== null) expect(typeof d.nomeCivil).toBe("string");
    // The detail endpoint carries no Mandatos node; the parser must still return an array
    expect(Array.isArray(d.mandatos)).toBe(true);
  });
});

// ── /senador/{codigo}/mandatos — MandatoParlamentar ───────────────────────

describe("contract: /senador/{codigo}/mandatos", () => {
  it("raw fixture carries the wrapper path and the keys parseMandato reads", () => {
    expect(mandatos).toHaveProperty("MandatoParlamentar.Parlamentar.Mandatos.Mandato");
    const items = mandatos.MandatoParlamentar.Parlamentar.Mandatos.Mandato;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty("PrimeiraLegislaturaDoMandato.NumeroLegislatura");
    expect(items[0]).toHaveProperty("PrimeiraLegislaturaDoMandato.DataInicio");
    expect(items[0]).toHaveProperty("UfParlamentar");
    expect(items[0]).toHaveProperty("DescricaoParticipacao");
  });

  it("parseMandato yields well-typed mandates (via the same digArrayRoot path the tool uses)", () => {
    const items = digArrayRoot(
      mandatos,
      [["MandatoParlamentar", "Parlamentar", "Mandatos", "Mandato"]],
      "contract:senador-mandatos",
    ).map(parseMandato);
    expect(items.length).toBeGreaterThan(0);
    for (const m of items) {
      expect(typeof m.legislatura).toBe("number");
      expect(m.legislatura).toBeGreaterThan(0);
      expect(m.uf).toMatch(/^[A-Z]{2}$/);
      expect(typeof m.participacao).toBe("string");
      expect(m.dataInicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Both legislaturas of a mandate carry DataFim upstream, so this stays strict
      expect(m.dataFim).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// ── /senador/{codigo}/comissoes — MembroComissaoParlamentar ───────────────

describe("contract: /senador/{codigo}/comissoes", () => {
  it("raw fixture carries the wrapper path and the keys parseComissaoMembro reads", () => {
    expect(comissoes).toHaveProperty("MembroComissaoParlamentar.Parlamentar.MembroComissoes.Comissao");
    const items = comissoes.MembroComissaoParlamentar.Parlamentar.MembroComissoes.Comissao;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty("IdentificacaoComissao.CodigoComissao");
    expect(items[0]).toHaveProperty("IdentificacaoComissao.SiglaComissao");
    expect(items[0]).toHaveProperty("IdentificacaoComissao.NomeComissao");
    expect(items[0]).toHaveProperty("IdentificacaoComissao.SiglaCasaComissao");
    expect(items[0]).toHaveProperty("DescricaoParticipacao");
    expect(items[0]).toHaveProperty("DataInicio");
  });

  it("parseComissaoMembro yields well-typed memberships", () => {
    const items = comissoes.MembroComissaoParlamentar.Parlamentar.MembroComissoes.Comissao
      .map(parseComissaoMembro);
    expect(items.length).toBeGreaterThan(0);
    for (const c of items) {
      expect(typeof c.codigo).toBe("number");
      expect(c.codigo).toBeGreaterThan(0);
      expect(typeof c.sigla).toBe("string");
      expect(c.sigla.length).toBeGreaterThan(0);
      expect(typeof c.nome).toBe("string");
      expect(c.nome.length).toBeGreaterThan(0);
      expect(typeof c.casa).toBe("string");
      expect(typeof c.participacao).toBe("string");
      expect(c.dataInicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // DataFim only exists on ended memberships — if present, ISO date string
      if (c.dataFim !== null) expect(c.dataFim).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// ── /senador/{codigo}/cargos — CargoParlamentar ───────────────────────────

describe("contract: /senador/{codigo}/cargos", () => {
  it("raw fixture carries the wrapper path and the keys parseCargoSenador reads", () => {
    expect(cargos).toHaveProperty("CargoParlamentar.Parlamentar.Cargos.Cargo");
    const items = cargos.CargoParlamentar.Parlamentar.Cargos.Cargo;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty("DescricaoCargo");
    expect(items[0]).toHaveProperty("DataInicio");
    expect(items[0]).toHaveProperty("IdentificacaoComissao.SiglaComissao");
    expect(items[0]).toHaveProperty("IdentificacaoComissao.NomeComissao");
    expect(items[0]).toHaveProperty("IdentificacaoComissao.SiglaCasaComissao");
  });

  it("parseCargoSenador yields well-typed positions", () => {
    const items = cargos.CargoParlamentar.Parlamentar.Cargos.Cargo.map(parseCargoSenador);
    expect(items.length).toBeGreaterThan(0);
    for (const c of items) {
      expect(typeof c.comissao).toBe("string");
      expect(c.comissao.length).toBeGreaterThan(0);
      expect(typeof c.nomeComissao).toBe("string");
      expect(typeof c.casa).toBe("string");
      expect(typeof c.cargo).toBe("string");
      expect(c.cargo.length).toBeGreaterThan(0);
      expect(c.dataInicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // DataFim only exists on ended positions — if present, ISO date string
      if (c.dataFim !== null) expect(c.dataFim).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// ── /senador/{codigo}/filiacoes — FiliacaoParlamentar ─────────────────────

describe("contract: /senador/{codigo}/filiacoes", () => {
  it("raw fixture carries the wrapper path and the keys parseFiliacao reads", () => {
    expect(filiacoes).toHaveProperty("FiliacaoParlamentar.Parlamentar.Filiacoes.Filiacao");
    const items = filiacoes.FiliacaoParlamentar.Parlamentar.Filiacoes.Filiacao;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty("Partido.SiglaPartido");
    expect(items[0]).toHaveProperty("Partido.NomePartido");
    expect(items[0]).toHaveProperty("DataFiliacao");
  });

  it("parseFiliacao yields well-typed affiliations", () => {
    const items = filiacoes.FiliacaoParlamentar.Parlamentar.Filiacoes.Filiacao.map(parseFiliacao);
    expect(items.length).toBeGreaterThan(0);
    for (const f of items) {
      expect(f.partido.length).toBeGreaterThan(0);
      expect(f.nomePartido.length).toBeGreaterThan(0);
      expect(f.dataFiliacao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // DataDesfiliacao only exists on past affiliations — if present, ISO date string
      if (f.dataDesfiliacao !== null) expect(f.dataDesfiliacao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// ── /senador/{codigo}/licencas — LicencaParlamentar ───────────────────────

describe("contract: /senador/{codigo}/licencas", () => {
  it("raw fixture carries the wrapper path and the keys parseLicenca reads", () => {
    expect(licencas).toHaveProperty("LicencaParlamentar.Parlamentar.Licencas.Licenca");
    const items = licencas.LicencaParlamentar.Parlamentar.Licencas.Licenca;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty("Codigo");
    expect(items[0]).toHaveProperty("DataInicio");
    expect(items[0]).toHaveProperty("SiglaTipoAfastamento");
    expect(items[0]).toHaveProperty("DescricaoTipoAfastamento");
  });

  it("parseLicenca yields well-typed leaves (via the same digArrayRoot path the tool uses)", () => {
    const items = digArrayRoot(
      licencas,
      [["LicencaParlamentar", "Parlamentar", "Licencas", "Licenca"]],
      "contract:senador-licencas",
    ).map(parseLicenca);
    expect(items.length).toBeGreaterThan(0);
    for (const l of items) {
      expect(typeof l.codigo).toBe("number");
      expect(l.codigo).toBeGreaterThan(0);
      expect(l.dataInicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof l.sigla).toBe("string");
      expect(l.sigla.length).toBeGreaterThan(0);
      expect(typeof l.descricao).toBe("string");
      expect(l.descricao.length).toBeGreaterThan(0);
      // dataFim falls back DataFim -> DataFimPrevista; an open leave may have neither
      if (l.dataFim !== null) expect(l.dataFim).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// ── /senador/{codigo}/profissao — anomalous HistoricoAcademicoParlamentar root ──

describe("contract: /senador/{codigo}/profissao", () => {
  it("raw fixture still uses the anomalous HistoricoAcademicoParlamentar wrapper", () => {
    // The upstream serves /profissao under HistoricoAcademicoParlamentar (NOT
    // ProfissaoParlamentar); the tool's first digArrayRoot candidate depends on it.
    expect(profissao).toHaveProperty("HistoricoAcademicoParlamentar.Parlamentar.Profissoes.Profissao");
    const items = profissao.HistoricoAcademicoParlamentar.Parlamentar.Profissoes.Profissao;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty("NomeProfissao");
  });

  it("parseProfissao yields non-empty profession names (via the tool's candidate paths)", () => {
    const items = digArrayRoot(
      profissao,
      [
        ["HistoricoAcademicoParlamentar", "Parlamentar", "Profissoes", "Profissao"],
        ["ProfissaoParlamentar", "Parlamentar", "Profissoes", "Profissao"],
        ["Profissoes", "Profissao"],
      ],
      "contract:senador-profissao",
    ).map(parseProfissao);
    expect(items.length).toBeGreaterThan(0);
    for (const p of items) {
      expect(typeof p.nome).toBe("string");
      expect(p.nome.length).toBeGreaterThan(0);
    }
  });
});

// ── v3 /votacao — flat camelCase array with per-senator votes ─────────────

describe("contract: v3 /votacao (senator vote extraction)", () => {
  it("raw fixture is a flat array with the keys parseVotoSenador reads", () => {
    expect(Array.isArray(votacoes)).toBe(true);
    expect(votacoes.length).toBeGreaterThan(0);
    const v = votacoes[0];
    expect(v).toHaveProperty("codigoSessaoVotacao");
    expect(v).toHaveProperty("dataSessao");
    expect(v).toHaveProperty("identificacao");
    expect(v).toHaveProperty("descricaoVotacao");
    expect(v).toHaveProperty("resultadoVotacao");
    expect(Array.isArray(v.votos)).toBe(true);
    expect(v.votos.length).toBeGreaterThan(0);
    expect(v.votos[0]).toHaveProperty("codigoParlamentar");
    expect(v.votos[0]).toHaveProperty("siglaVotoParlamentar");
    // descricaoVotoParlamentar may be null but the key must exist (parser falls back to sigla)
    expect(v.votos[0]).toHaveProperty("descricaoVotoParlamentar");
    expect(typeof v.votos[0].codigoParlamentar).toBe("number");
  });

  it("parseVotoSenador extracts a well-typed vote for a senator present in the roll call", () => {
    const item = votacoes[0];
    // Pick a senator that actually voted, so the test survives fixture refreshes
    const codigoSenador = item.votos[0].codigoParlamentar as number;
    const voto = parseVotoSenador(item, codigoSenador);
    expect(typeof voto.codigoVotacao).toBe("number");
    expect(voto.codigoVotacao).toBeGreaterThan(0);
    expect(voto.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(voto.materia.length).toBeGreaterThan(0);
    // descricaoVotoParlamentar is null in v3 dumps; the sigla fallback must yield a value
    expect(typeof voto.voto).toBe("string");
    expect(voto.voto.length).toBeGreaterThan(0);
    if (voto.descricao !== null) expect(typeof voto.descricao).toBe("string");
    if (voto.resultado !== null) expect(typeof voto.resultado).toBe("string");
  });
});
