/**
 * e-Cidadania full-corpus ingestion job (§8 step 5) — runs OFF-Worker (scheduled GitHub Action).
 *
 * Pipeline:
 *   1. Crawl pesquisamateria?p=1..N (HTML listing — the only full-coverage source). Track
 *      crawl-completeness: every page 1..lastPage must parse with ZERO unrecovered failures.
 *   2. Derive status from /processo (tramitando=S) — aberta ⟺ matter in tramitação (§4); not scraped.
 *   3. Normalize each consultation to the canonical ConsultaResumo (shared buildConsultaResumo) and
 *      hash it with the shared contentHash, so the off-Worker writer and the in-Worker Cron agree.
 *   4. Decide whether to write (two guards):
 *        - PRIMARY: crawl-completeness. An incomplete crawl (or an incomplete /processo status
 *          universe) writes ONLY an 'erro' run row — never a shrunken corpus.
 *        - CATASTROPHIC FLOOR: even a complete crawl is rejected (classifyRun at ECIDADANIA_CORPUS_MIN_PCT,
 *          default 80%) if it returns far fewer rows than the last good corpus — guards against a
 *          degraded page fooling findLastPage. Override a genuine large shrink with --force / INGEST_FORCE=1.
 *   5. Emit out.sql (upsert + append-on-change history + run row, mirroring SQL.upsert/SQL.history),
 *      applied by the Action via `wrangler d1 execute senado-ecidadania --remote --file=out.sql`.
 *
 * Exit code: 0 when the run is 'ok', 1 otherwise (the Action still applies out.sql via if: always(),
 * so the 'erro'/'anomalo' run row is recorded even though the job is marked failed for visibility).
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sleep } from "./http.js";
import { fetchParsedPage, firstContactOpts, logPageFailure } from "./page-retry.js";
import { parseConsultaListingPage, findLastPage, type ListingItem } from "./listing.js";
import { buildTramitandoSet, deriveStatus } from "./status.js";
import { ECIDADANIA_BASE, type ConsultaDetalheCorpus } from "../../src/scraper/ecidadania.js";
import { planEntitySync, type SyncRecord } from "../../src/scraper/pipeline.js";
import { classifyRun, parseAnomalyMinPct } from "../../src/scraper/anomaly.js";
import { readExistingMeta, readAllPayloads, readLastGoodRows, applyD1File } from "./d1.js";
import { selectRestatus, selectNaoListadasSemDetalhe, buildRestatusRecords } from "./restatus.js";
import { generateLoadSql, generateRunOnlySql } from "./sql.js";
import { fetchConsultaDetalheCorpus, consultaPrecisaDetalhe as needsEnrich } from "./detalhe.js";
import { criarDisjuntor } from "./breaker.js";
import { vigiarCampos, descreverVigia } from "../../src/scraper/mesclar.js";
import { registroConsultaListada, syncRecordDeConsulta, loteParcial } from "./consultas-registro.js";
import { descreverAndamento } from "./andamento.js";

const SENADO_BASE_URL = process.env.SENADO_BASE_URL || "https://legis.senado.leg.br/dadosabertos";
const PAGE_DELAY_MS = Number(process.env.INGEST_PAGE_DELAY_MS) || 400;
const DETAIL_DELAY_MS = Number(process.env.INGEST_CONSULTAS_DETAIL_DELAY_MS) || 250;
/** Máximo de consultas a enriquecer (fetch de detalhe) por execução; o resto fica p/ o próximo run. */
const DETAIL_CHUNK = Number(process.env.INGEST_CONSULTAS_CHUNK) || 3000;
/** Detalhes por lote gravado durante o run (~12 min no ritmo medido em 18/10/2026, 2,9 s/consulta). */
const LOTE_DETALHE = Number(process.env.INGEST_CONSULTAS_LOTE) || 250;
const MAX_PAGES = 1000; // safety cap against a runaway pagination value
const OUT_PATH = join(dirname(fileURLToPath(import.meta.url)), "out.sql");

// Um disjuntor por RUN: falha de transporte seguida, em qualquer dos dois laços
// (páginas e detalhe), é o mesmo sintoma — o portal parou de responder.
const disjuntor = criarDisjuntor();

