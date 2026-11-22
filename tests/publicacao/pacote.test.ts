import { describe, it, expect } from "vitest";
import { DICIONARIO } from "../../scripts/publicacao/dicionario.js";
import { celula, chaveNoBalde, manifesto, paraCsv } from "../../scripts/publicacao/pacote.js";

const tabela = (c: string) => DICIONARIO.find((t) => t.caminho === c)!;

describe("D2 — pacote 3.0.0", () => {
  it("célula: null vazio, aspas só quando preciso, instante em ISO UTC, inteiro sem casa decimal", () => {
    expect(celula(null, "string")).toBe("");
    expect(celula("simples", "string")).toBe("simples");
    expect(celula('diz "oi", e sai\nnova linha', "string")).toBe('"diz ""oi"", e sai\nnova linha"');
    expect(celula(new Date("2026-11-22T14:00:00.123Z"), "datetime")).toBe("2026-11-22T14:00:00.123Z");
    expect(celula(50.4, "number")).toBe("50.4");
    expect(celula(123197, "integer")).toBe("123197");
    expect(() => celula(1.5, "integer")).toThrow();
    expect(celula(12n, "integer")).toBe("12");
  });

  it("CSV: cabeçalho e colunas na ordem do dicionário, CRLF, acentos intactos", () => {
    const t = tabela("eventos/pauta");
    const csv = paraCsv([{ origem: "arquivo", texto: "Educação, saúde", ordem: 0, id: 41230 }], t);
    expect(csv).toBe('id,ordem,texto,origem\r\n41230,0,"Educação, saúde",arquivo\r\n');
  });

  it("manifesto: um recurso CSV por tabela, Parquet ao lado, chave e formatos que o validador aceita", () => {
    const contagens = DICIONARIO.map((t) => ({ caminho: t.caminho, linhas: 1, bytesCsv: 10, bytesParquet: 20 }));
    const m = manifesto(contagens, "2026-11-22T00:00:00.000Z") as { resources: { name: string; path: string; parquet: { path: string }; schema: { fields: { name: string; type: string; format?: string; calculada?: boolean }[]; primaryKey: string[] } }[] };
    expect(m.resources).toHaveLength(DICIONARIO.length);
    // Pacote tabular exige recurso tabular (o validador Frictionless recusou o pacote sem isto).
    expect(m.resources.every((x) => (x as unknown as { profile: string }).profile === "tabular-data-resource")).toBe(true);
    const r = m.resources.find((x) => x.name === "consultas-votos-votos-uf")!;
    expect([r.path, r.parquet.path, r.schema.primaryKey]).toEqual(["consultas_votos/votos-uf.csv", "consultas_votos/votos-uf.parquet", ["codigo", "uf", "desde"]]);
    const campos = m.resources.find((x) => x.name === "consultas-consultas")!.schema.fields;
    expect(campos.find((f) => f.name === "percentualSim")).toMatchObject({ type: "number", calculada: true });
    expect(campos.find((f) => f.name === "coletadoEmResumo")).toMatchObject({ type: "datetime", format: "%Y-%m-%dT%H:%M:%S.%fZ" });
    expect(new Set(m.resources.map((x) => x.name)).size).toBe(DICIONARIO.length);
  });

  it("chave no balde: séries da C3 onde a C3 grava, o resto sob publicacao/", () => {
    expect(chaveNoBalde(tabela("ideias/serie-apoios"))).toBe("ideias/serie-apoios.parquet");
    expect(chaveNoBalde(tabela("eventos/comentarios"))).toBe("publicacao/eventos/comentarios.parquet");
  });
});
