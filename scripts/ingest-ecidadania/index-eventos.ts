/**
 * e-Cidadania EVENTOS full-corpus ingestion job — runs OFF-Worker (scheduled GitHub Action).
 *
 * v2 (ROADMAP ETAPA 5.5): passou de só-listagem para listagem + DETALHE + AJAX de comentários.
 *   1. Crawl the `principalaudiencia?p=N` HTML listing (ids + provisional listing fields + status).
 *      Guards unchanged: crawl-completeness + catastrophic floor (classifyRun) on the LISTING count.
 *   2. ENRICH a BOUNDED SLICE of events per run (RESUMÍVEL por cursor — o detalhe+AJAX de todos os
 *      ~5,4k eventos não cabe no orçamento de um job): fetch the detail page (canonical data/hora +
 *      comissaoNomeCompleto/local/descricao/pauta/convidados/videoUrl) and the AJAX comment fragment
 *      (canonical comment count + the nível-comentário rows) só para a fatia [cursor .. cursor+CHUNK].
 *      Os demais eventos PRESERVAM o detalhe já gravado (só os campos de listagem — titulo/comissao/
 *      status — são atualizados). O cursor dá a volta ao fim, então TODOS os eventos são re-visitados
 *      em rodízio a cada poucos ciclos (o "re-crawl de todos por ciclo" vira "todos por rodízio",
 *      necessário para caber no tempo).
 *   3. A fatia é lida em ordem de id e gravada em LOTES de `LOTE` eventos DURANTE o run (desde
 *      23/10/2026, extensão do PR #143 das consultas): cada lote sai em `out-eventos-lote-NNN.sql`
 *      (comentários do lote primeiro, depois os eventos com o upsert do cursor na cauda), aplicado na
 *      hora pelo `apply-d1.sh` — uma falha no meio não perde o que já foi lido, e o run seguinte
 *      retoma do último lote gravado. O vigia mede CADA lote antes de gravá-lo (ver lotes.ts). Uma
 *      linha `[eventos][andamento]` por lote, visível ao vivo na página do job.
 *   4. No fim, `out-eventos.sql` (todo o corpus: os da fatia voltam com o mesmo hash, sem segunda
 *      versão no histórico; os demais só com os campos de listagem) + run row 'ok' + cursor.
 *
 * Detail/comment fetch failures are best-effort: the event falls back to its listing fields (detail)
 * or the listing comment count (AJAX), and the gap is LOGGED (never silenced). The listing guards
 * still decide whether the corpus is written at all. PRIVACIDADE: comentários guardam só UF (sem nome).
 */

import { writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sleep } from "./http.js";
import { fetchParsedPage, firstContactOpts, logPageFailure } from "./page-retry.js";
import { criarDisjuntor } from "./breaker.js";
import { parseEventoListingPage, findLastPageEventos, type EventoListingItem } from "./eventos-listing.js";
import { ECIDADANIA_BASE, buildEventoResumo, buildEventoResumoEnriquecido, type EventoResumo } from "../../src/scraper/ecidadania.js";
import { contentHash, planEntitySync, type SyncRecord } from "../../src/scraper/pipeline.js";
import { classifyRun, parseAnomalyMinPct } from "../../src/scraper/anomaly.js";
import { readExistingMeta, readLastGoodRows, readComentarioHashes, readAllPayloads, readDetalheCursor, gravarEAplicarLote } from "./d1.js";
import { generateLoadSql, generateRunOnlySql, generateComentariosSqlBatches, cursorUpsertStmt, type ComentarioRecord } from "./sql.js";
import { fetchEventoDetalhe, fetchComentariosAudiencia, toComentarioRecord, planComentariosSync } from "./detalhe.js";
import { mesclarCampo, vigiarCampos, descreverVigia } from "../../src/scraper/mesclar.js";
import { fecharLote, LoteReprovadoError, LOTE_PADRAO, type Leitura } from "./lotes.js";
import { descreverAndamento } from "./andamento.js";

/** Campos do detalhe que o vigia confere a cada lote. */
const CAMPOS_DETALHE_EVENTO = ["data", "hora", "comissaoNomeCompleto", "local", "descricao", "videoUrl"] as const;

