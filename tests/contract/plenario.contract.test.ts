/**
 * Upstream shape-drift contract tests for src/tools/plenario.ts.
 *
 * Contract tier: run with `npm run test:contract` (vitest.contract.config.ts) —
 * excluded from the default `npm test` suite. Fixtures in tests/contract/fixtures/
 * are raw upstream captures (sorted keys, arrays truncated to 3 items), refreshed
 * by `npm run contract:refresh`. A failure right after a live refresh means the
 * upstream changed shape (renamed wrapper/keys), not a bug in these tests.
 *
 * Per endpoint: (a) the RAW fixture still carries the wrapper path + keys the
 * parser depends on; (b) the real exported parser yields defined/typed fields.
 * Presence/shape only — never exact values.
 */
import { describe, it, expect } from "vitest";
import {
  stripWrapper,
  firstArrayDeep,
  extractSessoesResultado,
  parseSessaoAgenda,
  parseSessaoResultado,
  parseOrientacaoVotacao,
  parseVeto,
} from "../../src/tools/plenario.js";
import agendaMesRaw from "./fixtures/legado/agenda-plenario-mes.json?raw";
import resultadoMesRaw from "./fixtures/legado/resultado-plenario-mes.json?raw";
import orientacaoRaw from "./fixtures/legado/orientacao-bancada.json?raw";
import vetosRaw from "./fixtures/legado/vetos.json?raw";
import legislaturasRaw from "./fixtures/legado/tabelas-plenario-legislaturas.json?raw";

// ── /plenario/agenda/mes — senado_agenda_plenario ─────────────────────────

describe("contract: /plenario/agenda (AgendaPlenario)", () => {
  const raw = JSON.parse(agendaMesRaw);

  it("raw fixture keeps the AgendaPlenario.Sessoes.Sessao wrapper and session keys", () => {
    expect(raw).toHaveProperty("AgendaPlenario.Sessoes.Sessao");
    const sessoes = raw.AgendaPlenario.Sessoes.Sessao;
    expect(Array.isArray(sessoes)).toBe(true);
    expect(sessoes.length).toBeGreaterThan(0);
    const s = sessoes[0];
    for (const k of ["CodigoSessao", "Data", "Hora", "TipoSessao", "SituacaoSessao"]) {
      expect(s).toHaveProperty(k);
    }
    // Materias is present on deliberative sessions in this capture; each item
    // carries the identification fields the pauta mapper reads.
    expect(s).toHaveProperty("Materias.Materia");
    const materias = s.Materias.Materia;
    expect(Array.isArray(materias)).toBe(true);
    const m = materias[0];
    for (const k of ["DescricaoIdentificacaoMateria", "Ementa", "NomeAutor", "SiglaMateria"]) {
      expect(m).toHaveProperty(k);
    }
    // Optional: Parecer only exists on matters already reported on.
    if ("Parecer" in m) expect(typeof m.Parecer).toBe("string");
  });

  it("parseSessaoAgenda yields typed session fields from the fixture", () => {
    const sessoes = raw.AgendaPlenario.Sessoes.Sessao.map(parseSessaoAgenda);
    expect(sessoes.length).toBeGreaterThan(0);
    const s = sessoes[0];
    expect(typeof s.codigo).toBe("number");
    expect(s.codigo).toBeGreaterThan(0);
    expect(typeof s.data).toBe("string");
    expect(s.data!.length).toBeGreaterThan(0);
    expect(typeof s.tipo).toBe("string");
    expect(s.tipo!.length).toBeGreaterThan(0);
    expect(typeof s.situacao).toBe("string");
    // pauta is defined for sessions with Materias in the capture
    expect(Array.isArray(s.pauta)).toBe(true);
    const p = s.pauta![0];
    expect(typeof p.materia).toBe("string");
    expect(typeof p.ementa).toBe("string");
  });
});

// ── /plenario/resultado — senado_resultado_plenario ───────────────────────

describe("contract: /plenario/resultado (ResultadoPlenario)", () => {
  const raw = JSON.parse(resultadoMesRaw);

  it("raw fixture keeps the Sessoes.Sessao wrapper and item keys under Itens.Item", () => {
    // The tool unwraps via stripWrapper (single-key root wrapper), then Sessoes.Sessao.
    expect(Object.keys(raw)).toHaveLength(1);
    expect(raw).toHaveProperty("ResultadoPlenario.Sessoes.Sessao");
    const sessoes = raw.ResultadoPlenario.Sessoes.Sessao;
    expect(Array.isArray(sessoes)).toBe(true);
    expect(sessoes.length).toBeGreaterThan(0);
    const s = sessoes[0];
    for (const k of ["codigoSessao", "dataSessao", "horaSessao", "siglaCasa", "descricaoTipoSessao"]) {
      expect(s).toHaveProperty(k);
    }
    expect(s).toHaveProperty("Itens.Item");
    const item = s.Itens.Item[0];
    for (const k of ["codigoMateria", "identificacao", "ementaPapeleta", "textoResultado"]) {
      expect(item).toHaveProperty(k);
    }
    // Optional: parecer exists only on reported matters.
    if ("parecer" in item) expect(typeof item.parecer).toBe("string");
  });

  it("extractSessoesResultado + parseSessaoResultado yield typed sessions/items", () => {
    const sessoes = extractSessoesResultado(raw).map(parseSessaoResultado);
    expect(sessoes.length).toBeGreaterThan(0);
    const s = sessoes[0];
    expect(typeof s.codigoSessao).toBe("number");
    expect(s.codigoSessao).toBeGreaterThan(0);
    expect(typeof s.data).toBe("string");
    expect(typeof s.casa).toBe("string");
    expect(Array.isArray(s.itens)).toBe(true);
    expect(s.itens.length).toBeGreaterThan(0);
    const i = s.itens[0];
    expect(typeof i.codigoMateria).toBe("number");
    expect(typeof i.identificacao).toBe("string");
    // resultado is null for not-yet-deliberated items (empty textoResultado), string otherwise.
    expect(i.resultado === null || typeof i.resultado === "string").toBe(true);
    // At least one item in the capture has been deliberated (non-null resultado).
    const deliberado = sessoes.flatMap((x) => x.itens).find((x) => x.resultado !== null);
    expect(deliberado).toBeDefined();
  });
});

