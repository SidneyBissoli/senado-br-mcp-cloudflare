/**
 * D3 — núcleo puro da projeção da camada 3 no D1 (decisão 1 do dono, 22/11/2026: "cópia no D1, gravando
 * só as linhas que mudaram"). Sem rede, sem banco: quem lê o balde e aplica o SQL é `projetar-d1.ts`.
 *
 * Como sabe "o que mudou" sem ler o banco inteiro: a cada projeção aplicada, o job grava no balde das
 * observações um RETRATO do que o D1 tem (`projecao-d1/<tabela>.parquet`: chave × hash da linha). A
 * projeção seguinte compara as linhas novas com esse retrato e emite só upserts das linhas novas ou
 * mudadas e deletes das que sumiram. O retrato só é regravado depois que TODO o SQL da tabela aplicou:
 * se um arquivo falha no meio, o run seguinte compara com o retrato antigo e reemite tudo (upsert e
 * delete são idempotentes). Sem retrato, ou com a DDL mudada (o retrato guarda o hash dela), a tabela
 * é refeita: DROP + CREATE + carga inteira.
 *
 * A tabela é do job, não de uma migration: as migrations deste repo são reaplicadas em todo run e só
 * podem criar (IF NOT EXISTS), e a DDL aqui sai do dicionário — mudou uma coluna, a projeção refaz a
 * tabela sozinha. É tudo reconstruível do balde (nada do corpus é tocado).
 */

import { createHash } from "node:crypto";
import { TABELA_CONTROLE_C3, TABELAS_C3, type TabelaC3 } from "../../src/scraper/camada3-tabelas.js";
import { sqlValue } from "../ingest-ecidadania/sql.js";
import { DICIONARIO, type ColunaDoDicionario, type TabelaDoDicionario, type TipoFrictionless } from "./dicionario.js";

/** Limite de um statement no D1 é 100 KB; o INSERT de várias linhas fecha antes disto. */
export const MAX_BYTES_STATEMENT = 90_000;
/** Linhas por INSERT (o VALUES de várias linhas não tem limite no SQLite ≥ 3.8.8; isto é folga). */
export const MAX_LINHAS_STATEMENT = 500;
/** Tamanho de cada arquivo .sql aplicado de uma vez (`--file` é atômico do lado do servidor). */
export const MAX_BYTES_ARQUIVO = 16 * 1024 * 1024;

const TIPO_SQL: Record<TipoFrictionless, string> = {
  integer: "INTEGER", number: "REAL", string: "TEXT", date: "TEXT", time: "TEXT", datetime: "TEXT",
};

const ident = (s: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`identificador inválido: ${s}`);
  return `"${s}"`;
};

export interface TabelaProjetada extends TabelaC3 {
  dic: TabelaDoDicionario;
  /** As colunas do dicionário que vão ao D1 (sem as de `omitir`), na ordem do dicionário. */
  colunas: ColunaDoDicionario[];
}

export const PROJETADAS: readonly TabelaProjetada[] = TABELAS_C3.map((t) => {
  const dic = DICIONARIO.find((d) => d.caminho === t.caminho);
  if (!dic) throw new Error(`tabela projetada fora do dicionário: ${t.caminho}`);
  const omitir = t.omitir ?? [];
  for (const c of omitir) {
    if (!dic.colunas.some((x) => x.nome === c) || dic.chave.includes(c)) throw new Error(`${t.caminho}: omitir ${c} (inexistente ou da chave)`);
  }
  const colunas = dic.colunas.filter((c) => !omitir.includes(c.nome));
  for (const cols of t.indices) for (const c of cols) if (!colunas.some((x) => x.nome === c)) throw new Error(`${t.caminho}: índice em coluna inexistente ${c}`);
  if (t.filtro && !dic.colunas.some((x) => x.nome === t.filtro!.coluna)) throw new Error(`${t.caminho}: filtro em coluna inexistente ${t.filtro.coluna}`);
  if (t.somenteCom) {
    const ref = DICIONARIO.find((d) => d.caminho === t.somenteCom!.de);
    if (!ref || !TABELAS_C3.some((x) => x.caminho === t.somenteCom!.de)) throw new Error(`${t.caminho}: somenteCom de tabela não projetada ${t.somenteCom.de}`);
    for (const c of t.somenteCom.colunas) if (!dic.colunas.some((x) => x.nome === c) || !ref.colunas.some((x) => x.nome === c)) throw new Error(`${t.caminho}: somenteCom em coluna inexistente ${c}`);
  }
  return { ...t, dic, colunas };
});