const ENTIDADE = "eventos";
const PAGE_DELAY_MS = Number(process.env.INGEST_EVENTOS_PAGE_DELAY_MS) || Number(process.env.INGEST_PAGE_DELAY_MS) || 400;
const DETAIL_DELAY_MS = Number(process.env.INGEST_EVENTOS_DETAIL_DELAY_MS) || 250;
/** Quantos eventos enriquecer (detalhe+AJAX) por execução — o resto preserva o detalhe já gravado. */
const CHUNK = Number(process.env.INGEST_EVENTOS_CHUNK) || 1500;
/** Eventos por lote gravado durante o run. */
const LOTE = Number(process.env.INGEST_EVENTOS_LOTE) || LOTE_PADRAO;
const MAX_PAGES = 500;

// Um disjuntor por RUN: falha de transporte seguida, em qualquer dos laços, é o
// mesmo sintoma — o portal parou de responder. Ver breaker.ts.
const disjuntor = criarDisjuntor();

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(OUT_DIR, "out-eventos.sql");
/** Lotes aplicados durante o run. O passo final do workflow só aplica out-eventos.sql (e os comentários
 *  avulsos `out-eventos-comentarios-*`, que desde 23/10/2026 não são mais emitidos: vão nos lotes). */
const LOTE_PREFIX = "out-eventos-lote-";
const COMENT_PREFIX = "out-eventos-comentarios-";

interface CrawlResult {
  items: EventoListingItem[];
  lastPage: number;
  failedPages: number[];
  complete: boolean;
}

async function crawlAllPages(now: Date): Promise<CrawlResult> {
  const byId = new Map<number, EventoListingItem>();
  const failedPages: number[] = [];

  // p1 failure stays fatal (propagates to main), but now gets the page-level retry too.
  const parsePage = (html: string) => parseEventoListingPage(html, now);
  const first = await fetchParsedPage(`${ECIDADANIA_BASE}/principalaudiencia?p=1`, parsePage, {
    allowEmpty: true,
    ...firstContactOpts(),
  });
  const lastPage = Math.min(findLastPageEventos(first.html), MAX_PAGES);
  for (const it of first.items) byId.set(it.id, it);

  for (let p = 2; p <= lastPage; p++) {
    try {
      const { items: parsed } = await fetchParsedPage(`${ECIDADANIA_BASE}/principalaudiencia?p=${p}`, parsePage);
      for (const it of parsed) byId.set(it.id, it);
      disjuntor.sucesso();
    } catch (e) {
      logPageFailure(ENTIDADE, `p${p}`, e);
      failedPages.push(p);
      disjuntor.falha(e, `p${p}`);
    }
    await sleep(PAGE_DELAY_MS);
  }

  return { items: [...byId.values()], lastPage, failedPages, complete: failedPages.length === 0 };
}

/** Remove any out-eventos-lote-*.sql / out-eventos-comentarios-*.sql from a prior run so a smaller run never re-applies stale files. */
function cleanOldBatches(): void {
  for (const f of readdirSync(OUT_DIR)) {
    if ((f.startsWith(LOTE_PREFIX) || f.startsWith(COMENT_PREFIX)) && f.endsWith(".sql")) unlinkSync(join(OUT_DIR, f));
  }
}

interface EnrichResult {
  eventoRecords: SyncRecord[];
  detailFails: number;
  commentFails: number;
  enrichedCount: number;
  /** Comentários coletados na fatia (todos; os novos/alterados já foram gravados nos lotes). */
  comentariosColetados: number;
  /** Linhas alteradas gravadas nos lotes (eventos) e comentários novos/alterados gravados. */
  gravadas: number;
  comentariosGravados: number;
  /** Lotes aplicados e o cursor na cauda do último. */
  lotes: number;
  cursorGravado: number;
  /** Detalhe lido × payload guardado, por evento da fatia já enriquecido antes — acumulado do run. */
  leituras: Leitura[];
}

/** SyncRecord de um evento a partir do EventoResumo montado. */
function toSyncRecord(ev: EventoResumo): SyncRecord {
  const payloadJson = JSON.stringify(ev);
  return {
    entityId: ev.id,
    sourceUrl: ev.url,
    payloadJson,
    status: ev.status,
    metrica: ev.comentarios,
    comissao: ev.comissao,
    contentHash: contentHash(payloadJson),
  };
}

/**
 * Preserve an event NOT in this run's slice: keep the detail already stored (data/hora canônicas +
 * campos v2 + contagem de comentários) e só atualiza os campos que a LISTAGEM manda (titulo/comissao/
 * status). Se o evento nunca foi enriquecido (sem payload anterior), cai no fallback da listagem.
 */
