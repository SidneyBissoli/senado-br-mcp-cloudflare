/**
 * Montagem PURA do registro de uma consulta da listagem e da gravação em lotes do job de consultas.
 *
 * Até 18/10/2026 o job acumulava tudo em memória e só gravava no fim: uma falha no meio (portal fora,
 * teto de tempo, erro inesperado) jogava fora todas as leituras de detalhe — um run de 3.000 leva ~2 h 20.
 * Agora o detalhe é gravado em lotes durante o run (pedido do dono). Para o lote e a gravação final não
 * divergirem, os dois montam o registro por aqui: mesma função → mesmo payload → mesmo hash, e o final
 * não gera uma segunda versão no histórico para o que o lote já gravou.
 */

import { buildConsultaResumo, type ConsultaResumo, type ConsultaDetalheCorpus } from "../../src/scraper/ecidadania.js";
import { contentHash, planEntitySync, type SyncRecord } from "../../src/scraper/pipeline.js";
import { mesclarCampo } from "../../src/scraper/mesclar.js";
import { generateDetalheLoadSqlBatches } from "./sql.js";
import type { ListingItem } from "./listing.js";

/**
 * Registro de uma consulta lida na listagem. Campo a campo, vazio lido mantém o guardado
 * (`mesclarCampo`); `detalhe` ausente = não lido neste run (autoria/relator ficam os guardados).
 * Placar ausente em consulta nova (nada guardado) segue 0, o padrão histórico do builder.
 */
export function registroConsultaListada(
  it: ListingItem,
  status: string,
  prev: string | undefined,
  detalhe?: ConsultaDetalheCorpus,
): ConsultaResumo {
  const p = prev ? (JSON.parse(prev) as Partial<ConsultaResumo>) : undefined;
  return buildConsultaResumo({
    id: it.codigoMateria,
    materia: mesclarCampo(it.identificacao, p?.materia) ?? undefined,
    ementa: mesclarCampo(it.ementa, p?.ementa) ?? undefined,
    votosSim: mesclarCampo(it.votosSim, p?.votosSim) ?? 0,
    votosNao: mesclarCampo(it.votosNao, p?.votosNao) ?? 0,
    autoria: mesclarCampo(detalhe?.autoria ?? null, p?.autoria ?? null),
    relator: mesclarCampo(detalhe?.relator ?? null, p?.relator ?? null),
    status,
  });
}

export function syncRecordDeConsulta(cr: ConsultaResumo): SyncRecord {
  const payloadJson = JSON.stringify(cr);
  return {
    entityId: cr.id,
    sourceUrl: cr.url,
    payloadJson,
    status: cr.status,
    metrica: cr.totalVotos,
    comissao: null,
    contentHash: contentHash(payloadJson),
  };
}

/**
 * SQL de um lote parcial: upsert + histórico só do que mudou contra os hashes CORRENTES, sem run row
 * (o run row continua sendo só o da gravação final, ou o de erro). Atualiza `hashes` e `payloads` no
 * lugar, para o lote seguinte e a gravação final compararem contra o que já foi gravado.
 */
export function loteParcial(
  records: SyncRecord[],
  hashes: Map<number, string>,
  payloads: Map<number, string>,
  now: string,
): { arquivos: string[]; alteradas: number } {
  const { annotated, rowsChanged } = planEntitySync(records, hashes);
  const arquivos = generateDetalheLoadSqlBatches(
    annotated,
    now,
    "consultas",
    "-- consultas: lote parcial de detalhe (sem run row)",
  );
  for (const r of records) {
    hashes.set(r.entityId, r.contentHash);
    payloads.set(r.entityId, r.payloadJson);
  }
  return { arquivos, alteradas: rowsChanged };
}