interface CrawlResult {
  items: ListingItem[];
  lastPage: number;
  failedPages: number[];
  complete: boolean;
}

/** Crawl every listing page, deduping by codigoMateria; complete ⟺ no page failed. */
async function crawlAllPages(): Promise<CrawlResult> {
  const byId = new Map<number, ListingItem>();
  const failedPages: number[] = [];

  // p1 failure stays fatal (propagates to main), so it gets the patient first-contact budget.
  const first = await fetchParsedPage(`${ECIDADANIA_BASE}/pesquisamateria?p=1`, parseConsultaListingPage, {
    allowEmpty: true,
    ...firstContactOpts(),
  });
  let lastPage = Math.min(findLastPage(first.html), MAX_PAGES);
  for (const it of first.items) byId.set(it.codigoMateria, it);

  for (let p = 2; p <= lastPage; p++) {
    try {
      const { items: parsed } = await fetchParsedPage(
        `${ECIDADANIA_BASE}/pesquisamateria?p=${p}`,
        parseConsultaListingPage,
      );
      for (const it of parsed) byId.set(it.codigoMateria, it);
      disjuntor.sucesso();
    } catch (e) {
      logPageFailure("consultas", `p${p}`, e);
      failedPages.push(p);
      disjuntor.falha(e, `p${p}`);
    }
    await sleep(PAGE_DELAY_MS);
  }

  return { items: [...byId.values()], lastPage, failedPages, complete: failedPages.length === 0 };
}

/** Distinct siglas present in the corpus (leading token of "PL 5064/2023"). */
function siglasFrom(items: ListingItem[]): string[] {
  const set = new Set<string>();
  for (const it of items) {
    const m = it.identificacao?.match(/^([A-Za-zÀ-ÿ]+)/);
    if (m) set.add(m[1].toUpperCase());
  }
  return [...set];
}

