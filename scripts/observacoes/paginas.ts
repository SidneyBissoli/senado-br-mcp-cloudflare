/**
 * Abre uma página do arquivo bruto (fase B) para o reprocessador: os bytes ORIGINAIS, conferidos pelo
 * sha256 do índice. Três formatos convivem no balde (ver `arquivo.ts`):
 *   - sem linha em `ecidadania_arquivo_pagina` → gzip, formato até 15/11/2026;
 *   - `zstd` → zstd sem dicionário (página grande, como o CSV);
 *   - `zstd+ref` → zstd com a página de referência (em gzip) como dicionário.
 * Página que não volta ao próprio sha é erro: o reprocessador nunca lê bytes que não são os do índice.
 */

import { gunzipSync } from "node:zlib";
import { chaveDaPagina, chaveDaPaginaZstd, chaveDaReferencia, descomprimirZstd, type FormatoPagina } from "../ingest-ecidadania/arquivo.js";
import { sha256Hex, type ClienteR2 } from "../ingest-ecidadania/r2.js";

export interface PaginaGuardada {
  sha256: string;
  /** null = sem linha na tabela de páginas (gzip antigo). */
  formato: FormatoPagina | null;
  referencia: string | null;
}

export class PaginaIlegivelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaginaIlegivelError";
  }
}

export class AbridorDePaginas {
  /** Referências já abertas, por sha (poucas: uma por tipo × versão do portal). */
  private referencias = new Map<string, Promise<Uint8Array>>();

  constructor(private readonly balde: ClienteR2) {}

  private referencia(sha: string): Promise<Uint8Array> {
    let p = this.referencias.get(sha);
    if (!p) {
      p = (async () => {
        const gz = await this.balde.ler(chaveDaReferencia(sha));
        if (!gz) throw new PaginaIlegivelError(`referência ${sha} ausente do balde`);
        const bytes = gunzipSync(gz);
        if (sha256Hex(bytes) !== sha) throw new PaginaIlegivelError(`referência ${sha} não confere com o próprio sha`);
        return bytes;
      })();
      // Falha não fica guardada: a próxima página tenta de novo.
      p.catch(() => this.referencias.delete(sha));
      this.referencias.set(sha, p);
    }
    return p;
  }

  async abrir(p: PaginaGuardada): Promise<Uint8Array> {
    let bytes: Uint8Array;
    if (p.formato === null || p.formato === "gzip") {
      const gz = await this.balde.ler(chaveDaPagina(p.sha256));
      if (!gz) throw new PaginaIlegivelError(`página ${p.sha256} (gzip) ausente do balde`);
      bytes = gunzipSync(gz);
    } else {
      const z = await this.balde.ler(chaveDaPaginaZstd(p.sha256));
      if (!z) throw new PaginaIlegivelError(`página ${p.sha256} (${p.formato}) ausente do balde`);
      if (p.formato === "zstd+ref") {
        if (!p.referencia) throw new PaginaIlegivelError(`página ${p.sha256} zstd+ref sem referência registrada`);
        bytes = descomprimirZstd(z, await this.referencia(p.referencia));
      } else {
        bytes = descomprimirZstd(z);
      }
    }
    if (sha256Hex(bytes) !== p.sha256) throw new PaginaIlegivelError(`página ${p.sha256} não volta ao sha do índice`);
    return bytes;
  }
}

/** Roda `f` sobre `itens` com no máximo `n` ao mesmo tempo; resultados na ordem de `itens`. */
export async function emParalelo<T, R>(itens: readonly T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const saida = new Array<R>(itens.length);
  let prox = 0;
  const trabalhador = async () => {
    while (prox < itens.length) {
      const i = prox++;
      saida[i] = await f(itens[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, trabalhador));
  return saida;
}
