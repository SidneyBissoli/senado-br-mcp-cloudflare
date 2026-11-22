/**
 * D2 — núcleo puro do pacote do dataset 3.0.0: o manifesto Frictionless (`datapackage.json`) a partir
 * do próprio dicionário (fonte única: nome, tipo, descrição, fonte, calculada, nota, chave).
 *
 * Formato único: Parquet (decisão do dono de 22/11/2026, contra Parquet + CSV). O Parquet guarda o
 * tipo de cada coluna e os nulos; R (`arrow`), Python (polars/pandas) e DuckDB o leem direto. Validado
 * em 22/11/2026 com `frictionless[parquet]` 5.18.1: 14 de 14 tabelas válidas com este manifesto.
 */

import { DICIONARIO, ESQUEMA_V3, arquivoDaTabela, nomeDoRecurso, type ColunaDoDicionario, type TabelaDoDicionario } from "./dicionario.js";

/** Chave da tabela no balde: as séries da C3 ficam onde a C3 as grava; o resto, sob `publicacao/`. */
export function chaveNoBalde(t: TabelaDoDicionario): string {
  return t.caminho === "ideias/serie-apoios" || t.caminho === "ideias/historico-situacao" ? `${t.caminho}.parquet` : `publicacao/${t.caminho}.parquet`;
}

export { arquivoDaTabela, nomeDoRecurso };

export const LICENCA = "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.";

/** Formato de cada tipo para o validador (o padrão do Frictionless não aceita milissegundos nem HH:MM). */
function formato(tipo: ColunaDoDicionario["tipo"]): Record<string, string> {
  if (tipo === "datetime") return { format: "%Y-%m-%dT%H:%M:%S.%fZ" };
  if (tipo === "time") return { format: "%H:%M" };
  return {};
}

export interface Contagem {
  caminho: string;
  linhas: number;
}

/**
 * `datapackage.json` (Frictionless Tabular Data Package): um recurso Parquet por tabela. Sem `bytes`
 * no recurso: o validador não o confere em Parquet (lê "None" e reprova); tamanho e sha256 de cada
 * arquivo vão no `release.json` e no `SHA256SUMS` do freeze.
 */
export function manifesto(contagens: readonly Contagem[], geradoEm: string): Record<string, unknown> {
  const por = new Map(contagens.map((c) => [c.caminho, c]));
  return {
    profile: "tabular-data-package",
    name: "ecidadania-participacao",
    title: "Dataset de participação do e-Cidadania (Senado Federal)",
    description:
      "Ideias legislativas, consultas públicas, eventos interativos e o acervo de votos por UF do portal e-Cidadania, " +
      "em tabelas tidy (Parquet) com a origem de cada bloco de valores (arquivo de páginas ou corpus) e as séries no tempo. " +
      "Dicionário completo em dicionario.md.",
    schemaVersion: ESQUEMA_V3,
    licenses: [{ name: "other-at", title: LICENCA, path: "https://www12.senado.leg.br/dados-abertos" }],
    sources: [
      { title: "Portal e-Cidadania (Senado Federal)", path: "https://www12.senado.leg.br/ecidadania" },
      { title: "Acervo Arquimedes — proposições com votos", path: "https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv" },
    ],
    created: geradoEm,
    resources: DICIONARIO.filter((t) => por.has(t.caminho)).map((t) => ({
      profile: "tabular-data-resource",
      name: nomeDoRecurso(t),
      title: t.titulo,
      description: t.descricao,
      path: arquivoDaTabela(t),
      format: "parquet",
      mediatype: "application/vnd.apache.parquet",
      rows: por.get(t.caminho)!.linhas,
      schema: {
        fields: t.colunas.map((col) => ({
          name: col.nome, type: col.tipo, ...formato(col.tipo), description: col.descricao, fonte: col.fonte,
          ...(col.calculada ? { calculada: true } : {}), ...(col.nota ? { nota: col.nota } : {}),
        })),
        primaryKey: t.chave,
      },
    })),
  };
}
