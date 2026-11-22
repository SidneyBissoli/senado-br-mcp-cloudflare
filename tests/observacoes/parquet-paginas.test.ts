import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import { parquetMetadata } from "hyparquet";
import { escreverCopia, lerCopia } from "../../scripts/observacoes/parquet.js";
import { fundir, type Leitura } from "../../scripts/observacoes/fundir.js";
import { AbridorDePaginas, PaginaIlegivelError, emParalelo } from "../../scripts/observacoes/paginas.js";
import { autoprovaZstd, chaveDaPagina, chaveDaPaginaZstd, chaveDaReferencia, comprimirZstd } from "../../scripts/ingest-ecidadania/arquivo.js";
import { sha256Hex, type ClienteR2 } from "../../scripts/ingest-ecidadania/r2.js";

const TEM_DICIONARIO = (() => {
  try {
    autoprovaZstd();
    return true;
  } catch {
    return false;
  }
})();

const leitura = (indice: number, id: string, valor: string | null, dia: number): Leitura => ({
  indice, instante: `2026-11-${String(dia).padStart(2, "0")}T03:04:05.678Z`, sha256: `s${indice}`,
  entidade: "ideias", entityId: id, fonte: "detalhe", fatos: [{ campo: "descricao", valor }, { campo: "statusHttp", valor: "200" }],
});

describe("cópia em Parquet", () => {
  const obs = fundir([], [leitura(1, "10", "Ação já é São Paulo", 1), leitura(2, "10", "Ação já é São Paulo", 2), leitura(3, "9", null, 3)]);
  const meta = { cursor: 3, leitor: "observacoes@abc", entidade: "ideias", geradoEm: "2026-11-21T00:00:00.000Z" };

  it("volta igual: valores, nulos, acentos, instantes com milissegundos e metadados", async () => {
    const { meta: m, obs: volta } = await lerCopia(escreverCopia(obs, meta));
    expect(volta).toEqual(obs);
    expect(m).toEqual(meta);
  });

  it("instantes marcados como UTC no esquema", () => {
    const bytes = escreverCopia(obs, meta);
    const md = parquetMetadata(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const col = md.schema.find((s) => s.name === "visto_primeiro");
    expect(col?.logical_type).toMatchObject({ type: "TIMESTAMP", isAdjustedToUTC: true });
  });

  it("incremental sobre a cópia relida = completo", async () => {
    const todas = [leitura(1, "10", "a", 1), leitura(2, "10", "a", 2), leitura(3, "10", "b", 3), leitura(4, "10", "b", 4)];
    const { obs: parcial } = await lerCopia(escreverCopia(fundir([], todas.slice(0, 2)), meta));
    expect(fundir(parcial, todas.slice(2))).toEqual(fundir([], todas));
  });

  it("cópia sem cursor nos metadados é recusada", async () => {
    await expect(lerCopia(escreverCopia(obs, { ...meta, leitor: "" }))).rejects.toThrow(/cursor\/leitor/);
  });
});

function baldeDeLeitura(objetos: Record<string, Uint8Array>): ClienteR2 & { gets: number } {
  const b = {
    gets: 0,
    async existe(k: string) {
      return k in objetos;
    },
    async gravar() {
      throw new Error("só leitura");
    },
    async ler(k: string) {
      b.gets++;
      return objetos[k] ?? null;
    },
  };
  return b;
}

describe("abrir páginas do arquivo", () => {
  const pagina = new TextEncoder().encode("<html>esqueleto do portal ".repeat(50) + "<body>ideia 1</body></html>");
  const sha = sha256Hex(pagina);

  it("gzip antigo (sem linha na tabela de páginas)", async () => {
    const a = new AbridorDePaginas(baldeDeLeitura({ [chaveDaPagina(sha)]: gzipSync(pagina) }));
    expect(Buffer.from(await a.abrir({ sha256: sha, formato: null, referencia: null })).equals(Buffer.from(pagina))).toBe(true);
  });

  it.runIf(TEM_DICIONARIO)("zstd com referência: a referência é aberta uma vez só e conferida", async () => {
    const ref = new TextEncoder().encode("<html>esqueleto do portal ".repeat(50));
    const shaRef = sha256Hex(ref);
    const outra = new TextEncoder().encode("<html>esqueleto do portal ".repeat(50) + "<body>ideia 2</body></html>");
    const balde = baldeDeLeitura({
      [chaveDaReferencia(shaRef)]: gzipSync(ref),
      [chaveDaPaginaZstd(sha)]: comprimirZstd(pagina, ref),
      [chaveDaPaginaZstd(sha256Hex(outra))]: comprimirZstd(outra, ref),
    });
    const a = new AbridorDePaginas(balde);
    expect(Buffer.from(await a.abrir({ sha256: sha, formato: "zstd+ref", referencia: shaRef })).equals(Buffer.from(pagina))).toBe(true);
    expect(Buffer.from(await a.abrir({ sha256: sha256Hex(outra), formato: "zstd+ref", referencia: shaRef })).equals(Buffer.from(outra))).toBe(true);
    expect(balde.gets).toBe(3);
  });

  it("página ausente ou que não volta ao sha do índice: erro, nunca bytes errados", async () => {
    await expect(new AbridorDePaginas(baldeDeLeitura({})).abrir({ sha256: sha, formato: null, referencia: null })).rejects.toThrow(PaginaIlegivelError);
    const trocada = new AbridorDePaginas(baldeDeLeitura({ [chaveDaPagina(sha)]: gzipSync(new TextEncoder().encode("outra")) }));
    await expect(trocada.abrir({ sha256: sha, formato: null, referencia: null })).rejects.toThrow(/não volta ao sha/);
  });

  it("emParalelo devolve na ordem da entrada", async () => {
    const r = await emParalelo([30, 10, 20, 0], 3, (ms) => new Promise<number>((ok) => setTimeout(() => ok(ms), ms)));
    expect(r).toEqual([30, 10, 20, 0]);
  });
});
