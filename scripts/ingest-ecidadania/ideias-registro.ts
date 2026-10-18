/**
 * Registro canônico de uma ideia para os dois jobs off-Worker que a escrevem — o crawl do corpus
 * (index-ideias.ts: vivo, transições, arquivo) e o backfill de detalhe (index-ideias-detalhe.ts).
 * Módulo puro (os jobs executam `main()` ao serem importados), para o teste da classe percorrer os
 * escritores sem rede. Todo campo passa por `mesclarCampo`: leitura vazia nunca apaga o guardado.
 */

import { STATUS_IDEIA_REMOVIDA, buildIdeiaResumo, type IdeiaResumo } from "../../src/scraper/ecidadania.js";
import { contentHash, type SyncRecord } from "../../src/scraper/pipeline.js";
import { mesclarCampo } from "../../src/scraper/mesclar.js";

/** Os quatro campos que só a página de detalhe traz. */
export interface DetalheIdeiaLido {
  dataPublicacao: string | null;
  autorUf: string | null;
  descricao: string | null;
  plConvertido: string | null;
}

/** Campos que o vigia confere no backfill de detalhe. */
export const CAMPOS_DETALHE_IDEIA = ["dataPublicacao", "autorUf", "descricao", "plConvertido"] as const;
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
    }),
  );
}
