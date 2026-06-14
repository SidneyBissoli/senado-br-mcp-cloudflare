/**
 * Contract tests for the e-Cidadania scraper, run against FIXTURES (real HTML/JSON saved from
 * the live portal), not live fetch. A markup/key change that breaks extraction is caught
 * deterministically (no network flakiness). Refresh the fixtures in tests/fixtures/ecidadania/
 * to re-baseline against the live portal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listarConsultasInternal,
  obterConsultaInternal,
  listarIdeiasInternal,
  obterIdeiaInternal,
  listarEventosInternal,
  obterEventoInternal,
} from "../../src/scraper/ecidadania.js";
import consultasListaJson from "../fixtures/ecidadania/consultas-lista.json?raw";
import ideiasListaJson from "../fixtures/ecidadania/ideias-lista.json?raw";
import eventosListaJson from "../fixtures/ecidadania/eventos-lista.json?raw";
import consultaDetalheHtml from "../fixtures/ecidadania/consulta-detalhe.html?raw";
import ideiaDetalheHtml from "../fixtures/ecidadania/ideia-detalhe.html?raw";
import eventoDetalheHtml from "../fixtures/ecidadania/evento-detalhe.html?raw";

const mockFetch = vi.fn();
function stubWith(body: string) {
  mockFetch.mockResolvedValueOnce(new Response(body, { status: 200 }));
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── REST JSON list contracts (key presence + parser output) ──────────────

describe("contract: consultas list JSON", () => {
  it("raw fixture carries the keys the parser relies on", () => {
    const items = JSON.parse(consultasListaJson);
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    for (const k of ["id", "votosFavor", "votosContra", "totalVotos", "identificacaoBasica", "ementa"]) {
      expect(items[0]).toHaveProperty(k);
    }
  });

  it("parser yields sane consultas from the fixture", async () => {
    stubWith(consultasListaJson);
    const result = await listarConsultasInternal({ limite: 100 });
    expect(result.length).toBeGreaterThan(0);
    expect(typeof result[0].id).toBe("number");
    expect(typeof result[0].votosSim).toBe("number");
    expect(typeof result[0].votosNao).toBe("number");
    expect(result[0].materia.length).toBeGreaterThan(0);
    expect(result[0].url).toContain(`visualizacaomateria?id=${result[0].id}`);
  });
});

describe("contract: ideias list JSON", () => {
  it("raw fixture carries the keys the parser relies on", () => {
    const items = JSON.parse(ideiasListaJson);
    for (const k of ["id", "titulo", "apoiamentos"]) {
      expect(items[0]).toHaveProperty(k);
    }
  });

  it("parser yields sane ideias from the fixture", async () => {
    stubWith(ideiasListaJson);
    const result = await listarIdeiasInternal({ limite: 100 });
    expect(result.length).toBeGreaterThan(0);
    expect(typeof result[0].id).toBe("number");
    expect(result[0].titulo.length).toBeGreaterThan(0);
    expect(typeof result[0].apoios).toBe("number");
  });
});

describe("contract: eventos list JSON", () => {
  it("raw fixture carries the keys the parser relies on", () => {
    const items = JSON.parse(eventosListaJson);
    for (const k of ["id", "situacaoAudienciaId", "dataPublicacao", "qtdComentario"]) {
      expect(items[0]).toHaveProperty(k);
    }
    // título comes from titulo OR tituloAbreviado
    expect("titulo" in items[0] || "tituloAbreviado" in items[0]).toBe(true);
  });

  it("parser yields sane eventos from the fixture", async () => {
    stubWith(eventosListaJson);
    const result = await listarEventosInternal({ limite: 100 });
    expect(result.length).toBeGreaterThan(0);
    expect(typeof result[0].id).toBe("number");
    expect(result[0].titulo.length).toBeGreaterThan(0);
    expect(["agendado", "encerrado"]).toContain(result[0].status);
  });
});

// ── HTML detail contracts (regex extraction on real markup) ──────────────

describe("contract: consulta detail HTML", () => {
  it("extracts core fields from real markup", async () => {
    stubWith(consultaDetalheHtml);
    const r = await obterConsultaInternal(173613);
    expect(r.id).toBe(173613);
    expect(["aberta", "encerrada"]).toContain(r.status);
    expect(typeof r.totalVotos).toBe("number");
    // at least one identifying text field must be extracted
    expect((r.materia.length + r.ementa.length)).toBeGreaterThan(0);
  });
});

describe("contract: ideia detail HTML", () => {
  it("extracts core fields from real markup", async () => {
    stubWith(ideiaDetalheHtml);
    const r = await obterIdeiaInternal(215666);
    expect(r.id).toBe(215666);
    expect(["aberta", "encerrada", "convertida"]).toContain(r.status);
    expect(typeof r.apoios).toBe("number");
    expect(r.titulo.length).toBeGreaterThan(0);
  });
});

describe("contract: evento detail HTML", () => {
  it("extracts core fields from real markup", async () => {
    stubWith(eventoDetalheHtml);
    const r = await obterEventoInternal(39329);
    expect(r.id).toBe(39329);
    expect(["agendado", "encerrado", "cancelado"]).toContain(r.status);
    expect(r.titulo.length).toBeGreaterThan(0);
  });
});
