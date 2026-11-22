import { describe, it, expect } from "vitest";
import { TABELAS_C3 } from "../../src/scraper/camada3-tabelas.js";
import { DICIONARIO } from "../../scripts/publicacao/dicionario.js";
import {
  MAX_BYTES_STATEMENT, PROJETADAS, chaveCurta, ddl, deletes, diferenca, esquemaDe, inserts, normalizar, planejar, projetarLinhas,
} from "../../scripts/publicacao/projecao.js";

const ideias = PROJETADAS.find((t) => t.caminho === "ideias/ideias")!;
const apoios = PROJETADAS.find((t) => t.caminho === "ideias/serie-apoios")!;

const ideia = (id: number, titulo: string, apoios: number | null = 1): Record<string, unknown> => ({
  id, titulo, descricao: null, status: "aberta", dataProposta: null, autorNome: null, autorUf: "SP", oficinaNivel: null, oficinaDataCadastro: null,
  apoios, prazoApoios: null, data20mil: null, dataSugestao: null, sugestaoNumero: null, sugestaoAno: null, dataDecisaoCdh: null,
  decisaoCdh: null, dataPublicacao: null, url: `u/${id}`, firstSeenAt: new Date("2026-06-14T00:00:00Z"),
  origemResumo: "listagem", coletadoEmResumo: new Date("2026-11-22T10:00:00Z"), origemDetalhe: null, coletadoEmDetalhe: null,
});

describe("projeção da camada 3 no D1 — tabelas", () => {
  it("toda tabela projetada está no dicionário; os índices e as omissões são de colunas existentes", () => {
    expect(PROJETADAS).toHaveLength(TABELAS_C3.length);
    for (const t of PROJETADAS) expect(DICIONARIO.some((d) => d.caminho === t.caminho)).toBe(true);
  });

  it("as séries não levam o sha (nenhuma ferramenta o mostra) e mantêm a chave do dicionário", () => {
    expect(apoios.colunas.map((c) => c.nome)).not.toContain("sha");
    for (const k of apoios.dic.chave) expect(apoios.colunas.map((c) => c.nome)).toContain(k);
  });

  it("DDL: chave TEXT PRIMARY KEY em tabela WITHOUT ROWID, tipos do dicionário, índices idempotentes", () => {
    const [create, ...idx] = ddl(ideias);
    expect(create).toMatch(/^CREATE TABLE IF NOT EXISTS "c3_ideias" \("chave" TEXT PRIMARY KEY, "id" INTEGER, "titulo" TEXT/);
    expect(create).toContain('"apoios" INTEGER');
    expect(create).toMatch(/\) WITHOUT ROWID;$/);
    expect(idx.every((s) => s.startsWith("CREATE INDEX IF NOT EXISTS"))).toBe(true);
  });

  it("o hash do esquema muda quando a DDL muda", () => {
    expect(esquemaDe(ideias)).not.toBe(esquemaDe(apoios));
    expect(esquemaDe(ideias)).toBe(esquemaDe(ideias));
  });
});

