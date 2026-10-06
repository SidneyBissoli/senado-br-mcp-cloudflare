/**
 * e-Cidadania IDEIAS corpus ingestion job — runs OFF-Worker (scheduled GitHub Action, daily).
 *
 * The listing carries NO status, so each `situacao` bucket is crawled with its GET filter and every
 * item is tagged with the status that bucket maps to (SITUACAO_STATUS in ideias-listing.ts). The load
 * is emitted as MULTIPLE out-ideias-NNN.sql files (generateLoadSqlBatches) applied in lexical order.
 *
 * INCREMENTAL since 06/10/2026 (rationale and measurements in ideias-incremental.ts). One run =
 *   1. LIVE crawl — situacoes 5, 6, 8, 9, 10, every page. Completeness gate + floor apply to these.
 *   2. TRANSITIONS — ideas `aberta` in D1 that no live list showed today: read their detail page
 *      (final apoios + situação). Failures are skipped; the same condition re-selects them tomorrow.
 *   3. ARCHIVE — a slice of situacao 7 by persisted page cursor, upsert-only reconciliation.
 * Phases 2 and 3 never block phase 1: if the portal goes down mid-run, what the live crawl read is
 * still written. Nothing is ever deleted; an idea not read today keeps its stored row.
 */

import { writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sleep } from "./http.js";
import { fetchParsedPage, firstContactOpts, logPageFailure, type ParsedPage } from "./page-retry.js";
import { criarDisjuntor, PortalForaError } from "./breaker.js";
import {
  parseIdeiaListingPage,
  findLastPageIdeias,
  SITUACAO_STATUS,
  type IdeiaListingItem,
} from "./ideias-listing.js";
import {
  SITUACOES_VIVAS,
  SITUACAO_ARQUIVO,
  CURSOR_ARQUIVO,
  pisoVivoOk,
  selecionarTransicoes,
  inicioFatiaArquivo,
  avancarCursorArquivo,
} from "./ideias-incremental.js";
import { ECIDADANIA_BASE, buildIdeiaResumo, type IdeiaResumo } from "../../src/scraper/ecidadania.js";
import { contentHash, planEntitySync, type SyncRecord } from "../../src/scraper/pipeline.js";
import { parseAnomalyMinPct } from "../../src/scraper/anomaly.js";
import { readExistingMeta, readAllPayloads, readDetalheCursor } from "./d1.js";
import { generateLoadSqlBatches, generateRunOnlySql, cursorUpsertStmt } from "./sql.js";
import { fetchIdeiaDetalheCorpus } from "./detalhe.js";

const ENTIDADE = "ideias";
const PAGE_DELAY_MS = Number(process.env.INGEST_IDEIAS_PAGE_DELAY_MS) || Number(process.env.INGEST_PAGE_DELAY_MS) || 400;
const DETAIL_DELAY_MS = Number(process.env.INGEST_IDEIAS_DETAIL_DELAY_MS) || 250;
const MAX_PAGES_PER_SITUACAO = 5000;
const BATCH_SIZE = Number(process.env.INGEST_IDEIAS_BATCH_SIZE) || 10000;
/** Teto de leituras de detalhe por run; o excedente fica para amanhã (mesma condição o reseleciona). */
const TRANSICOES_MAX = Number(process.env.INGEST_IDEIAS_TRANSICOES_MAX) || 500;
/** Páginas da s7 por run. 0 desliga a fatia (Number("0") || x daria x, por isso o parse explícito). */
const ARQUIVO_PAGINAS = process.env.INGEST_IDEIAS_ARQUIVO_PAGINAS !== undefined
  ? Math.max(0, Number(process.env.INGEST_IDEIAS_ARQUIVO_PAGINAS) || 0)
  : 100;
/**
 * Orçamento de tempo das fases 2 e 3, contado do início do run. O job tem 200 min; o crawl vivo
 * (~60 páginas) cabe com folga mesmo a ~24 s/página. Passado o orçamento, transições e arquivo param
 * onde estão e o run grava o que leu — melhor um run curto gravado que um run longo cancelado.
 */
