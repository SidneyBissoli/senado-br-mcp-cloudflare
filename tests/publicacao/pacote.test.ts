import { describe, it, expect } from "vitest";
import { DICIONARIO } from "../../scripts/publicacao/dicionario.js";
import { chaveNoBalde, manifesto } from "../../scripts/publicacao/pacote.js";

const tabela = (c: string) => DICIONARIO.find((t) => t.caminho === c)!;

describe("D2 — pacote 3.0.0 (só Parquet)", () => {
  it("manifesto: um recurso Parquet por tabela, chave e formatos que o validador aceita, sem bytes", () => {
    const contagens = DICIONARIO.map((t) => ({ caminho: t.caminho, linhas: 7 }));
    const m = manifesto(contagens, "2026-11-22T00:00:00.000Z") as {
      schemaVersion: string;
      resources: (Record<string, unknown> & { name: string; path: string; format: string; rows: number; schema: { fields: { name: string; type: string; format?: string; calculada?: boolean }[]; primaryKey: string[] } })[];
    };
    expect(m.schemaVersion).toBe("3.0.0");
    expect(m.resources).toHaveLength(DICIONARIO.length);
    // Pacote tabular exige recurso tabular (o validador Frictionless recusou o pacote sem isto).
    expect(m.resources.every((x) => x.profile === "tabular-data-resource")).toBe(true);
    // Nenhum CSV, nenhum `bytes` (o validador não o confere em Parquet e reprova).
    expect(m.resources.every((x) => x.format === "parquet" && x.path.endsWith(".parquet") && !("bytes" in x) && !("parquet" in x))).toBe(true);
    const r = m.resources.find((x) => x.name === "consultas-votos-votos-uf")!;
    expect([r.path, r.rows, r.schema.primaryKey]).toEqual(["consultas-votos-votos-uf.parquet", 7, ["codigo", "uf", "desde"]]);
    // Pacote plano (o Zenodo não guarda pastas): nenhum caminho com pasta, nenhum nome repetido.
    expect(m.resources.every((x) => !x.path.includes("/"))).toBe(true);
    expect(new Set(m.resources.map((x) => x.path)).size).toBe(DICIONARIO.length);
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
