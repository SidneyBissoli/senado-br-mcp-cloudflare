/**
 * Peças puras do reprocessador (`index.ts`): a consulta de um lote do índice e as leituras de série
 * de uma linha dele. Separadas para os testes importarem sem rodar o script.
 */

import { fatosDaListagem, fatosDoDetalhe, fonteDaListagem, fonteDaUrl, type Fato } from "./fatos.js";
import type { Leitura } from "./fundir.js";

export const BALDE_OBSERVACOES = "ecidadania-observacoes";
export const ENTIDADE = "ideias";
export const CHAVE_DA_COPIA = `${ENTIDADE}/observacoes.parquet`;
/** Relatório da C4 (invariantes), regravado a cada run. */
export const CHAVE_DOS_INVARIANTES = `${ENTIDADE}/invariantes.json`;
export const LOTE = 2000;

export interface LinhaDoIndice {
  id: number;
  url: string;
  entity_id: string | null;
  instante: string;
  status_http: number;
  sha256: string;
  formato: string | null;
  referencia: string | null;
}

/** SQL de um lote do índice (valores numéricos e constantes: nada vindo de fora entra aqui). */
export function sqlDoLote(cursor: number, lote: number): string {
  if (!Number.isInteger(cursor) || !Number.isInteger(lote)) throw new Error("cursor/lote inválido");
  return (
    "SELECT i.id, i.url, i.entity_id, i.instante, i.status_http, i.sha256, p.formato, p.referencia " +
    "FROM ecidadania_arquivo_indice i LEFT JOIN ecidadania_arquivo_pagina p ON p.sha256 = i.sha256 " +
    `WHERE i.entidade = '${ENTIDADE}' AND i.id > ${cursor} ORDER BY i.id LIMIT ${lote}`
  );
}

export interface Contagem {
  linhasDoIndice: number;
  ignoradas: number;
  detalhe: number;
  listagem: number;
  leiturasDeSerie: number;
  erroLeitura: number;
  listagemForaDoMolde: number;
}

/**
 * Fatos de UMA linha do índice, já com a página aberta → leituras por série. Lança só por página
 * ilegível no balde (aí o run para: pular deixaria um buraco que o cursor esconderia).
 */
export function leiturasDaLinha(l: LinhaDoIndice, html: string, c: Contagem): Leitura[] {
  const base = { indice: l.id, instante: l.instante, sha256: l.sha256, entidade: ENTIDADE };
  if (fonteDaUrl(l.url) === "detalhe") {
    const fatos = fatosDoDetalhe(l.status_http, html);
    if (fatos.some((f) => f.campo === "erroLeitura")) c.erroLeitura++;
    return l.entity_id ? [{ ...base, fonte: "detalhe", entityId: l.entity_id, fatos }] : [];
  }
  // A listagem de cada situação é uma série própria (ver `fatos.ts`).
  const fonte = fonteDaListagem(l.url);
  let porId: Map<string, Fato[]>;
  try {
    porId = fatosDaListagem(l.url, html);
  } catch (e) {
    c.listagemForaDoMolde++;
    console.warn(`[observacoes] listagem fora do molde (índice ${l.id}, ${l.url}): ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
  return [...porId].map(([entityId, fatos]) => ({ ...base, fonte, entityId, fatos }));
}