describe("projeção da camada 3 no D1 — linhas e diferença", () => {
  it("normaliza Date, bigint e instante em texto", () => {
    expect(normalizar(new Date("2026-11-22T10:00:00Z"), "datetime")).toBe("2026-11-22T10:00:00.000Z");
    expect(normalizar(10n, "integer")).toBe(10);
    expect(normalizar("2026-11-22T10:00:00Z", "datetime")).toBe("2026-11-22T10:00:00.000Z");
    expect(normalizar(undefined, "string")).toBeNull();
    expect(normalizar(Number.NaN, "number")).toBeNull();
  });

  it("chave curta = 16 hex do sha256 da chave do dicionário; chave repetida reprova", () => {
    const [l] = projetarLinhas(ideias, [ideia(7, "a")]);
    expect(l.chave).toBe(chaveCurta("[7]"));
    expect(l.chave).toMatch(/^[0-9a-f]{16}$/);
    expect(() => projetarLinhas(ideias, [ideia(7, "a"), ideia(7, "b")])).toThrow(/chave repetida/);
  });

  it("diferença: grava a nova e a mudada, remove a que sumiu, ignora a igual", () => {
    const antes = projetarLinhas(ideias, [ideia(1, "a"), ideia(2, "b"), ideia(3, "c")]);
    const retrato = new Map(antes.map((l) => [l.chave, l.hash]));
    const agora = projetarLinhas(ideias, [ideia(1, "a"), ideia(2, "B"), ideia(4, "d")]);
    const d = diferenca(retrato, agora);
    expect(d.gravar.map((l) => l.valores[0])).toEqual([2, 4]);
    expect(d.remover).toEqual([chaveCurta("[3]")]);
  });

  it("INSERTs e DELETEs ficam abaixo do limite de statement do D1", () => {
    const muitas = projetarLinhas(ideias, Array.from({ length: 1200 }, (_, i) => ideia(i + 1, "x".repeat(300))));
    const ins = inserts(ideias, muitas);
    expect(ins.length).toBeGreaterThan(1);
    for (const s of ins) expect(Buffer.byteLength(s)).toBeLessThanOrEqual(MAX_BYTES_STATEMENT + 1000);
    const del = deletes(ideias, muitas.map((l) => l.chave));
    expect(del.length).toBe(3); // 500 por bloco
  });

  it("linha que sozinha passa do limite do D1 reprova com o nome da chave", () => {
    const [l] = projetarLinhas(ideias, [ideia(1, "x".repeat(120_000))]);
    expect(() => inserts(ideias, [l])).toThrow(/passa do limite/);
  });
});

describe("projeção da camada 3 no D1 — plano", () => {
  const linhas = projetarLinhas(ideias, [ideia(1, "a"), ideia(2, "b")]);

  it("sem retrato: DROP + CREATE + carga inteira, controle no fim", () => {
    const p = planejar(ideias, linhas, null, { geradoEm: "2026-11-22T16:00:00.000Z", aplicadoEm: "2026-11-22T17:00:00.000Z" });
    expect(p.completa).toBe(true);
    expect(p.gravadas).toBe(2);
    const sql = p.arquivos.join("");
    expect(sql.indexOf('DROP TABLE IF EXISTS "c3_ideias"')).toBeLessThan(sql.indexOf('CREATE TABLE IF NOT EXISTS "c3_ideias"'));
    expect(sql.trim().split("\n").at(-1)).toMatch(/^INSERT OR REPLACE INTO "c3_projecao" .*'c3_ideias', '2026-11-22T16:00:00.000Z', '2026-11-22T17:00:00.000Z', 2, 2, 0\);$/);
  });

  it("com retrato igual: nada a gravar, sem DROP, só o controle (marca a cópia como vista)", () => {
    const retrato = new Map(linhas.map((l) => [l.chave, l.hash]));
    const p = planejar(ideias, linhas, retrato, { geradoEm: null, aplicadoEm: "2026-11-22T17:00:00.000Z" });
    expect(p.completa).toBe(false);
    expect(p.gravadas + p.removidas).toBe(0);
    expect(p.arquivos.join("")).not.toContain("DROP TABLE");
    expect(p.arquivos.join("")).not.toContain('INSERT OR REPLACE INTO "c3_ideias"');
  });

  it("arquivos partem só entre statements", () => {
    const muitas = projetarLinhas(ideias, Array.from({ length: 3000 }, (_, i) => ideia(i + 1, "y".repeat(200))));
    const p = planejar(ideias, muitas, null, { geradoEm: null, aplicadoEm: "x", maxBytesArquivo: 200_000 });
    expect(p.arquivos.length).toBeGreaterThan(2);
    for (const a of p.arquivos) expect(a.endsWith(";\n")).toBe(true);
  });
});
