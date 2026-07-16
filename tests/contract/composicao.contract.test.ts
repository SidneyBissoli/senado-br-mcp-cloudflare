/**
 * Upstream shape-drift contract tests for src/tools/composicao.ts.
 *
 * Contract tier: `npm run test:contract` (vitest.contract.config.ts) — excluded from the
 * default `npm test` suite. Fixtures are raw upstream captures (sorted keys, arrays
 * truncated to 3 items) refreshed by `npm run contract:refresh`; a failure right after a
 * live refresh means real upstream shape drift, not a test bug.
 *
 * Per endpoint: (a) assert the RAW fixture still carries the wrapper path + keys the
 * parser navigates, and (b) run the REAL exported parser on fixture data asserting
 * presence/types only — never exact values.
 */
import { describe, it, expect } from "vitest";
import {
  parseBlocoResumo,
  parseBlocoDetalhe,
  parseLideranca,
  parseMembroMesa,
} from "../../src/tools/composicao.js";
import { digArrayRoot, digObjectRoot } from "../../src/utils/upstream-parse.js";
import { ensureArray } from "../../src/utils/validation.js";
import blocosListaRaw from "./fixtures/legado/blocos-lista.json?raw";
import blocoDetalheRaw from "./fixtures/legado/bloco-detalhe.json?raw";
import liderancasRaw from "./fixtures/legado/liderancas.json?raw";
import mesaSfRaw from "./fixtures/legado/mesa-sf.json?raw";
import mesaCnRaw from "./fixtures/legado/mesa-cn.json?raw";

const blocosLista = JSON.parse(blocosListaRaw);
const blocoDetalhe = JSON.parse(blocoDetalheRaw);
const liderancas = JSON.parse(liderancasRaw);
const mesaSf = JSON.parse(mesaSfRaw);
const mesaCn = JSON.parse(mesaCnRaw);

// ── /composicao/lista/blocos (senado_listar_blocos → parseBlocoResumo) ───────────

