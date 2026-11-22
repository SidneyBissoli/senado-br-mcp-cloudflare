/**
 * A cópia da camada 2 em Parquet (decisão 2 do desenho da fase C): `hyparquet-writer` para gravar,
 * `hyparquet` para reler a cópia anterior. Esquema declarado à mão para os instantes saírem como UTC
 * (`isAdjustedToUTC`); sem isso o R e o polars os leem sem fuso (medido em 21/11/2026).
 *
 * O cursor (última linha do índice já fundida) e a versão do leitor vão nos METADADOS do próprio
 * arquivo: cópia e cursor são um objeto só, então não existe "cópia nova com cursor velho" se o job
 * morrer no meio da gravação.
 */

import { parquetMetadata, parquetReadObjects } from "hyparquet";
import { parquetWriteBuffer } from "hyparquet-writer";
import type { Fonte } from "./fatos.js";
import type { Observacao } from "./fundir.js";

export interface MetadadosDaCopia {
  /** Maior id do `ecidadania_arquivo_indice` já fundido (0 = nenhum). */
  cursor: number;
  /** `observacoes@<sha>` — mudou, a cópia não serve e o reprocessamento é completo. */
  leitor: string;
  entidade: string;
  geradoEm: string;
}

const texto = (name: string, opcional = false) => ({
  name, type: "BYTE_ARRAY" as const, converted_type: "UTF8" as const, repetition_type: opcional ? ("OPTIONAL" as const) : ("REQUIRED" as const),
});
const instante = (name: string) => ({
  name, type: "INT64" as const, repetition_type: "REQUIRED" as const,
  logical_type: { type: "TIMESTAMP" as const, isAdjustedToUTC: true, unit: "MILLIS" as const },
});
const inteiro = (name: string) => ({ name, type: "INT32" as const, repetition_type: "REQUIRED" as const });

const COLUNAS = [
  texto("entidade"), texto("entity_id"), texto("fonte"), texto("campo"), texto("valor", true),
  instante("visto_primeiro"), instante("visto_ultimo"), inteiro("leituras"),
  texto("sha_primeiro"), texto("sha_ultimo"), inteiro("indice_primeiro"), inteiro("indice_ultimo"),
];

export function escreverCopia(obs: readonly Observacao[], meta: MetadadosDaCopia): Uint8Array {
  const col = <T>(f: (o: Observacao) => T) => obs.map(f);
  const data = new Map<string, unknown[]>([
    ["entidade", col((o) => o.entidade)],
    ["entity_id", col((o) => o.entityId)],
    ["fonte", col((o) => o.fonte)],
    ["campo", col((o) => o.campo)],
    ["valor", col((o) => o.valor)],
    ["visto_primeiro", col((o) => new Date(o.vistoPrimeiro))],
    ["visto_ultimo", col((o) => new Date(o.vistoUltimo))],
    ["leituras", col((o) => o.leituras)],
    ["sha_primeiro", col((o) => o.shaPrimeiro)],
    ["sha_ultimo", col((o) => o.shaUltimo)],
    ["indice_primeiro", col((o) => o.indicePrimeiro)],
    ["indice_ultimo", col((o) => o.indiceUltimo)],
  ]);
  const buf = parquetWriteBuffer({
    schema: [{ name: "root", num_children: COLUNAS.length }, ...COLUNAS],
    columnData: COLUNAS.map((c) => ({ name: c.name, data: data.get(c.name)! as never })),
    kvMetadata: [
      { key: "cursor", value: String(meta.cursor) },
      { key: "leitor", value: meta.leitor },
      { key: "entidade", value: meta.entidade },
      { key: "geradoEm", value: meta.geradoEm },
    ],
    createdBy: "senado-br-mcp observacoes (fase C)",
  });
  return new Uint8Array(buf);
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(Number(v)).toISOString());

export async function lerCopia(bytes: Uint8Array): Promise<{ meta: MetadadosDaCopia; obs: Observacao[] }> {
  const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const kv = new Map((parquetMetadata(file).key_value_metadata ?? []).map((e) => [e.key, e.value ?? ""]));
  const cursor = Number(kv.get("cursor"));
  const leitor = kv.get("leitor") ?? "";
  if (!Number.isInteger(cursor) || !leitor) throw new Error("cópia sem cursor/leitor nos metadados");
  const linhas = (await parquetReadObjects({ file })) as Array<Record<string, unknown>>;
  const obs = linhas.map((r) => ({
    entidade: String(r.entidade),
    entityId: String(r.entity_id),
    fonte: String(r.fonte) as Fonte,
    campo: String(r.campo),
    valor: r.valor === null || r.valor === undefined ? null : String(r.valor),
    vistoPrimeiro: iso(r.visto_primeiro),
    vistoUltimo: iso(r.visto_ultimo),
    leituras: Number(r.leituras),
    shaPrimeiro: String(r.sha_primeiro),
    shaUltimo: String(r.sha_ultimo),
    indicePrimeiro: Number(r.indice_primeiro),
    indiceUltimo: Number(r.indice_ultimo),
  }));
  return { meta: { cursor, leitor, entidade: kv.get("entidade") ?? "", geradoEm: kv.get("geradoEm") ?? "" }, obs };
}

/**
 * Coluna de uma tabela derivada (C3, D1): texto, instante UTC, inteiro (INT32) ou decimal (DOUBLE);
 * `opcional` aceita null — em TODOS os tipos (até 22/11/2026 o instante saía obrigatório mesmo opcional).
 */
export interface ColunaDaTabela<T> {
  nome: string;
  tipo: "texto" | "instante" | "inteiro" | "decimal";
  opcional?: boolean;
  valor: (linha: T) => string | number | null;
}

/** Grava uma tabela derivada em Parquet com o mesmo cuidado da cópia (esquema explícito, UTC). */
export function escreverTabela<T>(linhas: readonly T[], colunas: readonly ColunaDaTabela<T>[], kv: Record<string, string>): Uint8Array {
  const schema = colunas.map((c) => {
    const repetition_type = c.opcional ? ("OPTIONAL" as const) : ("REQUIRED" as const);
    if (c.tipo === "instante") return { ...instante(c.nome), repetition_type };
    if (c.tipo === "inteiro") return { ...inteiro(c.nome), repetition_type };
    if (c.tipo === "decimal") return { name: c.nome, type: "DOUBLE" as const, repetition_type };
    return texto(c.nome, c.opcional);
  });
  const buf = parquetWriteBuffer({
    schema: [{ name: "root", num_children: schema.length }, ...schema],
    columnData: colunas.map((c) => ({
      name: c.nome,
      data: linhas.map((l) => {
        const v = c.valor(l);
        return c.tipo === "instante" && v !== null ? new Date(String(v)) : v;
      }) as never,
    })),
    kvMetadata: Object.entries(kv).map(([key, value]) => ({ key, value })),
    createdBy: "senado-br-mcp observacoes (fase C)",
  });
  return new Uint8Array(buf);
}