const ORCAMENTO_MS = (Number(process.env.INGEST_IDEIAS_ORCAMENTO_MIN) || 150) * 60_000;
const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_PREFIX = "out-ideias-";

// Um disjuntor por RUN: falha de transporte seguida, em qualquer dos laços, é o
// mesmo sintoma — o portal parou de responder. Ver breaker.ts.
const disjuntor = criarDisjuntor();

type IdeiaCrawlItem = IdeiaListingItem & { status: string };

interface CrawlResult {
  items: IdeiaCrawlItem[];
  totalPages: number;
  failedPages: string[];
  complete: boolean;
}

/** Phase 1: every page of every LIVE situacao bucket, tagging status; dedupe by id (first bucket wins). */
async function crawlVivo(): Promise<CrawlResult> {
  const byId = new Map<number, IdeiaCrawlItem>();
  const failedPages: string[] = [];
  let totalPages = 0;

  // Numeric order so dedup (first-seen wins) is deterministic across runs.
  for (const situacao of [...SITUACOES_VIVAS].sort((a, b) => a - b)) {
    const status = SITUACAO_STATUS[situacao];
    const base = `${ECIDADANIA_BASE}/pesquisaideia?situacao=${situacao}`;

    // p1: a situacao bucket may be legitimately empty, so 0 items is not a failure here.
    let firstPage: ParsedPage<IdeiaListingItem>;
    try {
      firstPage = await fetchParsedPage(`${base}&p=1`, parseIdeiaListingPage, {
        allowEmpty: true,
        ...firstContactOpts(),
      });
      disjuntor.sucesso();
    } catch (e) {
      logPageFailure(ENTIDADE, `s${situacao}:p1`, e);
      failedPages.push(`s${situacao}:p1`);
      disjuntor.falha(e, `s${situacao}:p1`);
      continue;
    }
    totalPages++;
    const lastPage = Math.min(findLastPageIdeias(firstPage.html), MAX_PAGES_PER_SITUACAO);
    for (const it of firstPage.items) {
      if (!byId.has(it.id)) byId.set(it.id, { ...it, status });
    }

    for (let p = 2; p <= lastPage; p++) {
      try {
        const { items: parsed } = await fetchParsedPage(`${base}&p=${p}`, parseIdeiaListingPage);
        for (const it of parsed) if (!byId.has(it.id)) byId.set(it.id, { ...it, status });
        disjuntor.sucesso();
      } catch (e) {
        logPageFailure(ENTIDADE, `s${situacao}:p${p}`, e);
        failedPages.push(`s${situacao}:p${p}`);
        disjuntor.falha(e, `s${situacao}:p${p}`);
      }
      totalPages++;
      await sleep(PAGE_DELAY_MS);
    }
  }

  return { items: [...byId.values()], totalPages, failedPages, complete: failedPages.length === 0 };
}

/** Phase 2 result: one fresh reading per idea that left the live lists. */
interface Transicao {
  id: number;
  apoios: number | null;
  status: string;
  detalhe: { dataPublicacao: string | null; autorUf: string | null; descricao: string | null; plConvertido: string | null };
}

/**
 * Phase 2: read the detail page of each selected id. Stops at the time budget or a tripped breaker.
 * Appends to the caller's `lidas` as it goes, so readings made before a PortalForaError survive it.
 */
