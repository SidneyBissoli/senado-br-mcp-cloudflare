/**
 * Registro canônico de uma ideia para os dois jobs off-Worker que a escrevem — o crawl do corpus
 * (index-ideias.ts: vivo, transições, arquivo) e o backfill de detalhe (index-ideias-detalhe.ts).
 * Módulo puro (os jobs executam `main()` ao serem importados), para o teste da classe percorrer os
 * escritores sem rede. Todo campo passa por `mesclarCampo`: leitura vazia nunca apaga o guardado.
 */

import { STATUS_IDEIA_REMOVIDA, buildIdeiaResumo, type IdeiaResumo } from "../../src/scraper/ecidadania.js";
import { contentHash, type SyncRecord } from "../../src/scraper/pipeline.js";
import { mesclarCampo, mesclarLista } from "../../src/scraper/mesclar.js";
import { apoiosPublicados, detalheParaCorpus, statusDaLinhaDoTempo, type IdeiaDetalhe, type IdeiaDetalheParaCorpus } from "../../src/scraper/ideia-detalhe.js";

/** Os quatro campos que só a página de detalhe traz (forma histórica, ver `detalheParaCorpus`). */
export type DetalheIdeiaLido = IdeiaDetalheParaCorpus;

/**
 * Leitura de uma página de detalhe para os escritores do corpus: os quatro campos na forma histórica,
 * os apoios publicados e o status DERIVADO da linha do tempo (classificação nossa — só vale quando a
 * listagem não mostrou o id na rodada; ver `statusDaTransicao`).
 */
export function leituraDoDetalhe(d: IdeiaDetalhe): { detalhe: DetalheIdeiaLido; apoios: number | null; statusDerivado: string } {
  return { detalhe: detalheParaCorpus(d), apoios: apoiosPublicados(d), statusDerivado: statusDaLinhaDoTempo(d) };
}

/**
 * Status de uma transição: a categoria do portal (bucket da listagem em que o id apareceu NESTA rodada)
 * quando existe; senão o derivado da linha do tempo. Nunca o contrário — o derivado não sobrescreve
 * uma categoria publicada (regra do dono de 17/10/2026: classificação da fonte se guarda).
 */
export function statusDaTransicao(derivado: string, doBucket: string | undefined): { status: string; derivado: boolean } {
  return doBucket !== undefined ? { status: doBucket, derivado: false } : { status: derivado, derivado: true };
}

/** Campos que o vigia confere no backfill de detalhe. */
export const CAMPOS_DETALHE_IDEIA = ["dataPublicacao", "autorUf", "descricao", "plConvertido", "proposicoes"] as const;
/** Campos que o vigia confere nas transições (detalhe + contagem e situação da mesma página). */
export const CAMPOS_TRANSICAO_IDEIA = [...CAMPOS_DETALHE_IDEIA, "apoios", "status"] as const;
/** Campos que o vigia confere na listagem (vivo + fatia do arquivo). */
export const CAMPOS_LISTAGEM_IDEIA = ["titulo", "apoios"] as const;

function paraSync(ideia: IdeiaResumo): SyncRecord {
  const payloadJson = JSON.stringify(ideia);
  return {
    entityId: ideia.id,
    sourceUrl: ideia.url,
    payloadJson,
    status: ideia.status,
    metrica: ideia.apoios,
    comissao: null,
    contentHash: contentHash(payloadJson),
  };
}

/**
 * Crawl do corpus. A listagem (ou a página de detalhe, nas transições) é dona de titulo/apoios/status;
 * os quatro campos de detalhe vêm do backfill e só são trocados por leitura que trouxe valor.
 */
export function registroIdeia(
  id: number,
  fresh: { titulo?: string | null; apoios: number | null; status: string },
  prevJson: string | undefined,
  detalhe?: DetalheIdeiaLido,
): SyncRecord {
  const p = prevJson ? (JSON.parse(prevJson) as Partial<IdeiaResumo>) : undefined;
  return paraSync(
    buildIdeiaResumo({
      id,
      titulo: mesclarCampo(fresh.titulo, p?.titulo) ?? undefined,
      apoios: mesclarCampo(fresh.apoios, p?.apoios) ?? undefined,
      status: fresh.status,
      dataPublicacao: mesclarCampo(detalhe?.dataPublicacao, p?.dataPublicacao),
      autorUf: mesclarCampo(detalhe?.autorUf, p?.autorUf),
      descricao: mesclarCampo(detalhe?.descricao, p?.descricao),
      plConvertido: mesclarCampo(detalhe?.plConvertido, p?.plConvertido),
      proposicoes: mesclarLista(detalhe?.proposicoes, p?.proposicoes),
    }),
  );
}

/**
 * Backfill de detalhe: titulo/apoios/status do payload guardado + o detalhe lido (`null` = fetch
 * falhou). `removida` (detalhe respondeu 410) sobrepõe o status — o único que este job escreve.
 *
 * Antes de 17/10/2026 era `detail ? detail.x : prev.x`: leitura bem-sucedida com campo vazio
 * substituía o guardado, e a página redesenhada de 12/10 apagou ~21 mil UFs e datas.
 */
export function registroDetalheIdeia(payloadJson: string, id: number, detail: DetalheIdeiaLido | null, removida = false): SyncRecord {
  const prev = JSON.parse(payloadJson) as Partial<IdeiaResumo>;
  return paraSync(
    buildIdeiaResumo({
      id,
      titulo: prev.titulo,
      apoios: prev.apoios,
      status: removida ? STATUS_IDEIA_REMOVIDA : prev.status,
      dataPublicacao: mesclarCampo(detail?.dataPublicacao, prev.dataPublicacao),
      autorUf: mesclarCampo(detail?.autorUf, prev.autorUf),
      descricao: mesclarCampo(detail?.descricao, prev.descricao),
      plConvertido: mesclarCampo(detail?.plConvertido, prev.plConvertido),
      proposicoes: mesclarLista(detail?.proposicoes, prev.proposicoes),
    }),
  );
}
