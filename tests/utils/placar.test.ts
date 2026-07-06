import { describe, it, expect } from "vitest";
import { computarPlacar } from "../../src/utils/placar.js";

// "Nao"/"Abstencao" carry accents in the real upstream; written as \u escapes here.
const NAO = "N\u00e3o"; // "Nao"
const ABSTENCAO = "Absten\u00e7\u00e3o"; // "Abstencao"

describe("computarPlacar", () => {
  it("counts Sim/Nao/Abstencao from siglaVotoParlamentar", () => {
    const votos = [
      { siglaVotoParlamentar: "Sim" },
      { siglaVotoParlamentar: "Sim" },
      { siglaVotoParlamentar: NAO },
      { siglaVotoParlamentar: ABSTENCAO },
    ];
    expect(computarPlacar(votos)).toEqual({ sim: 2, nao: 1, abstencao: 1 });
  });

  it("excludes non-vote codes (P-NRV, AP, LS, LAP, NCom, Presidente)", () => {
    const votos = [
      { siglaVotoParlamentar: "Sim" },
      { siglaVotoParlamentar: "P-NRV" },
      { siglaVotoParlamentar: "AP" },
      { siglaVotoParlamentar: "LS" },
      { siglaVotoParlamentar: "LAP" },
      { siglaVotoParlamentar: "NCom" },
      { siglaVotoParlamentar: "Presidente (art. 51 RISF)" },
    ];
    expect(computarPlacar(votos)).toEqual({ sim: 1, nao: 0, abstencao: 0 });
  });

  it("is case- and accent-insensitive", () => {
    const votos = [
      { siglaVotoParlamentar: "SIM" },
      { siglaVotoParlamentar: "nao" },
      { siglaVotoParlamentar: "ABSTENCAO" },
    ];
    expect(computarPlacar(votos)).toEqual({ sim: 1, nao: 1, abstencao: 1 });
  });

  it("returns zeros for an empty list", () => {
    expect(computarPlacar([])).toEqual({ sim: 0, nao: 0, abstencao: 0 });
  });

  it("accepts a custom sigla accessor", () => {
    const votos = [{ voto: "Sim" }, { voto: NAO }];
    expect(computarPlacar(votos, (v) => v.voto)).toEqual({ sim: 1, nao: 1, abstencao: 0 });
  });

  it("reproduces the PLP 73/2025 tally (51/17/1) over 81 votes", () => {
    const votos: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 51; i++) votos.push({ siglaVotoParlamentar: "Sim" });
    for (let i = 0; i < 17; i++) votos.push({ siglaVotoParlamentar: NAO });
    votos.push({ siglaVotoParlamentar: ABSTENCAO });
    // remaining 12 of 81 are non-votes (should be excluded)
    for (let i = 0; i < 12; i++) votos.push({ siglaVotoParlamentar: "P-NRV" });
    expect(votos).toHaveLength(81);
    expect(computarPlacar(votos)).toEqual({ sim: 51, nao: 17, abstencao: 1 });
  });
});