describe("contract: /composicao/lista/blocos", () => {
  // Same candidate path the tool passes to digArrayRoot.
  const blocos = digArrayRoot(
    blocosLista,
    [["ListaBlocoParlamentar", "Blocos", "Bloco"]],
    "contract:blocos-lista",
  ) as any[];

  it("raw fixture keeps the wrapper path and PascalCase bloc keys", () => {
    expect(blocosLista).toHaveProperty("ListaBlocoParlamentar.Blocos.Bloco");
    expect(blocos.length).toBeGreaterThan(0);
    const b0 = blocos[0];
    for (const k of ["CodigoBloco", "NomeBloco", "NomeApelido", "DataCriacao"]) {
      expect(b0).toHaveProperty(k);
    }
    // DataCriacao is already ISO in the LIST dump (unlike the DD/MM/AAAA detail).
    expect(b0.DataCriacao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Members live under Membros.Membro[].Partido in the list shape.
    const membros = ensureArray(b0.Membros?.Membro) as any[];
    expect(membros.length).toBeGreaterThan(0);
    expect(membros[0]).toHaveProperty("Partido.SiglaPartido");
    expect(membros[0]).toHaveProperty("Partido.NomePartido");
    expect(membros[0]).toHaveProperty("DataAdesao");
    // Optional: DataExtincao (bloc) / DataDesligamento (member) only exist for
    // extinct blocs / departed parties — absent in this active-bloc capture.
    if ("DataExtincao" in b0) expect(typeof b0.DataExtincao).toBe("string");
    if ("DataDesligamento" in membros[0]) expect(typeof membros[0].DataDesligamento).toBe("string");
  });

  it("parseBlocoResumo yields typed fields from each fixture bloc", () => {
    for (const b of blocos) {
      const parsed = parseBlocoResumo(b);
      expect(parsed.codigo).toBeTruthy();
      expect(typeof parsed.nome).toBe("string");
      expect(parsed.nome.length).toBeGreaterThan(0);
      expect(typeof parsed.dataCriacao).toBe("string");
      // null for active blocs; string when the bloc was extinguished.
      expect(parsed.dataExtincao === null || typeof parsed.dataExtincao === "string").toBe(true);
      expect(parsed.partidos.length).toBeGreaterThan(0);
      for (const partido of parsed.partidos) {
        expect(typeof partido.sigla).toBe("string");
        expect(partido.sigla.length).toBeGreaterThan(0);
        expect(typeof partido.dataAdesao).toBe("string");
        // dataDesligamento null = current member; string = historical member.
        expect(
          partido.dataDesligamento === null || typeof partido.dataDesligamento === "string",
        ).toBe(true);
      }
    }
  });
});

// ── /composicao/bloco/{codigo} (senado_obter_bloco → parseBlocoDetalhe) ──────────

describe("contract: /composicao/bloco/{codigo}", () => {
  // Same candidate paths the tool passes to digObjectRoot (lowercase root in practice).
  const bloco = digObjectRoot(
    blocoDetalhe,
    [["blocos", "bloco"], ["BlocoParlamentar", "Bloco"]],
    "contract:bloco-detalhe",
  ) as any;

  it("raw fixture keeps the lowercase blocos.bloco root and detail keys", () => {
    expect(blocoDetalhe).toHaveProperty("blocos.bloco");
    for (const k of ["id", "nomeBloco", "nomeApelidoBloco", "dataCriacao"]) {
      expect(bloco).toHaveProperty(k);
    }
    // Detail dates come as DD/MM/AAAA (converted to ISO by the parser).
    expect(bloco.dataCriacao).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    // Members under composicaoBloco.composicao_bloco[].partido (all lowercase).
    const composicao = ensureArray(bloco.composicaoBloco?.composicao_bloco) as any[];
    expect(composicao.length).toBeGreaterThan(0);
    expect(composicao[0]).toHaveProperty("partido.siglaPartido");
    expect(composicao[0]).toHaveProperty("partido.nomePartido");
    expect(composicao[0]).toHaveProperty("dataAdesao");
  });

  it("parseBlocoDetalhe yields typed fields with ISO-converted dates", () => {
    const parsed = parseBlocoDetalhe(bloco);
    expect(parsed.codigo).toBeTruthy();
    expect(typeof parsed.nome).toBe("string");
    expect(parsed.nome.length).toBeGreaterThan(0);
    expect(parsed.dataCriacao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // dataExtincao is absent for a live bloc -> null; string if ever present.
    expect(parsed.dataExtincao === null || typeof parsed.dataExtincao === "string").toBe(true);
    expect(parsed.partidos.length).toBeGreaterThan(0);
    expect(typeof parsed.partidos[0].sigla).toBe("string");
    expect(parsed.partidos[0].sigla.length).toBeGreaterThan(0);
    expect(parsed.partidos[0].dataAdesao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── /composicao/lideranca (senado_liderancas → parseLideranca) ───────────────────

describe("contract: /composicao/lideranca", () => {
  // The upstream serves a FLAT array at the response root (empty candidate path).
  const itens = digArrayRoot(liderancas, [[]], "contract:liderancas") as any[];

  it("raw fixture is a flat root array with the camelCase keys the parser reads", () => {
    expect(Array.isArray(liderancas)).toBe(true);
    expect(itens.length).toBeGreaterThan(0);
    const l0 = itens[0];
    for (const k of [
      "siglaTipoLideranca",
      "descricaoTipoLideranca",
      "descricaoTipoUnidadeLideranca",
      "casa",
      "dataDesignacao",
      "codigoParlamentar",
      "nomeParlamentar",
      "siglaPartidoFiliacao",
    ]) {
      expect(l0).toHaveProperty(k);
    }
    // Numeric ids come as real JSON numbers on this endpoint (not strings).
    expect(typeof l0.codigoParlamentar).toBe("number");
    // Optional led-unit fields: party leaderships carry codigoPartido/siglaPartido,
    // bloc leaderships carry codigoBloco/siglaBloco — assert types when present.
    for (const l of itens) {
      if ("codigoPartido" in l) expect(typeof l.codigoPartido).toBe("number");
      if ("siglaPartido" in l) expect(typeof l.siglaPartido).toBe("string");
      if ("codigoBloco" in l) expect(typeof l.codigoBloco).toBe("number");
      if ("siglaBloco" in l) expect(typeof l.siglaBloco).toBe("string");
      if ("numeroOrdemViceLider" in l) expect(typeof l.numeroOrdemViceLider).toBe("number");
    }
  });

  it("parseLideranca yields typed fields from each fixture item", () => {
    for (const l of itens) {
      const parsed = parseLideranca(l);
      expect(typeof parsed.tipo).toBe("string");
      expect(typeof parsed.descricao).toBe("string");
      expect(typeof parsed.unidadeLideranca).toBe("string");
      expect(typeof parsed.casa).toBe("string");
      expect(parsed.dataDesignacao === null || typeof parsed.dataDesignacao === "string").toBe(true);
      expect(parsed.parlamentar).not.toBeNull();
      expect(typeof parsed.parlamentar!.codigo).toBe("number");
      expect(typeof parsed.parlamentar!.nome).toBe("string");
      expect(typeof parsed.parlamentar!.partido).toBe("string");
      // The source does not publish the leader's UF — always null today; a non-null
      // value after a refresh means the upstream started publishing it (doc drift).
      expect(parsed.parlamentar!.uf).toBeNull();
      // bloco/partido are null unless the leadership is of a bloc/party unit.
      if (parsed.partido !== null) expect(typeof parsed.partido.sigla).toBe("string");
      if (parsed.bloco !== null) {
        expect(parsed.bloco.sigla === null || typeof parsed.bloco.sigla === "string").toBe(true);
      }
    }
  });

  it("party-unit leaderships resolve the led party (distinct from filiação)", () => {
    const partyLed = itens.find((l: any) => l.codigoPartido != null);
    // The fixture (3-item truncation) includes party leaderships; skip-proof guard.
    expect(partyLed).toBeDefined();
    const parsed = parseLideranca(partyLed);
    expect(parsed.partido).not.toBeNull();
    expect(typeof parsed.partido!.codigo).toBe("number");
    expect(typeof parsed.partido!.sigla).toBe("string");
  });
});

// ── /composicao/mesaSF + /composicao/mesaCN (senado_mesa → parseMembroMesa) ──────

describe("contract: /composicao/mesaSF", () => {
  const colegiados = digArrayRoot(
    mesaSf,
    [["MesaSenado", "Colegiados", "Colegiado"], ["MesaCongresso", "Colegiados", "Colegiado"]],
    "contract:mesa-sf",
  ) as any[];
  const cargos = ensureArray(colegiados[0]?.Cargos?.Cargo) as any[];

  it("raw fixture keeps MesaSenado.Colegiados.Colegiado[].Cargos.Cargo[] with SF keys", () => {
    expect(mesaSf).toHaveProperty("MesaSenado.Colegiados.Colegiado");
    expect(cargos.length).toBeGreaterThan(0);
    const c0 = cargos[0];
    // SF shape: Cargo is a STRING ARRAY, Http is the parliamentarian code, Bancada
    // embeds party/UF as "(PARTY-UF)".
    for (const k of ["Cargo", "Http", "NomeParlamentar", "Bancada"]) {
      expect(c0).toHaveProperty(k);
    }
    expect(Array.isArray(c0.Cargo)).toBe(true);
    expect(typeof c0.Cargo[0]).toBe("string");
    expect(c0.Bancada).toMatch(/\([^)]+-[A-Za-z]{2}\)/);
  });

  it("parseMembroMesa yields typed fields from each SF cargo", () => {
    for (const c of cargos) {
      const parsed = parseMembroMesa(c);
      expect(typeof parsed.cargo).toBe("string");
      expect(parsed.codigo).toBeTruthy();
      expect(typeof parsed.nome).toBe("string");
      expect(parsed.nome.length).toBeGreaterThan(0);
      expect(typeof parsed.partido).toBe("string");
      expect(parsed.uf).toMatch(/^[A-Za-z]{2}$/);
    }
  });
});

describe("contract: /composicao/mesaCN", () => {
  const colegiados = digArrayRoot(
    mesaCn,
    [["MesaSenado", "Colegiados", "Colegiado"], ["MesaCongresso", "Colegiados", "Colegiado"]],
    "contract:mesa-cn",
  ) as any[];
  const cargos = ensureArray(colegiados[0]?.Cargos?.Cargo) as any[];

  it("raw fixture keeps MesaCongresso.Colegiados.Colegiado[].Cargos.Cargo[] with CN keys", () => {
    expect(mesaCn).toHaveProperty("MesaCongresso.Colegiados.Colegiado");
    expect(cargos.length).toBeGreaterThan(0);
    const c0 = cargos[0];
    // CN shape differs from SF: no `Cargo` string array / `Http`; the code lives in
    // CodigoParlamentar (the parser's fallback) and the role in TipoCargo.
    for (const k of ["CodigoParlamentar", "NomeParlamentar", "Bancada", "TipoCargo"]) {
      expect(c0).toHaveProperty(k);
    }
    expect(c0.Bancada).toMatch(/\([^)]+-[A-Za-z]{2}\)/);
  });

  it("parseMembroMesa yields typed fields from each CN cargo", () => {
    for (const c of cargos) {
      const parsed = parseMembroMesa(c);
      // cargo: the CN dump carries the role only in TipoCargo, which the parser does
      // not read — null here today; string if the upstream ever adds Cargo/DescricaoCargo.
      expect(parsed.cargo === null || typeof parsed.cargo === "string").toBe(true);
      expect(parsed.codigo).toBeTruthy();
      expect(typeof parsed.nome).toBe("string");
      expect(parsed.nome.length).toBeGreaterThan(0);
      expect(typeof parsed.partido).toBe("string");
      expect(parsed.uf).toMatch(/^[A-Za-z]{2}$/);
    }
  });
});