async function lerTransicoes(ids: number[], deadline: number, lidas: Transicao[]): Promise<{ falhas: number; naoReconhecidas: number }> {
  let falhas = 0;
  let naoReconhecidas = 0;
  for (const id of ids) {
    if (Date.now() >= deadline) {
      console.log(`[ideias][transicoes] orçamento de tempo esgotado após ${lidas.length + falhas + naoReconhecidas}/${ids.length}`);
      break;
    }
    try {
      const d = await fetchIdeiaDetalheCorpus(id);
      disjuntor.sucesso();
      if (d.status === null) {
        // Situação ausente ou texto novo: não adivinhar. A linha guardada fica como está.
        naoReconhecidas++;
        console.warn(`[ideias][transicoes] id=${id}: situação não reconhecida na página de detalhe`);
      } else {
        lidas.push({
          id,
          apoios: d.apoios,
          status: d.status,
          detalhe: { dataPublicacao: d.dataPublicacao, autorUf: d.autorUf, descricao: d.descricao, plConvertido: d.plConvertido },
        });
      }
    } catch (e) {
      if (e instanceof PortalForaError) throw e;
      falhas++;
      logPageFailure(ENTIDADE, `detalhe:${id}`, e);
      disjuntor.falha(e, `detalhe:${id}`);
    }
    await sleep(DETAIL_DELAY_MS);
  }
  return { falhas, naoReconhecidas };
}

/** Phase 3 result: items read from the archive slice + the cursor to persist (null = unchanged). */
interface FatiaArquivo {
  items: IdeiaCrawlItem[];
  paginas: string;
  cursor: { pagina: number; voltas: number } | null;
}

/**
 * Phase 3: up to ARQUIVO_PAGINAS pages of situacao 7 from the persisted cursor, in sequence, stopping
 * at the first failure (the cursor only covers pages actually read) or at the time budget.
 */
async function lerFatiaArquivo(deadline: number): Promise<FatiaArquivo> {
  const vazio: FatiaArquivo = { items: [], paginas: "-", cursor: null };
  if (ARQUIVO_PAGINAS <= 0) return vazio;

  const salvo = readDetalheCursor(CURSOR_ARQUIVO);
  const cursor = { pagina: salvo.lastEntityId, voltas: salvo.fullPasses };
  const base = `${ECIDADANIA_BASE}/pesquisaideia?situacao=${SITUACAO_ARQUIVO}`;
  const status = SITUACAO_STATUS[SITUACAO_ARQUIVO];
  const inicio = inicioFatiaArquivo(cursor.pagina);

  const items: IdeiaCrawlItem[] = [];
  let ultimaPagina = 0;
  let ultimaLida = 0;
  for (let p = inicio; p < inicio + ARQUIVO_PAGINAS; p++) {
    if (Date.now() >= deadline) {
      console.log(`[ideias][arquivo] orçamento de tempo esgotado na s${SITUACAO_ARQUIVO}:p${p}`);
      break;
    }
    if (ultimaPagina > 0 && p > ultimaPagina) break;
    try {
      const page = await fetchParsedPage(`${base}&p=${p}`, parseIdeiaListingPage, { allowEmpty: p === inicio });
      disjuntor.sucesso();
      if (p === inicio) {
        ultimaPagina = findLastPageIdeias(page.html);
        if (page.items.length === 0) {
          // Cursor além do fim (a s7 encolheu): fecha a passada e recomeça amanhã da página 1.
          // Página vazia DENTRO do intervalo é falha, não fim — o cursor não anda.
          if (p > ultimaPagina) return { items: [], paginas: `p${p} (além do fim p${ultimaPagina})`, cursor: { pagina: 0, voltas: cursor.voltas + 1 } };
          console.warn(`[ideias][arquivo] s${SITUACAO_ARQUIVO}:p${p} veio vazia dentro do intervalo (fim p${ultimaPagina}); cursor parado`);
          return vazio;
        }
      }
      for (const it of page.items) items.push({ ...it, status });
      ultimaLida = p;
    } catch (e) {
      if (e instanceof PortalForaError) throw e;
      logPageFailure(ENTIDADE, `s${SITUACAO_ARQUIVO}:p${p}`, e);
      disjuntor.falha(e, `s${SITUACAO_ARQUIVO}:p${p}`);
      break;
    }
    await sleep(PAGE_DELAY_MS);
  }

  const novo = avancarCursorArquivo(cursor, ultimaLida, ultimaPagina);
  const paginas = ultimaLida > 0 ? `p${inicio}..p${ultimaLida} de ${ultimaPagina}` : `nenhuma (parou em p${inicio})`;
  return { items, paginas, cursor: novo === cursor ? null : novo };
}

