/**
 * Upstream shape-drift contract tests for src/tools/votacao-comissao.ts
 * (/votacaoComissao/*, legacy PascalCase).
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
import { parseVotacaoComissao, filtrarPorData } from "../../src/tools/votacao-comissao.js";
import { digArrayRoot } from "../../src/utils/upstream-parse.js";
import votacaoComissaoRaw from "./fixtures/legado/votacao-comissao.json?raw";

const raw = JSON.parse(votacaoComissaoRaw);
// Same root path the tool passes to digArrayRoot (VOTACAO_COMISSAO_ROOT).
const ROOT = [["VotacoesComissao", "Votacoes", "Votacao"]];

describe("contract: /votacaoComissao (VotacoesComissao.Votacoes.Votacao)", () => {
  it("raw fixture keeps the VotacoesComissao.Votacoes.Votacao wrapper path", () => {
    expect(raw).toHaveProperty("VotacoesComissao.Votacoes.Votacao");
    // digArrayRoot must resolve the same path WITHOUT throwing RootNotFoundError
    // and yield a non-empty collection.
    const votacoes = digArrayRoot(raw, ROOT, "contract:votacao-comissao");
    expect(Array.isArray(votacoes)).toBe(true);
    expect(votacoes.length).toBeGreaterThan(0);
  });

  it("raw items carry the parser-critical keys (PascalCase)", () => {
    const votacoes = digArrayRoot(raw, ROOT, "contract:votacao-comissao") as any[];
    const v = votacoes[0];
    for (const k of [
      "CodigoVotacao",
      "DataHoraInicioReuniao", // date field the parser reads first
      "SiglaColegiado", // fixture uses SiglaColegiado (not SiglaComissao)
      "CodigoReuniao",
      "IdentificacaoMateria",
      "DescricaoVotacao",
      "Votos",
    ]) {
      expect(v).toHaveProperty(k);
    }
    expect(v).toHaveProperty("Votos.Voto");
    const voto = v.Votos.Voto[0];
    for (const k of [
      "CodigoParlamentar",
      "NomeParlamentar",
      "QualidadeVoto", // vote quality field ("S"/"N"/"A"...) the tally counts
      "SiglaPartidoParlamentar",
    ]) {
      expect(voto).toHaveProperty(k);
    }
  });

  it("parseVotacaoComissao yields typed fields, tally and per-senator votes", () => {
    const votacoes = (digArrayRoot(raw, ROOT, "contract:votacao-comissao") as any[])
      .map(parseVotacaoComissao);
    const v = votacoes[0];
    expect(v.codigo).not.toBeNull();
    expect(typeof v.data).toBe("string");
    // DataHoraInicioReuniao is an ISO datetime; the local date filter slices the first 10 chars.
    expect(v.data).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(typeof v.comissao).toBe("string");
    expect(v.comissao!.length).toBeGreaterThan(0);
    expect(v.reuniao).not.toBeNull();
    expect(typeof v.materia).toBe("string");
    expect(typeof v.descricao).toBe("string");
    // Tally is computed in-Worker from the vote quality codes.
    expect(typeof v.totalSim).toBe("number");
    expect(typeof v.totalNao).toBe("number");
    expect(typeof v.totalAbstencao).toBe("number");
    expect(v.totalSim + v.totalNao + v.totalAbstencao).toBeLessThanOrEqual(v.votos.length);
    expect(Array.isArray(v.votos)).toBe(true);
    expect(v.votos.length).toBeGreaterThan(0);
    const vt = v.votos[0];
    expect(vt.codigoSenador).not.toBeNull();
    expect(typeof vt.nome).toBe("string");
    expect(vt.nome!.length).toBeGreaterThan(0);
    expect(typeof vt.partido).toBe("string");
    expect(typeof vt.voto).toBe("string");
    expect(vt.voto!.length).toBeGreaterThan(0);
  });

  it("filtrarPorData keeps everything on an all-inclusive window and drops everything outside", () => {
    const votacoes = (digArrayRoot(raw, ROOT, "contract:votacao-comissao") as any[])
      .map(parseVotacaoComissao);
    // Wide window: all parsed items have a date within [1900, 2999].
    expect(filtrarPorData(votacoes, "19000101", "29991231")).toHaveLength(votacoes.length);
    // Impossible window: nothing predates 1900.
    expect(filtrarPorData(votacoes, undefined, "19000101")).toHaveLength(0);
    // No window: pass-through.
    expect(filtrarPorData(votacoes)).toHaveLength(votacoes.length);
  });
});