/** Chave de junção de `somenteCom` (valores normalizados em JSON). */
const juncao = (l: Record<string, unknown>, colunas: readonly string[]) => JSON.stringify(colunas.map((c) => (typeof l[c] === "bigint" ? Number(l[c]) : (l[c] ?? null))));

/** As linhas que passam no `filtro` da tabela. */
export function filtrar(t: Pick<TabelaProjetada, "filtro">, linhas: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const f = t.filtro;
  return f ? linhas.filter((l) => !f.excluir.includes(String(l[f.coluna]))) : [...linhas];
}

/** As linhas de `t` cujas colunas de `somenteCom` aparecem nas linhas (já filtradas) da tabela de referência. */
export function somenteCom(t: Pick<TabelaProjetada, "somenteCom">, linhas: readonly Record<string, unknown>[], referencia: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const s = t.somenteCom;
  if (!s) return [...linhas];
  const chaves = new Set(referencia.map((r) => juncao(r, s.colunas)));
  return linhas.filter((l) => chaves.has(juncao(l, s.colunas)));
}

/** CREATE TABLE + índices da tabela, gerados do dicionário. */
export function ddl(t: TabelaProjetada): string[] {
  const cols = t.colunas.map((c) => `${ident(c.nome)} ${TIPO_SQL[c.tipo]}`);
  return [
    `CREATE TABLE IF NOT EXISTS ${ident(t.tabela)} (${ident("chave")} TEXT PRIMARY KEY, ${cols.join(", ")}) WITHOUT ROWID;`,
    ...t.indices.map((ix) => `CREATE INDEX IF NOT EXISTS ${ident(`idx_${t.tabela}_${ix.join("_")}`)} ON ${ident(t.tabela)} (${ix.map(ident).join(", ")});`),
  ];
}

export const DDL_CONTROLE =
  `CREATE TABLE IF NOT EXISTS ${ident(TABELA_CONTROLE_C3)} (` +
  `"tabela" TEXT PRIMARY KEY, "gerado_em" TEXT, "aplicado_em" TEXT NOT NULL, "linhas" INTEGER NOT NULL, ` +
  `"gravadas" INTEGER NOT NULL, "removidas" INTEGER NOT NULL);`;

/** Hash da DDL: o retrato de uma DDL diferente não vale (a tabela é refeita). */
export function esquemaDe(t: TabelaProjetada): string {
  return createHash("sha256").update(ddl(t).join("\n")).digest("hex").slice(0, 16);
}

/** Valor de uma célula como vai ao SQL (o Parquet devolve Date nos instantes; INT64 pode vir bigint). */
export function normalizar(v: unknown, tipo: TipoFrictionless): string | number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v);
  return tipo === "datetime" ? new Date(s).toISOString() : s;
}

export interface LinhaProjetada {
  chave: string;
  hash: string;
  valores: (string | number | null)[];
}

/** 16 hex do sha256 da chave do dicionário em JSON. */
export const chaveCurta = (chaveJson: string): string => createHash("sha256").update(chaveJson).digest("hex").slice(0, 16);

/** Linhas lidas do Parquet → valores na ordem das colunas projetadas, chave e hash. */
export function projetarLinhas(t: TabelaProjetada, linhas: readonly Record<string, unknown>[]): LinhaProjetada[] {
  const idx = t.dic.chave.map((k) => t.colunas.findIndex((c) => c.nome === k));
  const vistas = new Set<string>();
  return linhas.map((l) => {
    const valores = t.colunas.map((c) => normalizar(l[c.nome], c.tipo));
    const naChave = JSON.stringify(idx.map((i) => valores[i]));
    const chave = chaveCurta(naChave);
    if (vistas.has(chave)) throw new Error(`${t.caminho}: chave repetida (ou colisão do hash) ${naChave}`);
    vistas.add(chave);
    const hash = createHash("sha256").update(JSON.stringify(valores)).digest("hex").slice(0, 16);
    return { chave, hash, valores };
  });
}

export interface Diferenca {
  gravar: LinhaProjetada[];
  remover: string[];
}

/** Linhas a gravar (novas ou com hash diferente) e chaves a remover, contra o retrato. */
export function diferenca(retrato: ReadonlyMap<string, string>, linhas: readonly LinhaProjetada[]): Diferenca {
  const gravar = linhas.filter((l) => retrato.get(l.chave) !== l.hash);
  const agora = new Set(linhas.map((l) => l.chave));
  const remover = [...retrato.keys()].filter((k) => !agora.has(k));
  return { gravar, remover };
}

