/**
 * Upstream shape-drift contract tests for src/tools/taquigrafia.ts
 * (/taquigrafia/notas/* and /taquigrafia/videos/*).
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
  parseQuartoResumo,
  parseQuartoTexto,
  parseVideoUnidade,
} from "../../src/tools/taquigrafia.js";
import notasRaw from "./fixtures/legado/notas-taquigraficas.json?raw";
import videosRaw from "./fixtures/legado/videos-taquigrafia.json?raw";

// ── /taquigrafia/notas — senado_notas_taquigraficas ────────────────────────

describe("contract: /taquigrafia/notas (notasTaquigraficas.quartos)", () => {
  const raw = JSON.parse(notasRaw);
  // The tool reads `response.notasTaquigraficas ?? response`.
  const nt = raw?.notasTaquigraficas ?? raw;

  it("raw fixture keeps the notasTaquigraficas wrapper, header and quartos[] keys", () => {
    expect(raw).toHaveProperty("notasTaquigraficas");
    // Session header fields surfaced as `sessao`/`data` in the tool result.
    expect(nt).toHaveProperty("dadosSessao");
    expect(nt).toHaveProperty("data");
    expect(typeof nt.data).toBe("string");
    expect(nt.dadosSessao).toHaveProperty("codigo");
    expect(nt.dadosSessao).toHaveProperty("descricao");
    expect(nt).toHaveProperty("quartos");
    expect(Array.isArray(nt.quartos)).toBe(true);
    expect(nt.quartos.length).toBeGreaterThan(0);
    const q = nt.quartos[0];
    for (const k of ["sequencia", "dataInicio", "dataFim", "texto", "linkAudio"]) {
      expect(q).toHaveProperty(k);
    }
    expect(typeof q.texto).toBe("string");
    expect(q.texto.length).toBeGreaterThan(0);
  });

  it("parseQuartoResumo yields typed summary blocks with a capped excerpt", () => {
    const blocos = (nt.quartos as any[]).map(parseQuartoResumo);
    expect(blocos.length).toBeGreaterThan(0);
    const b = blocos[0];
    expect(typeof b.sequencia).toBe("number");
    expect(b.sequencia).toBeGreaterThanOrEqual(1);
    expect(typeof b.dataInicio).toBe("string");
    expect(typeof b.dataFim).toBe("string");
    expect(typeof b.trecho).toBe("string");
    // 200-char excerpt + optional ellipsis
    expect(b.trecho.length).toBeLessThanOrEqual(201);
    expect(typeof b.caracteres).toBe("number");
    expect(b.caracteres).toBeGreaterThan(0);
    expect(typeof b.linkAudio).toBe("string");
    expect(b.linkAudio).toMatch(/^https?:\/\//);
  });

  it("parseQuartoTexto yields the full transcript text per block", () => {
    const blocos = (nt.quartos as any[]).map(parseQuartoTexto);
    const b = blocos[0];
    expect(typeof b.sequencia).toBe("number");
    expect(typeof b.texto).toBe("string");
    expect(b.texto.length).toBeGreaterThan(0);
    // Full text mode must not truncate: same length as the raw field.
    expect(b.texto.length).toBe((nt.quartos[0].texto as string).length);
  });
});

// ── /taquigrafia/videos — senado_videos_taquigrafia ────────────────────────

describe("contract: /taquigrafia/videos (flat array of descriptive units)", () => {
  const units: any[] = JSON.parse(videosRaw);

  it("raw fixture is a non-empty array at the root with the unit keys", () => {
    expect(Array.isArray(units)).toBe(true);
    expect(units.length).toBeGreaterThan(0);
    const u = units[0];
    for (const k of [
      "codigo",
      "dataUnidade",
      "descricao",
      "descricaoOrador",
      "duracaoVideo",
      "duracaoAudio",
      "enderecoVideo",
      "enderecoAudio",
      "enderecoThumbnail",
    ]) {
      expect(u).toHaveProperty(k);
    }
  });

  it("parseVideoUnidade yields typed media units with playable links", () => {
    const videos = units.map(parseVideoUnidade);
    const v = videos[0];
    expect(v.codigo).not.toBeNull();
    expect(typeof v.data).toBe("string");
    expect(typeof v.descricao).toBe("string");
    expect(v.descricao!.length).toBeGreaterThan(0);
    expect(typeof v.orador).toBe("string");
    // duracaoVideo comes as a numeric STRING upstream — parser must coerce.
    expect(typeof v.duracaoSegundos).toBe("number");
    expect(v.duracaoSegundos).toBeGreaterThan(0);
    for (const url of [v.urlVideo, v.urlAudio, v.urlThumbnail]) {
      expect(typeof url).toBe("string");
      expect(url).toMatch(/^https?:\/\//);
    }
  });
});