// ── /plenario/votacao/orientacaoBancada — senado_orientacao_bancada ───────

describe("contract: /plenario/votacao/orientacaoBancada (flat camelCase)", () => {
  const raw = JSON.parse(orientacaoRaw);

  it("raw fixture keeps the votacoes[] root and the vote-tally keys", () => {
    expect(raw).toHaveProperty("votacoes");
    expect(Array.isArray(raw.votacoes)).toBe(true);
    expect(raw.votacoes.length).toBeGreaterThan(0);
    const v = raw.votacoes[0];
    for (const k of [
      "codigoVotacaoSve",
      "descricaoVotacao",
      "dataInicioVotacao",
      "dataTerminoVotacao",
      "descricaoSessao",
      "qtdVotosSim",
      "qtdVotosNao",
      "qtdVotosAbstencao",
      "qtdObstrucoes",
      "quorumInicial",
      "quorumFinal",
      "orientacoesLideranca",
    ]) {
      expect(v).toHaveProperty(k);
    }
    const o = v.orientacoesLideranca[0];
    expect(o).toHaveProperty("partido");
    expect(o).toHaveProperty("voto");
  });

  it("parseOrientacaoVotacao yields typed tallies and orientacoes", () => {
    const votacoes = raw.votacoes.map(parseOrientacaoVotacao);
    const v = votacoes[0];
    expect(typeof v.codigoVotacao).toBe("number");
    expect(typeof v.totalSim).toBe("number");
    expect(typeof v.totalNao).toBe("number");
    expect(typeof v.totalAbstencao).toBe("number");
    expect(typeof v.dataInicio).toBe("string");
    expect(Array.isArray(v.orientacoes)).toBe(true);
    expect(v.orientacoes.length).toBeGreaterThan(0);
    expect(typeof v.orientacoes[0].partido).toBe("string");
    expect(typeof v.orientacoes[0].voto).toBe("string");
  });
});

// ── /materia/vetos — senado_vetos ──────────────────────────────────────────

describe("contract: /materia/vetos (Vetos.Veto)", () => {
  const raw = JSON.parse(vetosRaw);

  it("raw fixture keeps a single-key root wrapper unwrapping to Vetos.Veto", () => {
    // The top wrapper NAME varies by status (e.g. VetosAposRcnTramitandoCN), so the
    // tool relies on stripWrapper's single-key unwrap rather than a fixed name.
    expect(Object.keys(raw)).toHaveLength(1);
    const body = stripWrapper(raw);
    expect(body).toHaveProperty("Vetos.Veto");
    const vetos = (body as any).Vetos.Veto;
    expect(Array.isArray(vetos)).toBe(true);
    expect(vetos.length).toBeGreaterThan(0);
    const v = vetos[0];
    for (const k of ["Codigo", "Materia", "MateriaVetada", "Total", "Assunto", "DataSobrestacaoPauta"]) {
      expect(v).toHaveProperty(k);
    }
    for (const k of ["Sigla", "Numero", "Ano", "Ementa", "EmTramitacao"]) {
      expect(v.Materia).toHaveProperty(k);
    }
    for (const k of ["Sigla", "Numero", "Ano", "Codigo"]) {
      expect(v.MateriaVetada).toHaveProperty(k);
    }
  });

  it("parseVeto yields typed veto fields", () => {
    const body = stripWrapper(raw);
    const vetos = ((body as any).Vetos.Veto as any[]).map(parseVeto);
    const v = vetos[0];
    expect(typeof v.codigo).toBe("number");
    expect(v.codigo).toBeGreaterThan(0);
    expect(typeof v.identificacao).toBe("string");
    expect(v.identificacao!.length).toBeGreaterThan(0);
    expect(typeof v.ementa).toBe("string");
    expect(typeof v.emTramitacao).toBe("boolean");
    // Total: "Sim"/"Nao" maps to total/parcial
    expect(["total", "parcial"]).toContain(v.tipo);
    expect(typeof v.dataLimiteVotacao).toBe("string");
    expect(v.materiaVetada).not.toBeNull();
    expect(typeof v.materiaVetada!.codigo).toBe("number");
    expect(typeof v.materiaVetada!.identificacao).toBe("string");
  });
});

// ── /plenario/lista/legislaturas — senado_tabelas_plenario ────────────────

describe("contract: /plenario/lista/legislaturas (reference table)", () => {
  const raw = JSON.parse(legislaturasRaw);

  it("firstArrayDeep(stripWrapper) resolves non-empty rows with the domain keys", () => {
    const linhas = firstArrayDeep(stripWrapper(raw));
    expect(Array.isArray(linhas)).toBe(true);
    expect(linhas.length).toBeGreaterThan(0);
    const l = linhas[0];
    for (const k of ["NumeroLegislatura", "DataInicio", "DataFim"]) {
      expect(l).toHaveProperty(k);
    }
    expect(typeof l.NumeroLegislatura).toBe("string");
    // Optional: SessoesLegislativas is absent on future legislatures.
    const comSessoes = linhas.find((x: any) => x.SessoesLegislativas);
    if (comSessoes) {
      expect(comSessoes).toHaveProperty("SessoesLegislativas.SessaoLegislativa");
    }
  });
});