/** Remove any out-ideias-*.sql from a prior run so a smaller run never re-applies stale files. */
function cleanOldOutputs(): void {
  for (const f of readdirSync(OUT_DIR)) {
    if (f.startsWith(OUT_PREFIX) && f.endsWith(".sql")) unlinkSync(join(OUT_DIR, f));
  }
}

function writeBatches(files: string[]): void {
  files.forEach((content, i) => {
    writeFileSync(join(OUT_DIR, `${OUT_PREFIX}${String(i + 1).padStart(3, "0")}.sql`), content);
  });
}

/** Single run-only file (no-write outcome); reuses the 001 slot the apply loop will pick up. */
function writeRunOnly(now: string, status: string, rows: number, error: string): void {
  writeFileSync(join(OUT_DIR, `${OUT_PREFIX}001.sql`), generateRunOnlySql(now, status, rows, error, ENTIDADE));
}

/**
 * Build the canonical record. The listing (or detail page, for transitions) owns titulo/apoios/status;
 * the four detail-only fields are IMMUTABLE and filled by the resumable detail backfill
 * (index-ideias-detalhe.ts) — PRESERVE them from the stored payload so this crawl never wipes them.
 */
function toRecord(
  id: number,
  fresh: { titulo?: string; apoios: number; status: string },
  prevJson: string | undefined,
  detalhe?: Transicao["detalhe"],
): SyncRecord {
  const p = prevJson ? (JSON.parse(prevJson) as Partial<IdeiaResumo>) : undefined;
  const ideia = buildIdeiaResumo({
    id,
    titulo: fresh.titulo ?? p?.titulo,
    apoios: fresh.apoios,
    status: fresh.status,
    dataPublicacao: detalhe?.dataPublicacao ?? p?.dataPublicacao ?? null,
    autorUf: detalhe?.autorUf ?? p?.autorUf ?? null,
    descricao: detalhe?.descricao ?? p?.descricao ?? null,
    plConvertido: detalhe?.plConvertido ?? p?.plConvertido ?? null,
  });
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

async function main(): Promise<void> {
  const inicioRun = Date.now();
  const deadline = inicioRun + ORCAMENTO_MS;
  const now = new Date(inicioRun).toISOString();
  const force = process.env.INGEST_FORCE === "1" || process.argv.includes("--force");
  const corpusMinPct = parseAnomalyMinPct(process.env.ECIDADANIA_CORPUS_MIN_PCT, 80);

  cleanOldOutputs();

  // ── 1. vivo ──
  const crawl = await crawlVivo();
  console.log(`[ideias][vivo] totalPages=${crawl.totalPages} items=${crawl.items.length} failedPages=${crawl.failedPages.length}`);

  if (!crawl.complete) {
    const err = `crawl vivo incompleto: ${crawl.failedPages.length} pagina(s): ${crawl.failedPages.slice(0, 20).join(",")}`;
    console.error(`[ideias][gate] ${err} — nada será gravado`);
    writeRunOnly(now, "erro", crawl.items.length, err);
    process.exit(1);
  }

  const existentes = readExistingMeta(ENTIDADE);
  const abertasNoD1 = existentes.filter((r) => r.status === "aberta").length;
  const abertasLidas = crawl.items.filter((it) => it.status === "aberta").length;
  if (!force && !pisoVivoOk(abertasLidas, abertasNoD1, corpusMinPct)) {
    const err = `catastrophic floor: ${abertasLidas} abertas lidas (< ${corpusMinPct}% das ${abertasNoD1} abertas no D1); use --force se legítimo`;
    console.error(`[ideias][gate] verdict=anomalo — ${err}`);
    writeRunOnly(now, "anomalo", crawl.items.length, err);
    process.exit(1);
  }

  // ── 2. transições e 3. arquivo — nunca bloqueiam o que o vivo já leu ──
  const vistos = new Set(crawl.items.map((it) => it.id));
  const ids = selecionarTransicoes(existentes, vistos, TRANSICOES_MAX);
  const transicoes: Transicao[] = [];
  let fatia: FatiaArquivo = { items: [], paginas: "-", cursor: null };
  try {
    const t = await lerTransicoes(ids, deadline, transicoes);
    console.log(`[ideias][transicoes] candidatas=${ids.length} lidas=${transicoes.length} falhas=${t.falhas} naoReconhecidas=${t.naoReconhecidas}`);
    fatia = await lerFatiaArquivo(deadline);
    console.log(`[ideias][arquivo] ${fatia.paginas} items=${fatia.items.length} cursor=${fatia.cursor ? `${fatia.cursor.pagina}/voltas=${fatia.cursor.voltas}` : "inalterado"}`);
  } catch (e) {
    if (!(e instanceof PortalForaError)) throw e;
    // O portal caiu DEPOIS do crawl vivo completo: grava o vivo e as transições já lidas. A fatia do
    // arquivo interrompida é descartada sem mover o cursor — será relida no próximo run.
    console.error(`[ideias][parcial] ${e.message} — gravando vivo + ${transicoes.length} transição(ões); o resto retoma amanhã`);
  }

  // ── merge: vivo > transição > arquivo (o primeiro que leu o id ganha) ──
  const existingPayloads = readAllPayloads(ENTIDADE);
  const records = new Map<number, SyncRecord>();
  for (const it of crawl.items) records.set(it.id, toRecord(it.id, it, existingPayloads.get(it.id)));
  for (const t of transicoes) {
    if (records.has(t.id)) continue;
    const prev = existingPayloads.get(t.id);
    const prevApoios = prev ? (JSON.parse(prev) as Partial<IdeiaResumo>).apoios ?? 0 : 0;
    records.set(t.id, toRecord(t.id, { apoios: t.apoios ?? prevApoios, status: t.status }, prev, t.detalhe));
  }
  for (const it of fatia.items) {
    if (!records.has(it.id)) records.set(it.id, toRecord(it.id, it, existingPayloads.get(it.id)));
  }
  const lista = [...records.values()];

  const byStatus = lista.reduce<Record<string, number>>((acc, r) => {
    acc[r.status ?? "?"] = (acc[r.status ?? "?"] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`[ideias][normalize] total=${lista.length} ${JSON.stringify(byStatus)}`);

  const existingHashes = new Map(existentes.map((r) => [r.id, r.content_hash]));
  const { annotated, rowsChanged } = planEntitySync(lista, existingHashes);
  const tail = fatia.cursor ? [cursorUpsertStmt(CURSOR_ARQUIVO, fatia.cursor.pagina, fatia.cursor.voltas, now)] : [];
  // rows_scraped = ideias LIDAS neste run (vivo + transições + arquivo), não o tamanho do acervo:
  // o piso deste job não lê mais esse número (deriva do D1), e o acervo inteiro segue em current.
  const files = generateLoadSqlBatches(annotated, now, lista.length, rowsChanged, ENTIDADE, BATCH_SIZE, tail);
  writeBatches(files);
  console.log(`[ideias][load] wrote ${files.length} file(s): ${lista.length} upserts, ${rowsChanged} changed, 1 ok run row`);
  process.exit(0);
}

main().catch((e) => {
  const err = e instanceof Error ? e.message : String(e);
  console.error(`[ideias][fatal] ${err}`);
  try {
    cleanOldOutputs();
    writeRunOnly(new Date().toISOString(), "erro", 0, `fatal: ${err}`);
  } catch {
    /* nothing more we can do */
  }
  process.exit(1);
});
