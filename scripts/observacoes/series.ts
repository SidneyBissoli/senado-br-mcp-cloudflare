/**
 * Fase C3 do ROADMAP — série de apoios e histórico de situação das ideias. Puro: recebe as
 * observações (camada 2) e as versões do corpus (`ecidadania_history`), devolve as linhas.
 *
 * Duas origens, nunca misturadas (cada linha diz de onde veio):
 *   - ARQUIVO (desde 30/10/2026): as observações. Uma linha por valor visto, com o primeiro e o último
 *     instante em que foi visto e quantas leituras o sustentam. `origem` = a série (`listagem-s5`,
 *     `detalhe`). Entre duas leituras o arquivo não sabe nada: "visto de X a Y" não afirma o meio.
 *   - CORPUS (desde 14/06/2026): as versões do `ecidadania_history`, um ponto por MUDANÇA do valor
 *     (o corpus só grava versão quando o registro muda). `desde = ate = scraped_at`. O status do
 *     corpus é a classificação de 3 valores do projeto (calculada), não a situação do portal.
 *
 * Fica de fora a restauração A3 de 18/10/2026 01:43:21.887Z: aquelas versões reescreveram campos a
 * partir do próprio history, não leram o portal (ROADMAP A3: "a C3 deve reconhecê-lo").
 *
 * Situação do portal pelo arquivo: a ideia vista na listagem da situação N de X a Y. O portal lista a
 * mesma ideia em duas situações ao mesmo tempo (5+6, 5+8): são duas linhas, nenhuma prevalece. A
 * ausência de uma listagem não é leitura — se a ideia some de N e volta, o intervalo cobre o meio.
 */

import type { Observacao } from "./fundir.js";

/** Instante da restauração A3 (ROADMAP, fase A): versões do history que não são leitura do portal. */
export const INSTANTE_RESTAURACAO_A3 = "2026-10-18T01:43:21.887Z";

/** Situações do portal, com os nomes do menu da `pesquisaideia` (`ideias-listing.ts`, medido 30/10/2026). */
export const NOME_DA_SITUACAO: Record<string, string> = {
  "5": "Ideias abertas",
  "6": "Ideias em avaliação na CDH",
  "7": "Ideias encerradas sem apoios suficientes",
  "8": "Ideias aguardando envio à CDH",
  "9": "Ideias debatidas pela CDH",
  "10": "Ideias transformadas em proposição",
  "99": "Ideias arquivadas ao final da legislatura",
};

export interface PontoApoios {
  entityId: string;
  /** `listagem-sN` | `detalhe` (arquivo) | `corpus`. */
  origem: string;
  apoios: number | null;
  desde: string;
  ate: string;
  leituras: number;
  /** Página do arquivo onde o valor aparece primeiro (null no corpus). */
  sha: string | null;
}

export interface PontoSituacao {
  entityId: string;
  /** `listagem` (arquivo) | `corpus`. */
  origem: string;
  /** Código e nome do portal (só arquivo). */
  situacaoCodigo: string | null;
  situacaoNome: string | null;
  /** Classificação de 3 valores do projeto, calculada (só corpus): aberta | encerrada | convertida | removida. */
  status: string | null;
  desde: string;
  ate: string;
  leituras: number;
  sha: string | null;
}

/** Uma versão do `ecidadania_history`, só com o que a C3 usa. */
export interface VersaoDoCorpus {
  entityId: string;
  scrapedAt: string;
  apoios: number | null;
  status: string | null;
}

const situacaoDaFonte = (fonte: string) => /^listagem-s(\d+)$/.exec(fonte)?.[1] ?? null;

export function apoiosDoArquivo(obs: readonly Observacao[]): PontoApoios[] {
  return obs
    .filter((o) => o.entidade === "ideias" && o.campo === "apoios")
    .map((o) => ({
      entityId: o.entityId, origem: o.fonte, apoios: o.valor === null ? null : Number(o.valor),
      desde: o.vistoPrimeiro, ate: o.vistoUltimo, leituras: o.leituras, sha: o.shaPrimeiro,
    }));
}

/** Presença em cada listagem: a união das linhas de `titulo` da série (toda leitura traz uma). */
export function situacaoDoArquivo(obs: readonly Observacao[]): PontoSituacao[] {
  const m = new Map<string, PontoSituacao>();
  for (const o of obs) {
    if (o.entidade !== "ideias" || o.campo !== "titulo") continue;
    const cod = situacaoDaFonte(o.fonte);
    if (cod === null) continue;
    const k = `${o.entityId}\u0000${cod}`;
    const p = m.get(k);
    if (!p) {
      m.set(k, {
        entityId: o.entityId, origem: "listagem", situacaoCodigo: cod, situacaoNome: NOME_DA_SITUACAO[cod] ?? null, status: null,
        desde: o.vistoPrimeiro, ate: o.vistoUltimo, leituras: o.leituras, sha: o.shaPrimeiro,
      });
    } else {
      if (o.vistoPrimeiro < p.desde) {
        p.desde = o.vistoPrimeiro;
        p.sha = o.shaPrimeiro;
      }
      if (o.vistoUltimo > p.ate) p.ate = o.vistoUltimo;
      p.leituras += o.leituras;
    }
  }
  return [...m.values()];
}

export interface ResumoDoCorpus {
  versoes: number;
  restauracaoA3: number;
}

/** Pontos de MUDANÇA do corpus (apoios e status), sem a restauração A3. Ordena por id e instante. */
export function doCorpus(versoes: readonly VersaoDoCorpus[]): { apoios: PontoApoios[]; situacao: PontoSituacao[]; resumo: ResumoDoCorpus } {
  const ord = [...versoes].sort((a, b) => (a.entityId === b.entityId ? (a.scrapedAt < b.scrapedAt ? -1 : 1) : compararIds(a.entityId, b.entityId)));
  const apoios: PontoApoios[] = [];
  const situacao: PontoSituacao[] = [];
  let restauracaoA3 = 0;
  let id = "";
  let ultApoios: number | null | undefined;
  let ultStatus: string | null | undefined;
  for (const v of ord) {
    if (v.scrapedAt === INSTANTE_RESTAURACAO_A3) {
      restauracaoA3++;
      continue;
    }
    if (v.entityId !== id) {
      id = v.entityId;
      ultApoios = undefined;
      ultStatus = undefined;
    }
    const base = { entityId: v.entityId, origem: "corpus", desde: v.scrapedAt, ate: v.scrapedAt, leituras: 1, sha: null };
    if (v.apoios !== ultApoios) apoios.push({ ...base, apoios: v.apoios });
    if (v.status !== ultStatus) situacao.push({ ...base, situacaoCodigo: null, situacaoNome: null, status: v.status });
    ultApoios = v.apoios;
    ultStatus = v.status;
  }
  return { apoios, situacao, resumo: { versoes: versoes.length, restauracaoA3 } };
}

function compararIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** Ordem de saída: id, instante, origem. */
export function ordenar<T extends { entityId: string; desde: string; origem: string }>(xs: T[]): T[] {
  return xs.sort((a, b) => compararIds(a.entityId, b.entityId) || (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0) || (a.origem < b.origem ? -1 : a.origem > b.origem ? 1 : 0));
}
