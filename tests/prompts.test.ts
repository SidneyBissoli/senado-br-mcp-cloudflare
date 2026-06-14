import { describe, it, expect } from "vitest";
import {
  buildGastosSenador,
  buildTramitacaoMateria,
  buildVotosSenador,
  buildPanoramaEcidadania,
} from "../src/prompts.js";

describe("prompt builders", () => {
  it("gastos_senador interpolates senador/ano and points to the right tools", () => {
    const t = buildGastosSenador("Flávio Bolsonaro", "2025");
    expect(t).toContain("Flávio Bolsonaro");
    expect(t).toContain("2025");
    expect(t).toContain("senado_listar_senadores");
    expect(t).toContain("senado_ceaps");
  });

  it("tramitacao_materia builds the identificação and chains buscar/obter", () => {
    const t = buildTramitacaoMateria("PEC", "45", "2019");
    expect(t).toContain("PEC 45/2019");
    expect(t).toContain("senado_buscar_materias");
    expect(t).toContain("senado_obter_materia");
    expect(t).toContain("tramitacao");
  });

  it("votos_senador adapts to período presence", () => {
    const comPeriodo = buildVotosSenador("Renan", "2024");
    expect(comPeriodo).toContain("no período 2024");
    expect(comPeriodo).toContain("senado_votacoes_senador");
    const semPeriodo = buildVotosSenador("Renan");
    expect(semPeriodo).toContain("ano corrente");
  });

  it("panorama_ecidadania references the e-Cidadania tools", () => {
    const t = buildPanoramaEcidadania();
    expect(t).toContain("senado_ecidadania_listar_consultas");
    expect(t).toContain("senado_ecidadania_consultas_analise");
    expect(t).toContain("senado_ecidadania_listar_ideias");
  });
});
