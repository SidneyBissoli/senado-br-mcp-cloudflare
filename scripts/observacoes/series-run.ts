/**
 * C3 no job: monta as duas tabelas (`series.ts`) a partir das observações já em memória e do corpus
 * do D1, e as grava no balde das observações (ou ao lado de `--saida`). Refeitas inteiras a cada run.
 */

import { writeFileSync } from "node:fs";
import type { ClienteR2 } from "../ingest-ecidadania/r2.js";
import { lerCorpus } from "./corpus.js";
import type { Observacao } from "./fundir.js";
import { escreverTabela, type ColunaDaTabela } from "./parquet.js";
import { apoiosDoArquivo, doCorpus, INSTANTE_RESTAURACAO_A3, ordenar, situacaoDoArquivo, type PontoApoios, type PontoSituacao, type VersaoDoCorpus } from "./series.js";

export const CHAVE_SERIE_APOIOS = "ideias/serie-apoios.parquet";
export const CHAVE_HISTORICO_SITUACAO = "ideias/historico-situacao.parquet";

const comuns = <T extends { entityId: string; origem: string; desde: string; ate: string; leituras: number; sha: string | null }>(): ColunaDaTabela<T>[] => [
  { nome: "entity_id", tipo: "texto", valor: (p) => p.entityId },
  { nome: "origem", tipo: "texto", valor: (p) => p.origem },
];
const fim = <T extends { desde: string; ate: string; leituras: number; sha: string | null }>(): ColunaDaTabela<T>[] => [
  { nome: "desde", tipo: "instante", valor: (p) => p.desde },
  { nome: "ate", tipo: "instante", valor: (p) => p.ate },
  { nome: "leituras", tipo: "inteiro", valor: (p) => p.leituras },
  { nome: "sha", tipo: "texto", opcional: true, valor: (p) => p.sha },
];

export const COLUNAS_APOIOS: ColunaDaTabela<PontoApoios>[] = [
  ...comuns<PontoApoios>(),
  { nome: "apoios", tipo: "inteiro", opcional: true, valor: (p) => p.apoios },
  ...fim<PontoApoios>(),
];

export const COLUNAS_SITUACAO: ColunaDaTabela<PontoSituacao>[] = [
  ...comuns<PontoSituacao>(),
  { nome: "situacao_codigo", tipo: "texto", opcional: true, valor: (p) => p.situacaoCodigo },
  { nome: "situacao_nome", tipo: "texto", opcional: true, valor: (p) => p.situacaoNome },
  { nome: "status", tipo: "texto", opcional: true, valor: (p) => p.status },
  ...fim<PontoSituacao>(),
];

export async function gravarSeries(o: {
  obs: readonly Observacao[];
  leitor: string;
  cursor: number;
  balde: ClienteR2;
  saida?: string;
  /** Teste/local: versões já lidas (senão lê do D1). */
  corpus?: VersaoDoCorpus[];
}): Promise<void> {
  const versoes = o.corpus ?? lerCorpus();
  const c = doCorpus(versoes);
  const apoios = ordenar([...apoiosDoArquivo(o.obs), ...c.apoios]);
  const situacao = ordenar([...situacaoDoArquivo(o.obs), ...c.situacao]);
  const kv = {
    leitor: o.leitor, cursor: String(o.cursor), geradoEm: new Date().toISOString(),
    corpusVersoes: String(c.resumo.versoes), corpusRestauracaoA3Excluidas: String(c.resumo.restauracaoA3),
    nota: `origem 'corpus' = ecidadania_history (desde 14/06/2026), um ponto por mudança, status de 3 valores calculado; versões de ${INSTANTE_RESTAURACAO_A3} (restauração A3) excluídas`,
    // Medido 22/11/2026: 38.454 pontos do corpus com apoios 0 antes do conserto A2.
    ressalvaApoiosZeroCorpus: "no corpus, antes de 2026-10-18 (conserto A2), apoios 0 pode ser contagem AUSENTE lida como 0 (parseBrNum); a origem do arquivo (desde 30/10/2026) não tem essa ambiguidade",
  };
  const bApoios = escreverTabela(apoios, COLUNAS_APOIOS, kv);
  const bSituacao = escreverTabela(situacao, COLUNAS_SITUACAO, kv);
  if (o.saida) {
    const base = o.saida.replace(/\.parquet$/, "");
    writeFileSync(`${base}-serie-apoios.parquet`, bApoios);
    writeFileSync(`${base}-historico-situacao.parquet`, bSituacao);
  } else {
    await o.balde.gravar(CHAVE_SERIE_APOIOS, bApoios, { "content-type": "application/vnd.apache.parquet" });
    await o.balde.gravar(CHAVE_HISTORICO_SITUACAO, bSituacao, { "content-type": "application/vnd.apache.parquet" });
  }
  const conta = (xs: { origem: string }[], arquivo: (s: string) => boolean) => `${xs.filter((x) => arquivo(x.origem)).length} do arquivo + ${xs.filter((x) => !arquivo(x.origem)).length} do corpus`;
  console.log(
    `[observacoes][series] apoios: ${conta(apoios, (s) => s !== "corpus")} (${(bApoios.length / 1048576).toFixed(2)} MB); ` +
      `situação: ${conta(situacao, (s) => s !== "corpus")} (${(bSituacao.length / 1048576).toFixed(2)} MB); ` +
      `corpus: ${c.resumo.versoes} versões, ${c.resumo.restauracaoA3} da restauração A3 excluídas`,
  );
}
