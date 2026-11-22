/**
 * D2 — núcleo puro do pacote do dataset 3.0.0: CSV a partir das linhas lidas do Parquet, guiado pelo
 * tipo de cada coluna no dicionário, e o manifesto Frictionless (`datapackage.json`) a partir do
 * próprio dicionário (fonte única: nome, tipo, descrição, fonte, calculada, nota, chave).
 *
 * CSV: RFC 4180 (vírgula, aspas duplas, CRLF), UTF-8 sem BOM, cabeçalho na 1ª linha, null = célula
 * vazia (o `missingValues` padrão do Frictionless). Instantes em ISO 8601 UTC com milissegundos;
 * números como o JavaScript os escreve (ponto decimal), para a máquina — não para leitura humana.
 */

import { DICIONARIO, ESQUEMA_V3, type ColunaDoDicionario, type TabelaDoDicionario } from "./dicionario.js";

/** Chave da tabela no balde: as séries da C3 ficam onde a C3 as grava; o resto, sob `publicacao/`. */
export function chaveNoBalde(t: TabelaDoDicionario): string {
  return t.caminho === "ideias/serie-apoios" || t.caminho === "ideias/historico-situacao" ? `${t.caminho}.parquet` : `publicacao/${t.caminho}.parquet`;
}

export const LICENCA = "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.";

/** Uma célula no CSV. */
export function celula(v: unknown, tipo: ColunaDoDicionario["tipo"]): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === "bigint") s = v.toString();
  else if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`número inválido: ${v}`);
    if (tipo === "integer" && !Number.isInteger(v)) throw new Error(`inteiro com casa decimal: ${v}`);
    s = String(v);
  } else s = String(v);
  if (tipo === "datetime" && !(v instanceof Date)) s = new Date(s).toISOString();
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** As linhas de uma tabela em CSV, nas colunas e na ordem do dicionário. */
export function paraCsv(linhas: readonly Record<string, unknown>[], t: TabelaDoDicionario): string {
  const cab = t.colunas.map((c) => c.nome).join(",");
  const corpo = linhas.map((l) => t.colunas.map((c) => celula(l[c.nome], c.tipo)).join(","));
  return [cab, ...corpo].join("\r\n") + "\r\n";
}

/** Formato de cada tipo para o validador (o padrão do Frictionless não aceita milissegundos nem HH:MM). */
function formato(tipo: ColunaDoDicionario["tipo"]): Record<string, string> {
  if (tipo === "datetime") return { format: "%Y-%m-%dT%H:%M:%S.%fZ" };
  if (tipo === "time") return { format: "%H:%M" };
  return {};
}

export interface Contagem {
  caminho: string;
  linhas: number;
  bytesCsv: number;
  bytesParquet: number;
}

/** `datapackage.json` (Frictionless Tabular Data Package): um recurso CSV por tabela, Parquet ao lado. */
export function manifesto(contagens: readonly Contagem[], geradoEm: string): Record<string, unknown> {
  const por = new Map(contagens.map((c) => [c.caminho, c]));
  return {
    profile: "tabular-data-package",
    name: "ecidadania-participacao",
    title: "Dataset de participação do e-Cidadania (Senado Federal)",
    description:
      "Ideias legislativas, consultas públicas, eventos interativos e o acervo de votos por UF do portal e-Cidadania, " +
      "em tabelas tidy com a origem de cada bloco de valores (arquivo de páginas ou corpus) e as séries no tempo. " +
      "Dicionário completo em dicionario.md.",
    schemaVersion: ESQUEMA_V3,
    licenses: [{ name: "other-at", title: LICENCA, path: "https://www12.senado.leg.br/dados-abertos" }],
    sources: [
      { title: "Portal e-Cidadania (Senado Federal)", path: "https://www12.senado.leg.br/ecidadania" },
      { title: "Acervo Arquimedes — proposições com votos", path: "https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv" },
    ],
    created: geradoEm,
    resources: DICIONARIO.filter((t) => por.has(t.caminho)).map((t) => {
      const c = por.get(t.caminho)!;
      return {
        profile: "tabular-data-resource",
        name: t.caminho.replace(/[/_]/g, "-"),
        title: t.titulo,
        description: t.descricao,
        path: `${t.caminho}.csv`,
        format: "csv",
        mediatype: "text/csv",
        encoding: "utf-8",
        bytes: c.bytesCsv,
        rows: c.linhas,
        parquet: { path: `${t.caminho}.parquet`, bytes: c.bytesParquet },
        schema: {
          fields: t.colunas.map((col) => ({
            name: col.nome, type: col.tipo, ...formato(col.tipo), description: col.descricao, fonte: col.fonte,
            ...(col.calculada ? { calculada: true } : {}), ...(col.nota ? { nota: col.nota } : {}),
          })),
          primaryKey: t.chave,
          missingValues: [""],
        },
      };
    }),
  };
}