function preserveEvento(it: EventoListingItem, prevJson: string | undefined): EventoResumo {
  const prev = prevJson ? (JSON.parse(prevJson) as Partial<EventoResumo>) : undefined;
  return buildEventoResumo({
    id: it.id,
    titulo: it.titulo,
    comissao: it.comissao,
    status: it.status,
    data: mesclarCampo(prev?.data, it.data),
    hora: mesclarCampo(prev?.hora, it.hora),
    comissaoNomeCompleto: prev?.comissaoNomeCompleto ?? null,
    local: prev?.local ?? null,
    descricao: prev?.descricao ?? null,
    pauta: prev?.pauta ?? [],
    convidados: prev?.convidados ?? [],
    videoUrl: prev?.videoUrl ?? null,
    comentarios: prev?.comentarios ?? it.comentarios ?? 0,
  });
}

/** Um lote em formação: eventos enriquecidos, seus comentários, as leituras cruas e o último id. */
interface LoteEmFormacao {
  records: SyncRecord[];
  comentarios: ComentarioRecord[];
  leituras: Leitura[];
  ultimoId: number;
}

function novoLote(): LoteEmFormacao {
  return { records: [], comentarios: [], leituras: [], ultimoId: 0 };
}

/**
 * Build ALL corpus rows: fetch detail+AJAX for `slice` (ordenada por id, enriched, gravada em lotes
 * durante a leitura), preserve the rest. `existingHashes`/`existingComentHashes` são atualizados no
 * lugar pelos lotes, para a gravação final comparar contra o que já foi gravado.
 */
async function enrichSlice(
  items: EventoListingItem[],
  slice: EventoListingItem[],
  existingPayloads: Map<number, string>,
  existingHashes: Map<number, string>,
  existingComentHashes: Map<string, string>,
  cursor: { afterId: number; fullPasses: number; now: string },
): Promise<EnrichResult> {
  const sliceIds = new Set(slice.map((it) => it.id));
  const eventoRecords: SyncRecord[] = [];
  let detailFails = 0;
  let commentFails = 0;
  let enrichedCount = 0;
  let comentariosColetados = 0;
  let gravadas = 0;
  let comentariosGravados = 0;
  let cursorGravado = cursor.afterId;
  const seq = { n: 0 };
  const inicio = Date.now();
  const leituras: Leitura[] = [];
  let lote = novoLote();

  // Fecha e aplica o lote corrente: vigia sobre as leituras do lote; comentários do lote primeiro,
  // depois os eventos com o cursor na cauda — o cursor só avança quando tudo do lote aplicou.
  const gravarLote = (): void => {
    if (lote.records.length === 0) return;
    const fechado = fecharLote({
      leituras: lote.leituras,
      campos: CAMPOS_DETALHE_EVENTO,
      records: lote.records,
      hashes: existingHashes,
      now: new Date().toISOString(),
      entidade: ENTIDADE,
      tailStmt: cursorUpsertStmt(ENTIDADE, lote.ultimoId, cursor.fullPasses, cursor.now),
    });
    console.log(`[eventos][vigia] lote ${seq.n + 1}: ${descreverVigia(fechado.vigia)}`);
    if (!fechado.vigia.ok) throw new LoteReprovadoError(fechado.vigia, seq.n + 1, cursorGravado);
    const { annotated, rowsChanged } = planComentariosSync(lote.comentarios, existingComentHashes);
    const comentFiles = generateComentariosSqlBatches(annotated, new Date().toISOString());
    for (const c of lote.comentarios) existingComentHashes.set(`${c.eventoId}:${c.comentarioId}`, c.contentHash);
    gravarEAplicarLote(OUT_DIR, LOTE_PREFIX, [...comentFiles, ...fechado.arquivos], seq);
    gravadas += fechado.alteradas;
    comentariosGravados += rowsChanged;
    cursorGravado = lote.ultimoId;
    lote = novoLote();
    console.log(
      `[eventos][andamento] ${descreverAndamento({ rotulo: "detalhe lido", feitos: enrichedCount, total: slice.length, inicioMs: inicio, agoraMs: Date.now(), gravados: gravadas })} · ${comentariosGravados} comentários gravados · cursor ${cursorGravado}`,
    );
  };
  // O portal parou (disjuntor): grava o que este lote já leu antes de desistir.
  const falhaOuParada = (e: unknown, onde: string): void => {
    try {
      disjuntor.falha(e, onde);
    } catch (parada) {
      gravarLote();
      throw parada;
    }
  };

  for (let i = 0; i < slice.length; i++) {
    const it = slice[i];
    const prevJson = existingPayloads.get(it.id);
    const prevEv = prevJson ? (JSON.parse(prevJson) as Partial<EventoResumo>) : undefined;
    let detalhe = null;
    try {
      detalhe = await fetchEventoDetalhe(it.id);
      if (prevEv) {
        const leitura = { lido: { ...detalhe }, guardado: prevEv as Record<string, unknown> };
        lote.leituras.push(leitura);
        leituras.push(leitura);
      }
      disjuntor.sucesso();
    } catch (e) {
      detailFails++;
      console.error(`[eventos][detalhe][gap] id=${it.id}: ${e instanceof Error ? e.message : String(e)}`);
      falhaOuParada(e, `detalhe id=${it.id}`);
    }
    await sleep(DETAIL_DELAY_MS);

    let comentariosCanon: number | null = null;
    try {
      const cs = await fetchComentariosAudiencia(it.id);
      comentariosCanon = cs.length;
      for (const c of cs) lote.comentarios.push(toComentarioRecord(it.id, c));
      comentariosColetados += cs.length;
      disjuntor.sucesso();
    } catch (e) {
      commentFails++;
      console.error(`[eventos][comentarios][gap] id=${it.id}: ${e instanceof Error ? e.message : String(e)}`);
      falhaOuParada(e, `comentarios id=${it.id}`);
    }
    await sleep(DETAIL_DELAY_MS);

    const rec = toSyncRecord(buildEventoResumoEnriquecido({
      id: it.id,
      titulo: it.titulo,
      comissao: it.comissao,
      status: it.status,
      dataListagem: it.data,
      horaListagem: it.hora,
      comentariosListagem: it.comentarios,
      detalhe,
      comentariosCanon,
      guardado: prevEv,
    }));
    eventoRecords.push(rec);
    lote.records.push(rec);
    lote.ultimoId = it.id;
    enrichedCount++;
    if (lote.records.length >= LOTE || i === slice.length - 1) gravarLote();
  }

  // Fora da fatia: preserva o detalhe já gravado, atualiza só campos de listagem.
  for (const it of items) {
    if (!sliceIds.has(it.id)) eventoRecords.push(toSyncRecord(preserveEvento(it, existingPayloads.get(it.id))));
  }

  return { eventoRecords, detailFails, commentFails, enrichedCount, comentariosColetados, gravadas, comentariosGravados, lotes: seq.n, cursorGravado, leituras };
}

