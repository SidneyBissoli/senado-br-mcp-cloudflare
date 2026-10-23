/**
 * Fechamento de um LOTE de detalhe nos jobs resumíveis (eventos, ideias-detalhe) — a extensão, decidida
 * pelo dono em 18/10/2026 e liberada pela prova de 20/10, do que o job de consultas faz desde o PR #143.
 *
 * Até 23/10/2026 os dois jobs acumulavam o chunk inteiro em memória e só gravavam no fim: uma falha no
 * meio (portal fora, teto de tempo, erro inesperado) jogava fora tudo o que já tinha sido lido — 2.000
 * ideias são ~90 min; 600 eventos (duas idas cada) ~1 h. Agora cada lote de `LOTE_PADRAO` itens é gravado
 * assim que fecha, com o cursor na cauda do seu último arquivo: o run seguinte retoma do último lote
 * gravado, nunca do começo do chunk.
 *
 * O VIGIA passa a ser por lote (mín. 50 guardados por campo, o `N_MINIMO` de `vigiarCampos`): a
 * retenção dos campos é medida nas leituras do PRÓPRIO lote antes de gravá-lo. Lote reprovado não é
 * gravado e o run para ali — os lotes anteriores ficam, e o cursor fica no fim do último gravado. Antes,
 * o vigia rodava uma vez sobre o chunk inteiro, no fim, quando não havia mais nada a proteger de uma
 * página redesenhada no meio do run.
 *
 * Puro: sem rede, sem D1 (quem grava e aplica é `gravarEAplicarLote`, em d1.ts).
 */

import { vigiarCampos, type VereditoVigia } from "../../src/scraper/mesclar.js";
import { planEntitySync, type SyncRecord } from "../../src/scraper/pipeline.js";
import { generateDetalheLoadSqlBatches } from "./sql.js";

/** Itens por lote gravado (~12 min no ritmo medido nas consultas em 18/10/2026, 2,9 s/item). */
export const LOTE_PADRAO = 250;

/** Leitura crua de um item × o payload guardado — a entrada do vigia. */
export interface Leitura {
  lido: Record<string, unknown>;
  guardado: Record<string, unknown> | undefined;
}

export interface LoteFechado {
  vigia: VereditoVigia;
  /** Arquivos .sql do lote, com `tailStmt` no fim do último; VAZIO quando o vigia reprovou. */
  arquivos: string[];
  /** Linhas que mudaram contra os hashes correntes (ganham versão no histórico). */
  alteradas: number;
}

/**
 * Fecha um lote: vigia sobre as leituras do lote; se passou, upsert + histórico-se-mudou das linhas
 * contra `hashes` (atualizado no lugar, para o lote seguinte e a gravação final compararem contra o que
 * já foi gravado) e `tailStmt` (o cursor) na cauda do último arquivo — o cursor só avança depois que
 * todas as linhas do lote aplicaram. Sem run row (regra de `generateDetalheLoadSqlBatches`).
 */
export function fecharLote(opts: {
  leituras: Iterable<Leitura>;
  campos: readonly string[];
  records: SyncRecord[];
  hashes: Map<number, string>;
  now: string;
  entidade: string;
  tailStmt: string;
  maxStmtsPerFile?: number;
}): LoteFechado {
  const vigia = vigiarCampos(opts.leituras, opts.campos);
  if (!vigia.ok) return { vigia, arquivos: [], alteradas: 0 };
  const { annotated, rowsChanged } = planEntitySync(opts.records, opts.hashes);
  const arquivos = generateDetalheLoadSqlBatches(annotated, opts.now, opts.entidade, opts.tailStmt, opts.maxStmtsPerFile);
  for (const r of opts.records) opts.hashes.set(r.entityId, r.contentHash);
  return { vigia, arquivos, alteradas: rowsChanged };
}

/** Lote reprovado pelo vigia: o job grava a run row `anomalo` e para; os lotes anteriores ficam. */
export class LoteReprovadoError extends Error {
  constructor(
    readonly vigia: VereditoVigia,
    readonly lote: number,
    readonly cursorGravado: number,
  ) {
    super(
      `taxa de leitura despencou no lote ${lote}: ` +
        vigia.quedas.map((c) => `${c.campo} ${c.lidos}/${c.guardados} (${(c.retencao * 100).toFixed(1)}%)`).join(" · ") +
        ` — lote NÃO gravado; os anteriores ficam e o cursor para em ${cursorGravado}`,
    );
    this.name = "LoteReprovadoError";
  }
}
