import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MARCA_DE_OMISSAO, NOMES_OMITIDOS, omitirNomes } from "../../scripts/publicacao/omissoes.js";
import type { LinhaAcontecimento, LinhaIdeia } from "../../scripts/publicacao/ideias.js";

const ideia = (id: string, autorNome: string | null, autorUf: string | null): LinhaIdeia =>
  ({ id, autorNome, autorUf, titulo: "t" }) as unknown as LinhaIdeia;
const acont = (id: string, texto: string, tipo = "proposta"): LinhaAcontecimento => ({ id, ordem: 0, data: "2026-01-01", tipo, texto });

describe("omitirNomes (LGPD, pedido do titular)", () => {
  const ideias = [ideia("1", "FULANA D. T.", "SP"), ideia("2", "BELTRANO X.", "Exterior")];
  const linha = [
    acont("1", "Ideia proposta por FULANA D. T. (SP)"),
    acont("1", "Ideia alcançou 20.000 apoios", "meta"),
    acont("2", "Ideia proposta por BELTRANO X. (Exterior)"),
  ];

  it("lista vazia: nada muda", () => {
    const r = omitirNomes(ideias, linha, new Map());
    expect(r.ideias).toEqual(ideias);
    expect(r.linhaDoTempo).toEqual(linha);
    expect(r.omitidas).toBe(0);
  });

  it("id listado: autor e UF nulos, nome trocado pela marca na proposta; os outros intactos", () => {
    const r = omitirNomes(ideias, linha, new Map([["1", "2027-02-01"]]));
    expect(r.ideias[0]).toMatchObject({ autorNome: null, autorUf: null, titulo: "t" });
    expect(r.ideias[1]).toBe(ideias[1]);
    expect(r.linhaDoTempo[0].texto).toBe(`Ideia proposta por ${MARCA_DE_OMISSAO}`);
    expect(r.linhaDoTempo[1]).toBe(linha[1]);
    expect(r.linhaDoTempo[2]).toBe(linha[2]);
    expect(JSON.stringify(r)).not.toContain("FULANA");
    expect(r.omitidas).toBe(1);
  });

  it("proposta sem UF e nome em outro acontecimento da mesma ideia também saem", () => {
    const r = omitirNomes([ideia("1", "FULANA D. T.", null)], [acont("1", "Ideia proposta por FULANA D. T."), acont("1", "Resposta a FULANA D. T.", "outro")], new Map([["1", "2027-02-01"]]));
    expect(JSON.stringify(r)).not.toContain("FULANA");
  });

  it("não altera as entradas", () => {
    omitirNomes(ideias, linha, new Map([["1", "2027-02-01"]]));
    expect(ideias[0].autorNome).toBe("FULANA D. T.");
    expect(linha[0].texto).toContain("FULANA");
  });

  it("a lista pública guarda só id e data, nunca nome", () => {
    for (const [id, data] of NOMES_OMITIDOS) {
      expect(id).toMatch(/^\d+$/);
      expect(data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // O arquivo não pode virar registro de nomes: nenhuma string com letras dentro do Map.
    const fonte = readFileSync("scripts/publicacao/omissoes.ts", "utf8");
    const corpo = fonte.slice(fonte.indexOf("new Map<string, string>(["), fonte.indexOf("]);", fonte.indexOf("new Map<string, string>([")));
    expect(corpo).not.toMatch(/"[^"]*[A-Za-zÀ-ú][^"]*"/);
  });
});
