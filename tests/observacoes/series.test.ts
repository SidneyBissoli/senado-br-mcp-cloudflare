import { describe, it, expect } from "vitest";
import { parquetReadObjects } from "hyparquet";
import { apoiosDoArquivo, doCorpus, INSTANTE_RESTAURACAO_A3, ordenar, situacaoDoArquivo, type VersaoDoCorpus } from "../../scripts/observacoes/series.js";
import { COLUNAS_APOIOS, COLUNAS_SITUACAO } from "../../scripts/observacoes/series-run.js";
import { escreverTabela } from "../../scripts/observacoes/parquet.js";
import { fundir, type Leitura } from "../../scripts/observacoes/fundir.js";
import type { Fato, Fonte } from "../../scripts/observacoes/fatos.js";
import { sqlDoCorpus } from "../../scripts/observacoes/corpus.js";

let n = 0;
const leitura = (id: string, fonte: Fonte, dia: number, fatos: Fato[]): Leitura => ({
  indice: ++n, instante: `2026-11-${String(dia).padStart(2, "0")}T18:00:00.000Z`, sha256: `sha${n}`, entidade: "ideias", entityId: id, fonte, fatos,
});
const lst = (id: string, sit: number, dia: number, apoios: number, titulo = "T") =>
  leitura(id, `listagem-s${sit}`, dia, [{ campo: "titulo", valor: titulo }, { campo: "apoios", valor: String(apoios) }]);
const v = (entityId: string, scrapedAt: string, apoios: number | null, status: string | null): VersaoDoCorpus => ({ entityId, scrapedAt, apoios, status });

describe("C3 — série de apoios e histórico de situação", () => {
  it("arquivo: apoios por série, com o período visto e a página", () => {
    const obs = fundir([], [lst("1", 5, 1, 10), lst("1", 5, 2, 10), lst("1", 5, 3, 12)]);
    expect(apoiosDoArquivo(obs).map((p) => [p.origem, p.apoios, p.desde.slice(8, 10), p.ate.slice(8, 10), p.leituras])).toEqual([
      ["listagem-s5", 10, "01", "02", 2], ["listagem-s5", 12, "03", "03", 1],
    ]);
  });

  it("arquivo: presença por situação, duas situações ao mesmo tempo viram duas linhas; título trocado não quebra a presença", () => {
    const obs = fundir([], [lst("2", 5, 1, 1), lst("2", 6, 1, 1), lst("2", 5, 2, 1, "T novo"), lst("2", 6, 2, 1)]);
    const s = ordenar(situacaoDoArquivo(obs));
    expect(s.map((p) => [p.situacaoCodigo, p.situacaoNome, p.desde.slice(8, 10), p.ate.slice(8, 10), p.leituras])).toEqual([
      ["5", "Ideias abertas", "01", "02", 2], ["6", "Ideias em avaliação na CDH", "01", "02", 2],
    ]);
    expect(s.every((p) => p.status === null && p.origem === "listagem")).toBe(true);
  });

  it("corpus: um ponto por mudança; restauração A3 fica de fora e é contada", () => {
    const c = doCorpus([
      v("3", "2026-08-01T00:00:00.000Z", 5, "aberta"),
      v("3", "2026-08-02T00:00:00.000Z", 5, "aberta"), // mudou outro campo: nada novo aqui
      v("3", INSTANTE_RESTAURACAO_A3, 7, "aberta"), // restauração: não é leitura
      v("3", "2026-08-03T00:00:00.000Z", 9, "encerrada"),
      v("4", "2026-08-01T00:00:00.000Z", null, "removida"),
    ]);
    expect(c.apoios.map((p) => [p.entityId, p.apoios, p.desde.slice(5, 10)])).toEqual([["3", 5, "08-01"], ["3", 9, "08-03"], ["4", null, "08-01"]]);
    expect(c.situacao.map((p) => [p.entityId, p.status, p.situacaoCodigo])).toEqual([["3", "aberta", null], ["3", "encerrada", null], ["4", "removida", null]]);
    expect(c.resumo).toEqual({ versoes: 5, restauracaoA3: 1 });
    expect(c.apoios.every((p) => p.origem === "corpus" && p.sha === null && p.desde === p.ate)).toBe(true);
  });

  it("tabelas em Parquet: tipos, nulos e UTC voltam iguais", async () => {
    const obs = fundir([], [lst("9", 5, 1, 3)]);
    const linhas = ordenar([...apoiosDoArquivo(obs), ...doCorpus([v("9", "2026-07-01T00:00:00.000Z", null, "aberta")]).apoios]);
    const b = escreverTabela(linhas, COLUNAS_APOIOS, { nota: "x" });
    const volta = (await parquetReadObjects({ file: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer })) as Record<string, unknown>[];
    expect(volta.map((r) => [r.origem, r.apoios, (r.desde as Date).toISOString()])).toEqual([
      ["corpus", null, "2026-07-01T00:00:00.000Z"], ["listagem-s5", 3, "2026-11-01T18:00:00.000Z"],
    ]);
    expect(() => escreverTabela(situacaoDoArquivo(obs), COLUNAS_SITUACAO, {})).not.toThrow();
  });

  it("SQL do corpus só aceita inteiros", () => {
    expect(sqlDoCorpus(10)).toContain("rowid > 10 ORDER BY rowid LIMIT 50000");
    expect(() => sqlDoCorpus(Number.NaN)).toThrow();
  });
});
