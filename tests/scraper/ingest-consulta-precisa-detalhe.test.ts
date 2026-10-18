/**
 * Critério do enriquecimento das consultas (autoria pela página de detalhe). Até 18/10/2026 o sinal
 * era a CHAVE "autoria" no payload; o builder canônico sempre a grava, mesmo null, e 4.780 de 8.145
 * consultas ficaram presas sem autoria. Os payloads aqui saem do próprio buildConsultaResumo, como
 * no D1.
 */
import { describe, it, expect } from "vitest";
import { consultaPrecisaDetalhe } from "../../scripts/ingest-ecidadania/detalhe.js";
import { buildConsultaResumo } from "../../src/scraper/ecidadania.js";

const guardado = (autoria: string | null | undefined) =>
  JSON.stringify(buildConsultaResumo({ id: 1, materia: "PL 1/2026", votosSim: 0, votosNao: 0, autoria }));

describe("consultaPrecisaDetalhe", () => {
  it("consulta nova (nada guardado) precisa do detalhe", () => {
    expect(consultaPrecisaDetalhe(undefined)).toBe(true);
  });

  it("autoria null com a chave presente PRECISA do detalhe (o caso que ficou preso)", () => {
    const prev = guardado(null);
    expect(prev).toContain('"autoria":null');
    expect(consultaPrecisaDetalhe(prev)).toBe(true);
  });

  it("autoria vazia ou só espaços precisa do detalhe", () => {
    expect(consultaPrecisaDetalhe(guardado("  "))).toBe(true);
  });

  it("payload antigo sem a chave autoria precisa do detalhe", () => {
    expect(consultaPrecisaDetalhe(JSON.stringify({ id: 1, materia: "PL 1/2026" }))).toBe(true);
  });

  it("autoria com valor NÃO é relida (imutável), mesmo com relator null", () => {
    const prev = guardado("Senador Fulano (PT/BA)");
    expect(prev).toContain('"relator":null');
    expect(consultaPrecisaDetalhe(prev)).toBe(false);
  });
});
