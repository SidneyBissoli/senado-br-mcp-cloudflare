/**
 * Upstream shape-drift contract tests for src/tools/comissoes.ts.
 *
 * Contract tier: `npm run test:contract` (vitest.contract.config.ts) — excluded from the
 * default `npm test` suite. Fixtures are raw upstream captures (sorted keys, arrays
 * truncated to 3 items) refreshed by `npm run contract:refresh`; a failure right after a
 * live refresh means real upstream shape drift, not a test bug.
 *
 * Per endpoint: (a) assert the RAW fixture still carries the wrapper path + keys the
 * parser navigates, and (b) run the REAL exported parser on fixture data asserting
 * presence/types only — never exact values. Endpoints whose parsing is an inline map
 * callback (not exported) get raw-fixture key assertions only.
 */
import { describe, it, expect } from "vitest";
import {
  parseComissaoResumo,
  formatDateYMD,
  buildRequerimentosCpiResult,
  REQUERIMENTOS_CPI_AVISO_VAZIO,
  OBTER_COMISSAO_FINALIDADE_AVISO,
} from "../../src/tools/comissoes.js";
import { digArrayRoot } from "../../src/utils/upstream-parse.js";
import { ensureArray } from "../../src/utils/validation.js";
import comissaoListaRaw from "./fixtures/legado/comissao-lista.json?raw";
import comissaoDetalheRaw from "./fixtures/legado/comissao-detalhe.json?raw";
import comissaoMembrosRaw from "./fixtures/legado/comissao-membros.json?raw";
import comissaoAgendaRaw from "./fixtures/legado/comissao-agenda.json?raw";
import reuniaoDetalheRaw from "./fixtures/legado/reuniao-detalhe.json?raw";
import distribuicaoAutoriaRaw from "./fixtures/legado/distribuicao-autoria.json?raw";
import distribuicaoRelatoriaRaw from "./fixtures/legado/distribuicao-relatoria.json?raw";

const comissaoLista = JSON.parse(comissaoListaRaw);
const comissaoDetalhe = JSON.parse(comissaoDetalheRaw);
const comissaoMembros = JSON.parse(comissaoMembrosRaw);
const comissaoAgenda = JSON.parse(comissaoAgendaRaw);
const reuniaoDetalhe = JSON.parse(reuniaoDetalheRaw);
const distribuicaoAutoria = JSON.parse(distribuicaoAutoriaRaw);
const distribuicaoRelatoria = JSON.parse(distribuicaoRelatoriaRaw);

// ── /comissao/lista/colegiados (senado_listar_comissoes; inline map — raw only) ──

describe("contract: /comissao/lista/colegiados", () => {
  it("raw fixture keeps the wrapper path and list-item keys the inline map reads", () => {
    expect(comissaoLista).toHaveProperty("ListaColegiados.Colegiados.Colegiado");
    const colegiados = comissaoLista.ListaColegiados.Colegiados.Colegiado;
    expect(Array.isArray(colegiados)).toBe(true);
    expect(colegiados.length).toBeGreaterThan(0);
    for (const k of ["Codigo", "Sigla", "Nome", "DescricaoTipoColegiado", "SiglaCasa"]) {
      expect(colegiados[0]).toHaveProperty(k);
    }
    expect(typeof colegiados[0].Codigo).toBe("string");
    expect(typeof colegiados[0].Sigla).toBe("string");
  });

  it("every item carries Sigla + Codigo (the pair resolveComissaoCodigo matches on)", () => {
    // resolveComissaoCodigo fetches, so it is not called here; this asserts the exact
    // fields it reads to bridge sigla -> numeric code for the detail/membros endpoints.
    const colegiados = comissaoLista.ListaColegiados.Colegiados.Colegiado;
    for (const c of colegiados) {
      expect(typeof c.Sigla).toBe("string");
      expect(c.Sigla.length).toBeGreaterThan(0);
      expect(typeof c.Codigo).toBe("string");
      expect(c.Codigo).toMatch(/^\d+$/);
    }
  });
});

// ── /comissao/{codigo} (senado_obter_comissao secao=resumo → parseComissaoResumo) ──