/** Junta statements em arquivos de no máximo `maxBytes` (um statement nunca é partido). */
function emArquivos(stmts: readonly string[], maxBytes: number): string[] {
  const arquivos: string[] = [];
  let atual: string[] = [];
  let bytes = 0;
  for (const s of stmts) {
    const n = Buffer.byteLength(s) + 1;
    if (atual.length > 0 && bytes + n > maxBytes) {
      arquivos.push(atual.join("\n") + "\n");
      atual = [];
      bytes = 0;
    }
    atual.push(s);
    bytes += n;
  }
  if (atual.length > 0) arquivos.push(atual.join("\n") + "\n");
  return arquivos;
}

/** INSERTs de várias linhas, cada um abaixo do limite de statement do D1. */
export function inserts(t: TabelaProjetada, linhas: readonly LinhaProjetada[], maxBytes = MAX_BYTES_STATEMENT): string[] {
  const cab = `INSERT OR REPLACE INTO ${ident(t.tabela)} (${["chave", ...t.colunas.map((c) => c.nome)].map(ident).join(", ")}) VALUES `;
  const out: string[] = [];
  let tuplas: string[] = [];
  let bytes = Buffer.byteLength(cab);
  const fechar = () => {
    if (tuplas.length) out.push(cab + tuplas.join(",") + ";");
    tuplas = [];
    bytes = Buffer.byteLength(cab);
  };
  for (const l of linhas) {
    const tupla = `(${[l.chave, ...l.valores].map(sqlValue).join(",")})`;
    const n = Buffer.byteLength(tupla) + 1;
    if (tuplas.length > 0 && (bytes + n > maxBytes || tuplas.length >= MAX_LINHAS_STATEMENT)) fechar();
    if (Buffer.byteLength(cab) + n > 100_000) throw new Error(`${t.caminho}: linha ${l.chave} passa do limite de statement do D1 (${n} bytes)`);
    tuplas.push(tupla);
    bytes += n;
  }
  fechar();
  return out;
}

/** DELETEs por chave, em blocos. */
export function deletes(t: TabelaProjetada, chaves: readonly string[], maxBytes = MAX_BYTES_STATEMENT): string[] {
  const cab = `DELETE FROM ${ident(t.tabela)} WHERE ${ident("chave")} IN (`;
  const out: string[] = [];
  let bloco: string[] = [];
  let bytes = 0;
  for (const k of chaves) {
    const v = sqlValue(k);
    if (bloco.length > 0 && (bytes + v.length + 1 > maxBytes || bloco.length >= MAX_LINHAS_STATEMENT)) {
      out.push(cab + bloco.join(",") + ");");
      bloco = [];
      bytes = 0;
    }
    bloco.push(v);
    bytes += v.length + 1;
  }
  if (bloco.length) out.push(cab + bloco.join(",") + ");");
  return out;
}

export interface PlanoDaTabela {
  /** Arquivos .sql, na ordem; o último termina com a linha de controle. */
  arquivos: string[];
  completa: boolean;
  gravadas: number;
  removidas: number;
}

/**
 * SQL de uma tabela. `completa` = refazer (sem retrato válido): DROP + CREATE no 1º arquivo, carga
 * inteira, sem deletes. Senão CREATE IF NOT EXISTS (defensivo) + deletes + upserts. A linha de
 * controle (`c3_projecao`) vai no fim do último arquivo: só fica gravada se todos aplicaram.
 */
export function planejar(
  t: TabelaProjetada,
  linhas: readonly LinhaProjetada[],
  retrato: ReadonlyMap<string, string> | null,
  o: { geradoEm: string | null; aplicadoEm: string; maxBytesArquivo?: number },
): PlanoDaTabela {
  const completa = retrato === null;
  const d = completa ? { gravar: [...linhas], remover: [] } : diferenca(retrato, linhas);
  const controle =
    `INSERT OR REPLACE INTO ${ident(TABELA_CONTROLE_C3)} ("tabela", "gerado_em", "aplicado_em", "linhas", "gravadas", "removidas") VALUES (` +
    [t.tabela, o.geradoEm, o.aplicadoEm, linhas.length, d.gravar.length, d.remover.length].map(sqlValue).join(", ") + ");";
  const stmts = [
    DDL_CONTROLE,
    ...(completa ? [`DROP TABLE IF EXISTS ${ident(t.tabela)};`] : []),
    ...ddl(t),
    ...deletes(t, d.remover),
    ...inserts(t, d.gravar),
    controle,
  ];
  return { arquivos: emArquivos(stmts, o.maxBytesArquivo ?? MAX_BYTES_ARQUIVO), completa, gravadas: d.gravar.length, removidas: d.remover.length };
}