async function main(): Promise<void> {
  const now = new Date().toISOString();
  const force = process.env.INGEST_FORCE === "1" || process.argv.includes("--force");
  const corpusMinPct = parseAnomalyMinPct(process.env.ECIDADANIA_CORPUS_MIN_PCT, 80);

  // 1. Crawl.
  const crawl = await crawlAllPages();
  console.log(`[crawl] lastPage=${crawl.lastPage} items=${crawl.items.length} failedPages=${crawl.failedPages.length}`);

  if (!crawl.complete) {
    const err = `crawl incompleto: ${crawl.failedPages.length} pagina(s) falharam: ${crawl.failedPages.slice(0, 20).join(",")}`;
    console.error(`[gate] ${err} — corpus NÃO será sobrescrito`);
    writeFileSync(OUT_PATH, generateRunOnlySql(now, "erro", crawl.items.length, err));
    process.exit(1);
  }

  // 2. Status from /processo (tramitando=S). An incomplete status universe is a failed run.
  const siglas = siglasFrom(crawl.items);
  let tramitando: Set<number>;
  try {
    tramitando = await buildTramitandoSet(SENADO_BASE_URL, siglas);
  } catch (e) {
    const err = `status universe incompleto: ${e instanceof Error ? e.message : String(e)}`;
    console.error(`[gate] ${err} — corpus NÃO será sobrescrito`);
    writeFileSync(OUT_PATH, generateRunOnlySql(now, "erro", crawl.items.length, err));
    process.exit(1);
  }

  // 3. Normalize + hash (canonical ConsultaResumo via shared builder; metrica_principal = totalVotos).
  //    v2: enrich with detail-only autoria/relator, preserving rows whose autoria has a value (immutable).
  const existingPayloads = readAllPayloads("consultas");

  // Vigia da listagem: dos campos que o corpus já tinha, quantos a leitura de hoje ainda trouxe.
  // Queda brusca = o leitor deixou de reconhecer a página (o caso das ideias em 12/10/2026).
  const vigia = vigiarCampos(
    crawl.items.map((it) => {
      const prev = existingPayloads.get(it.codigoMateria);
      return {
        lido: { materia: it.identificacao, ementa: it.ementa, votosSim: it.votosSim, votosNao: it.votosNao },
        guardado: prev ? (JSON.parse(prev) as Record<string, unknown>) : undefined,
      };
    }),
    ["materia", "ementa", "votosSim", "votosNao"],
  );
  console.log(`[consultas][vigia] ${descreverVigia(vigia)}`);
  if (!vigia.ok) {
    const err = `taxa de leitura da listagem despencou: ${descreverVigia({ ...vigia, campos: vigia.quedas })}`;
    console.error(`[gate] verdict=anomalo — ${err} — corpus NÃO será sobrescrito`);
    writeFileSync(OUT_PATH, generateRunOnlySql(now, "anomalo", crawl.items.length, err));
    process.exit(1);
  }
  // 4. Catastrophic floor (after the completeness gate). force → only the rows>0 check applies. Antes
  // do detalhe desde 18/10/2026: os lotes parciais gravam DURANTE a leitura, então toda trava tem de
  // ter passado antes da primeira gravação. O piso só depende do tamanho da listagem.
  const lastGoodRows = readLastGoodRows();
  const verdict = classifyRun(
    { rowsScraped: crawl.items.length, lastGoodRows: force ? null : lastGoodRows, error: undefined },
    corpusMinPct,
  );
  if (verdict !== "ok") {
    const err = `catastrophic floor: ${crawl.items.length} linhas vs último bom ${lastGoodRows} (< ${corpusMinPct}%); use --force se a redução for legítima`;
    console.error(`[gate] verdict=${verdict} — ${err} — corpus NÃO será sobrescrito`);
    writeFileSync(OUT_PATH, generateRunOnlySql(now, verdict, crawl.items.length, err));
    process.exit(1);
  }

  // 5. Detalhe (autoria/relator), gravado em LOTES durante o run: uma falha no meio não perde o que
  // já foi lido, e o run seguinte, que relê o D1, não busca de novo. Fila = as da listagem sem autoria,
  // depois as guardadas FORA da listagem sem autoria (encerradas: a listagem nunca mais as traz),
  // dentro do teto do run.
  const existingMeta = readExistingMeta();
  const existingHashes = new Map(existingMeta.map((r) => [r.id, r.content_hash]));
  const crawledIds = new Set(crawl.items.map((it) => it.codigoMateria));
  const itemPorId = new Map(crawl.items.map((it) => [it.codigoMateria, it]));
  const statusDe = (id: number) => deriveStatus(tramitando, id);
  const listadasSemAutoria = crawl.items.filter((it) => needsEnrich(existingPayloads.get(it.codigoMateria))).map((it) => it.codigoMateria);
  const naoListadas = selectNaoListadasSemDetalhe(existingPayloads, crawledIds);
  const fila = [...listadasSemAutoria, ...naoListadas].slice(0, DETAIL_CHUNK);
  console.log(
    `[consultas][enrich] sem autoria: ${listadasSemAutoria.length} na listagem + ${naoListadas.length} fora dela; ` +
      `${fila.length} neste run (teto ${DETAIL_CHUNK}), gravadas em lotes de ${LOTE_DETALHE}`,
  );

  // A troca de situação (§2, passo 7) é decidida ANTES: a encerrada que muda de situação e ganha autoria
  // no mesmo run vira UM registro já no lote, e não duas versões no histórico com as datas invertidas.
  const flips = selectRestatus(existingMeta, crawledIds, tramitando);
  const flipDe = new Map(flips.map((f) => [f.id, f]));
  const detalhes = new Map<number, ConsultaDetalheCorpus>();
  const registroDe = (id: number): SyncRecord | undefined => {
    const it = itemPorId.get(id);
    if (it) return syncRecordDeConsulta(registroConsultaListada(it, statusDe(id), existingPayloads.get(id), detalhes.get(id)));
    const d = detalhes.get(id);
    const flip = flipDe.get(id);
    return d ? buildRestatusRecords(flip ? [flip] : [], existingPayloads, new Map([[id, d]]))[0] : undefined;
  };
  const inicio = Date.now();
  let lote: number[] = [];
  let lotes = 0;
  let gravadas = 0;
  const gravarLote = () => {
    const recs = lote.map(registroDe).filter((r): r is SyncRecord => r !== undefined);
    lote = [];
    if (recs.length === 0) return;
    const { arquivos, alteradas } = loteParcial(recs, existingHashes, existingPayloads, new Date().toISOString());
    for (const sql of arquivos) {
      const path = join(dirname(OUT_PATH), `out-consultas-lote-${String(++lotes).padStart(3, "0")}.sql`);
      writeFileSync(path, sql);
      applyD1File(path);
    }
    gravadas += alteradas;
  };
  for (let i = 0; i < fila.length; i++) {
    const id = fila[i];
    try {
      detalhes.set(id, await fetchConsultaDetalheCorpus(id));
      disjuntor.sucesso();
    } catch (e) {
      console.error(`[consultas][detalhe][gap] id=${id}: ${e instanceof Error ? e.message : String(e)}`);
      try {
        disjuntor.falha(e, `id=${id}`);
      } catch (parada) {
        gravarLote(); // o portal parou: grava o que este lote já leu antes de desistir
        throw parada;
      }
    }
    lote.push(id);
    await sleep(DETAIL_DELAY_MS);
    if (lote.length >= LOTE_DETALHE || i === fila.length - 1) {
      gravarLote();
      console.log(
        `[consultas][andamento] ${descreverAndamento({ rotulo: "detalhe lido", feitos: i + 1, total: fila.length, inicioMs: inicio, agoraMs: Date.now(), gravados: gravadas })}`,
      );
    }
  }
  const lidas = [...detalhes.values()].filter((d) => d.autoria).length;
  console.log(`[consultas][enrich] detalhe lido p/ ${detalhes.size} de ${fila.length} (${lidas} com autoria); ${gravadas} gravadas nos lotes`);

  // 6. Registros da listagem (a mesma montagem dos lotes: o que eles gravaram volta com o mesmo hash
  // e não gera segunda versão no histórico).
  const records = crawl.items.map((it) =>
    syncRecordDeConsulta(registroConsultaListada(it, statusDe(it.codigoMateria), existingPayloads.get(it.codigoMateria), detalhes.get(it.codigoMateria))),
  );
  const abertas = records.filter((r) => r.status === "aberta").length;
  const encerradas = records.length - abertas;
  const has164804 = records.some((r) => r.entityId === 164804);
  console.log(`[normalize] total=${records.length} abertas=${abertas} encerradas=${encerradas} tramitando=${tramitando.size} id164804=${has164804}`);

  // 7. Linger re-status (§2): for stored rows NOT in this crawl, flip status by /processo membership
  // (a matter that left tramitação → encerrada; never flip on mere listing-absence). The crawled rows
  // were already restated above (their status came from deriveStatus). Only runs on a complete crawl,
  // which is guaranteed here (the completeness gate already passed). `existingPayloads` já traz o que
  // os lotes gravaram (inclusive a troca de situação das que tiveram detalhe), então essas voltam com o
  // mesmo hash e não geram versão nova.
  const detalhesNaoListadas = new Map([...detalhes].filter(([id]) => !crawledIds.has(id)));
  const restatusRecords = buildRestatusRecords(flips, existingPayloads, detalhesNaoListadas);
  const flippedEncerrada = flips.filter((f) => f.newStatus === "encerrada").length;
  console.log(`[restatus] ${flips.length} linhas re-statusadas (${flippedEncerrada} → encerrada); ${restatusRecords.length} upserts fora da listagem`);

  // 8. Diff history vs the CURRENT hashes (os lotes já atualizaram) and emit the load SQL. The run row's
  // rows_scraped stays the CRAWLED count (the floor baseline); re-statused rows are extra upserts.
  const allRecords = [...records, ...restatusRecords];
  const { annotated, rowsChanged } = planEntitySync(allRecords, existingHashes);
  writeFileSync(OUT_PATH, generateLoadSql(annotated, now, records.length, rowsChanged));
  console.log(`[load] wrote ${OUT_PATH}: ${allRecords.length} upserts (${records.length} crawled + ${restatusRecords.length} re-status), ${rowsChanged} changed (history) + ${gravadas} nos lotes, 1 ok run row`);
  process.exit(0);
}

main().catch((e) => {
  // Last-resort guard: record the failure so the Action's apply step can persist a run row.
  const err = e instanceof Error ? e.message : String(e);
  console.error(`[fatal] ${err}`);
  try {
    writeFileSync(OUT_PATH, generateRunOnlySql(new Date().toISOString(), "erro", 0, `fatal: ${err}`));
  } catch {
    /* nothing more we can do */
  }
  process.exit(1);
});