describe("contract: /comissao/{codigo} detail", () => {
  const colegiado = ensureArray(
    comissaoDetalhe?.ComissoesCongressoNacional?.Colegiados?.Colegiado,
  )[0] as any;

  it("raw fixture keeps the wrapper path and keys parseComissaoResumo navigates", () => {
    expect(comissaoDetalhe).toHaveProperty("ComissoesCongressoNacional.Colegiados.Colegiado");
    expect(colegiado).toBeDefined();
    for (const k of ["CodigoColegiado", "SiglaColegiado", "NomeColegiado"]) {
      expect(colegiado).toHaveProperty(k);
    }
    expect(colegiado).toHaveProperty("TipoColegiado.TipoColegiado");
    expect(colegiado).toHaveProperty("QuantidadesMembros.Distribuicao.Senadores");
    // Cargos.Cargo[] carries the mesa (presidente/vice) the parser scans by TipoCargo.
    const cargos = ensureArray(colegiado.Cargos?.Cargo);
    expect(cargos.length).toBeGreaterThan(0);
    for (const k of ["TipoCargo", "NomeParlamentar", "CodigoParlamentar"]) {
      expect(cargos[0]).toHaveProperty(k);
    }
    // Finalidade is optional upstream: only temporary colegiados (CPIs etc.) publish it;
    // this fixture is a permanent committee, so the key is legitimately absent.
    if ("Finalidade" in colegiado) {
      expect(typeof colegiado.Finalidade).toBe("string");
    }
  });

  it("parseComissaoResumo yields typed fields from the fixture colegiado", () => {
    const parsed = parseComissaoResumo(colegiado, colegiado.SiglaColegiado, "resumo") as any;
    expect(typeof parsed.codigo).toBe("number");
    expect(parsed.codigo).toBeGreaterThan(0);
    expect(typeof parsed.sigla).toBe("string");
    expect(parsed.sigla.length).toBeGreaterThan(0);
    expect(typeof parsed.nome).toBe("string");
    expect(parsed.nome.length).toBeGreaterThan(0);
    // tipo comes from TipoColegiado.TipoColegiado; if present it must be a string.
    if (parsed.tipo !== null) expect(typeof parsed.tipo).toBe("string");
    // presidente/vice are found by TipoCargo scan; when found, they are typed objects.
    expect(parsed.presidente).not.toBeNull();
    expect(typeof parsed.presidente.nome).toBe("string");
    expect(typeof parsed.presidente.codigo).toBe("number");
    if (parsed.vicePresidente !== null) {
      expect(typeof parsed.vicePresidente.nome).toBe("string");
      expect(typeof parsed.vicePresidente.codigo).toBe("number");
    }
    // Member totals: numbers when the Distribuicao block is present, else null.
    for (const k of ["totalMembros", "titulares", "suplentes"] as const) {
      expect(parsed[k] === null || typeof parsed[k] === "number").toBe(true);
    }
    // finalidade is conditional upstream; when null the parser attaches the aviso.
    if (parsed.finalidade === null) {
      expect(parsed.aviso).toBe(OBTER_COMISSAO_FINALIDADE_AVISO);
    } else {
      expect(typeof parsed.finalidade).toBe("string");
    }
  });
});

// ── /composicao/comissao/{codigo} (senado_obter_comissao secao=membros; inline map) ──