async function main(): Promise<void> {
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const force = process.env.INGEST_FORCE === "1" || process.argv.includes("--force");
  const corpusMinPct = parseAnomalyMinPct(process.env.ECIDADANIA_CORPUS_MIN_PCT, 80);

  cleanOldBatches();

  const crawl = await crawlAllPages(nowDate);
  console.log(`[eventos][crawl] lastPage=${crawl.lastPage} items=${crawl.items.length} failedPages=${crawl.failedPages.length}`);

  if (!crawl.complete) {
    const err = `crawl incompleto: ${crawl.failedPages.length} pagina(s): ${crawl.failedPages.slice(0, 20).join(",")}`;
    console.error(`[eventos][gate] ${err} — corpus NÃO será sobrescrito`);
    writeFileSync(OUT_PATH, generateRunOnlySql(now, "erro", crawl.items.length, err, ENTIDADE));
    process.exit(1);
  }

  // Catastrophic floor on the LISTING count (detail/comment enrichment is best-effort, not a gate).
  // Antes do detalhe: os lotes gravam DURANTE a leitura, então toda trava da listagem tem de ter
  // passado antes da primeira gravação.
  const verdict = classifyRun(
    { rowsScraped: crawl.items.length, lastGoodRows: force ? null : readLastGoodRows(ENTIDADE), error: undefined },
    corpusMinPct,
  );
  if (verdict !== "ok") {
    const err = `catastrophic floor: ${crawl.items.length} linhas (< ${corpusMinPct}% do último bom); use --force se legítimo`;
    console.error(`[eventos][gate] verdict=${verdict} — ${err}`);
    writeFileSync(OUT_PATH, generateRunOnlySql(now, verdict, crawl.items.length, err, ENTIDADE));
    process.exit(1);
  }

  // Fatia a enriquecer neste run: eventos com id > cursor, até CHUNK; dá a volta ao chegar ao fim.
  // Lida em ORDEM DE ID: o cursor de cada lote é o maior id lido até ali, então um run interrompido
  // retoma exatamente do próximo id, sem pular nenhum.
  const cursor = readDetalheCursor(ENTIDADE);
  const sorted = [...crawl.items].sort((a, b) => a.id - b.id);
  let afterId = cursor.lastEntityId;
  let fullPasses = cursor.fullPasses;
  let slice = sorted.filter((it) => it.id > afterId).slice(0, CHUNK);
  if (slice.length === 0 && afterId > 0) {
    console.log(`[eventos] fim da passada de detalhe (cursor=${afterId}); reiniciando do começo`);
    afterId = 0;
    fullPasses += 1;
    slice = sorted.slice(0, CHUNK);
  }
  const nextCursor = slice.length ? slice[slice.length - 1].id : afterId;
  const existingPayloads = readAllPayloads(ENTIDADE);
  const existingHashes = new Map(readExistingMeta(ENTIDADE).map((r) => [r.id, r.content_hash]));
  const existingComentHashes = readComentarioHashes();
  console.log(
    `[eventos][slice] enriquecendo ${slice.length} de ${crawl.items.length} (cursor ${afterId}→${nextCursor}, passadas=${fullPasses}), gravados em lotes de ${LOTE}`,
  );

  let enriched: EnrichResult;
  try {
    enriched = await enrichSlice(crawl.items, slice, existingPayloads, existingHashes, existingComentHashes, { afterId, fullPasses, now });
  } catch (e) {
    if (!(e instanceof LoteReprovadoError)) throw e;
    // Vigia reprovou um lote: o leitor deixou de reconhecer a página. Este lote não foi gravado; os
    // anteriores ficam com o cursor na cauda. O corpus da listagem NÃO é sobrescrito neste run.
    console.error(`[eventos][gate] verdict=anomalo — ${e.message} — corpus NÃO será sobrescrito`);
    writeFileSync(OUT_PATH, generateRunOnlySql(now, "anomalo", crawl.items.length, e.message, ENTIDADE));
    process.exit(1);
  }
  const { eventoRecords, detailFails, commentFails, enrichedCount, comentariosColetados, gravadas, comentariosGravados, lotes, cursorGravado, leituras } = enriched;
  console.log(
    `[eventos][enrich] ${enrichedCount} enriquecidos, ${comentariosColetados} comentários coletados; gaps: detalhe=${detailFails} comentarios=${commentFails}; ` +
      `${gravadas} alteradas + ${comentariosGravados} comentários gravados em ${lotes} lote(s); cursor gravado ${cursorGravado}`,
  );
  // Acumulado do run, só informativo: a trava é por lote (acima). Medido 17/10/2026 no history (16 mil
  // versões desde 06/2026): perdas de 1% a 4% por campo, nunca em massa.
  console.log(`[eventos][vigia] acumulado do run: ${descreverVigia(vigiarCampos(leituras, CAMPOS_DETALHE_EVENTO))}`);

  // Corpus load (rows_scraped = crawled listing count, the floor baseline) + cursor no fim. Os eventos
  // da fatia voltam com o hash que os lotes já gravaram (sem segunda versão no histórico).
  const { annotated, rowsChanged } = planEntitySync(eventoRecords, existingHashes);
  const loadSql = generateLoadSql(annotated, now, crawl.items.length, rowsChanged, ENTIDADE);
  writeFileSync(OUT_PATH, loadSql + cursorUpsertStmt(ENTIDADE, nextCursor, fullPasses, now) + "\n");
  console.log(`[eventos][load] wrote ${OUT_PATH}: ${eventoRecords.length} upserts, ${rowsChanged} changed (+ ${gravadas} nos lotes), cursor→${nextCursor}, 1 ok run row`);
  process.exit(0);
}

main().catch((e) => {
  const err = e instanceof Error ? e.message : String(e);
  console.error(`[eventos][fatal] ${err}`);
  try {
    writeFileSync(OUT_PATH, generateRunOnlySql(new Date().toISOString(), "erro", 0, `fatal: ${err}`, ENTIDADE));
  } catch {
    /* nothing more we can do */
  }
  process.exit(1);
});