describe("contract: /composicao/comissao/{codigo} membros", () => {
  it("raw fixture resolves through the tool's digArrayRoot candidates with member keys", () => {
    // Same candidate paths the tool passes to digArrayRoot (active vs. last composition).
    const membros = digArrayRoot(
      comissaoMembros,
      [
        ["ComposicaoAtivaComissaoSf", "ComposicaoComissao", "Membros", "Membro"],
        ["UltimaComposicaoComissaoSf", "ComposicaoComissao", "Membros", "Membro"],
      ],
      "contract:comissao-membros",
    ) as any[];
    expect(membros.length).toBeGreaterThan(0);
    // Fixture carries CodigoMembro (the parser's first choice; CodigoParlamentar is the
    // fallback key) plus the vaga fields the inline map reads.
    for (const k of ["NomeMembro", "TipoVaga", "IndicadorVagaAtiva", "DataInicioMembroVaga"]) {
      expect(membros[0]).toHaveProperty(k);
    }
    expect("CodigoMembro" in membros[0] || "CodigoParlamentar" in membros[0]).toBe(true);
    expect(typeof membros[0].NomeMembro).toBe("string");
    // IndicadorVagaAtiva is the literal string "Sim"/"Não" the parser compares against.
    expect(typeof membros[0].IndicadorVagaAtiva).toBe("string");
    expect(membros[0].DataInicioMembroVaga).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── /comissao/agenda/{...} (senado_reunioes_comissao / senado_agenda_comissoes; inline map) ──

describe("contract: /comissao/agenda range", () => {
  it("raw fixture keeps AgendaReuniao.reunioes.reuniao[] with the camelCase keys the map reads", () => {
    expect(comissaoAgenda).toHaveProperty("AgendaReuniao.reunioes.reuniao");
    const reunioes = ensureArray(comissaoAgenda.AgendaReuniao.reunioes.reuniao) as any[];
    expect(reunioes.length).toBeGreaterThan(0);
    const r0 = reunioes[0];
    for (const k of ["codigo", "dataInicio", "colegiadoCriador", "situacao"]) {
      expect(r0).toHaveProperty(k);
    }
    expect(r0.codigo).toMatch(/^\d+$/);
    // dataInicio is an ISO datetime split into data/hora by the tool.
    expect(r0.dataInicio).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    // The sigla filter (senado_reunioes_comissao) reads colegiadoCriador.sigla.
    expect(typeof r0.colegiadoCriador.sigla).toBe("string");
    expect(r0.colegiadoCriador.sigla.length).toBeGreaterThan(0);
    expect(typeof r0.colegiadoCriador.nome).toBe("string");
    // tipo.descricao feeds the parsed `tipo`; descricao/titulo feed `descricao`.
    expect(typeof r0.tipo?.descricao).toBe("string");
    expect("descricao" in r0 || "titulo" in r0).toBe(true);
    // Optional: local, if present, is a string.
    if (r0.local != null) expect(typeof r0.local).toBe("string");
  });
});

// ── /comissao/reuniao/{codigo} (senado_reuniao_comissao; inline parsing — raw only) ──

describe("contract: /comissao/reuniao/{codigo} detail", () => {
  // Same unwrap chain as the tool: DetalheReuniao.reuniao ?? reuniao ?? response.
  const re =
    (reuniaoDetalhe as any)?.DetalheReuniao?.reuniao ??
    (reuniaoDetalhe as any)?.reuniao ??
    reuniaoDetalhe;

  it("raw fixture keeps the reuniao root and the scalar keys the tool reads", () => {
    expect(reuniaoDetalhe).toHaveProperty("DetalheReuniao.reuniao");
    for (const k of ["codigo", "dataInicio", "situacao", "realizada", "secreta"]) {
      expect(re).toHaveProperty(k);
    }
    expect(re.codigo).toMatch(/^\d+$/);
    expect(re.dataInicio).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // titulo/descricao: at least one must exist for the parsed `titulo`.
    expect("titulo" in re || "descricao" in re).toBe(true);
    expect(typeof re.colegiadoCriador?.sigla).toBe("string");
    // realizada/secreta arrive as the strings "true"/"false" (or legacy "S").
    expect(typeof re.realizada).toBe("string");
    expect(typeof re.secreta).toBe("string");
    // Optional scalars: if present, must be strings.
    if (re.tipoPresenca != null) expect(typeof re.tipoPresenca).toBe("string");
    if (re.urlUltimaAtaPublicada != null) expect(typeof re.urlUltimaAtaPublicada).toBe("string");
    // presidente may be an object (with .nome) or a plain string.
    if (re.presidente != null) {
      expect(
        typeof re.presidente === "string" || typeof re.presidente.nome === "string",
      ).toBe(true);
    }
  });

  it("partes resolve through the tool's ensureArray(re.partes?.parte ?? re.partes) chain", () => {
    // NOTE: in this fixture `partes` is a SINGLE parte object (no `parte` inner key) —
    // the upstream unwraps the array when unitary; the tool's fallback chain handles it.
    expect(re).toHaveProperty("partes");
    const partes = ensureArray(re.partes?.parte ?? re.partes) as any[];
    expect(partes.length).toBeGreaterThan(0);
    const p0 = partes[0];
    expect(p0).toHaveProperty("sequencialFormatado");
    expect("nome" in p0 || "descricaoTipo" in p0).toBe(true);
    expect(p0).toHaveProperty("isDeliberativa");
    // evento is optional per parte; when present, the tool reads finalidade/resultadoTexto.
    if (p0.evento != null) {
      if (p0.evento.finalidade != null) expect(typeof p0.evento.finalidade).toBe("string");
      if (p0.evento.resultadoTexto != null) expect(typeof p0.evento.resultadoTexto).toBe("string");
    }
  });
});

// ── /materia/distribuicao/autoria (senado_distribuicao_materias tipo=autoria; inline map) ──

describe("contract: /materia/distribuicao/autoria", () => {
  it("raw fixture keeps the wrapper path and per-parlamentar keys the map reads", () => {
    expect(distribuicaoAutoria).toHaveProperty("ParlamentarcomMaterianaComissao.Comissoes.Comissao");
    const comissao = ensureArray(
      distribuicaoAutoria.ParlamentarcomMaterianaComissao.Comissoes.Comissao,
    )[0] as any;
    expect(comissao).toBeDefined();
    const parlamentares = ensureArray(comissao?.Parlamentares?.Parlamentar) as any[];
    expect(parlamentares.length).toBeGreaterThan(0);
    for (const k of ["Codigo", "Nome", "SiglaPartido", "Uf", "Quantidade"]) {
      expect(parlamentares[0]).toHaveProperty(k);
    }
    expect(parlamentares[0].Codigo).toMatch(/^\d+$/);
    expect(parlamentares[0].Quantidade).toMatch(/^\d+$/);
    // Uf is a string here but the parser also tolerates an array of strings.
    const uf = parlamentares[0].Uf;
    expect(typeof uf === "string" || Array.isArray(uf)).toBe(true);
  });
});

// ── /materia/distribuicao/relatoria/{sigla} (tipo=relatoria; inline aggregation) ──

describe("contract: /materia/distribuicao/relatoria/{sigla}", () => {
  it("raw fixture keeps DistribuicaodeRelatoria.Totais.Parlamentares[] with aggregation keys", () => {
    expect(distribuicaoRelatoria).toHaveProperty("DistribuicaodeRelatoria.Totais.Parlamentares");
    const parlamentares = ensureArray(
      distribuicaoRelatoria.DistribuicaodeRelatoria.Totais.Parlamentares,
    ) as any[];
    expect(parlamentares.length).toBeGreaterThan(0);
    for (const k of ["CodigoParlamentar", "Parlamentar", "Quantidade", "Partido", "Uf"]) {
      expect(parlamentares[0]).toHaveProperty(k);
    }
    expect(parlamentares[0].CodigoParlamentar).toMatch(/^\d+$/);
    expect(parlamentares[0].Quantidade).toMatch(/^\d+$/);
    expect(typeof parlamentares[0].Parlamentar).toBe("string");
    // In this capture Uf comes as an ARRAY of strings (the parser takes Uf[0]);
    // a plain string is equally valid upstream.
    const uf = parlamentares[0].Uf;
    expect(typeof uf === "string" || Array.isArray(uf)).toBe(true);
    if (Array.isArray(uf)) expect(typeof uf[0]).toBe("string");
  });
});

// ── Exported pure helpers (behavioral contract, no fixture) ──────────────────────

describe("contract: exported comissoes helpers", () => {
  it("formatDateYMD emits the YYYYMMDD format the agenda endpoints require", () => {
    expect(formatDateYMD(new Date(2026, 0, 5))).toMatch(/^\d{8}$/);
  });

  it("buildRequerimentosCpiResult flags the degenerate empty upstream with the aviso", () => {
    const empty = buildRequerimentosCpiResult("CPIX", 0, []);
    expect(empty.count).toBe(0);
    expect(empty.aviso).toBe(REQUERIMENTOS_CPI_AVISO_VAZIO);
    const nonEmpty = buildRequerimentosCpiResult("CPIX", 0, [{ numero: "1" }]);
    expect(nonEmpty.count).toBe(1);
    expect(nonEmpty).not.toHaveProperty("aviso");
  });
});
