/**
 * Estudo de reconciliação listagem×detalhe de EVENTOS — achado A3 da ETAPA 4
 * (ROADMAP CIENTÍFICO, ETAPA 5, última linha da tabela).
 *
 * Pergunta: os campos `data`, `hora` e `comentarios` de `eventos` no dataset vêm SÓ da listagem
 * `principalaudiencia`. A página de detalhe `visualizacaoaudiencia?id=` pode divergir. Este script
 * mede a divergência com uma amostra n=100 por SORTEIO DETERMINÍSTICO, estratificada por status
 * (agendado/encerrado/cancelado) e por época (ano do evento).
 *
 * NÃO altera schema.ts nem caveats. NÃO corta release. Apenas produz evidência reproduzível:
 *   - docs/estudo-a3/amostra.csv     (uma linha por evento: listagem, detalhe, deltas)
 *   - docs/estudo-a3/resumo.json     (estatísticas agregadas por campo e por estrato)
 * O veredito por campo (documentar / coletar-do-detalhe / remover) é 👤, depois de ver a evidência.
 *
 * Fonte da listagem = corpus soberano D1 `ecidadania_current` (é exatamente o que o dataset carrega,
 * pois o pipeline harmoniza esse payload). Fonte do detalhe = fetch vivo + parser real
 * `obterEventoInternal` (src/scraper/ecidadania.ts). Throttle: sequencial, ~100 req de detalhe.
 *
 * Rodar: npx tsx scripts/study-a3-eventos/index.ts   (precisa de credencial wrangler p/ o D1 --remote)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { readCurrent } from "../build-dataset/d1-read.js";
import { obterEventoInternal, ECIDADANIA_BASE } from "../../src/scraper/ecidadania.js";
import { USER_AGENT } from "../../src/version.js";

// ── Configuração do sorteio (reprodutível) ──────────────────────────────────
const N_TOTAL = 100;
/** Mesma chave de sorteio determinístico da ETAPA 4 (Knuth multiplicative hash mod 2^31-1). */
const hashKey = (id: number): number => (id * 2654435761) % 2147483647;

/** Bin de época pelo ano do evento (parte YYYY da data da listagem). null → "sem-data". */
function epocaBin(data: string | null): string {
  if (!data) return "sem-data";
  const ano = parseInt(data.slice(0, 4), 10);
  if (ano <= 2018) return "historico";      // 2012–2018
  if (ano <= 2022) return "intermediario";  // 2019–2022
  return "recente";                          // 2023–2027
}

/** Alocação por status: agendado é censo (só 7 no corpus); o resto por época proporcional. */
const ALLOC_STATUS: Record<string, number | "censo"> = {
  agendado: "censo",
  cancelado: 23,
  encerrado: 70,
};

// ── Tipos ────────────────────────────────────────────────────────────────────
interface FrameRow {
  id: number;
  statusList: string;
  dataList: string | null;
  horaList: string | null;
  comentariosList: number;
  epoca: string;
}

interface CompareRow extends FrameRow {
  ok: boolean;
  detErro: string | null;
  statusDet: string | null;
  dataDet: string | null;
  horaDet: string | null;
  /** comentários lidos do HTML da página de detalhe (container `#comentarios` é populado por JS → ~sempre 0). */
  comentariosDetHtml: number | null;
  /** contagem CANÔNICA de comentários: nº de blocos no fragmento AJAX `ajaxcolecaocomentarioaudiencia`. */
  comentariosCanon: number | null;
  comentCanonErro: string | null;
  // deltas
  dataDivergente: boolean | null;
  dataDeltaDias: number | null;
  horaDivergente: boolean | null;
  horaDeltaMin: number | null;
  comentZeroEspurio: boolean | null; // listagem=0 e canônico>0
  comentDivergente: boolean | null;
}

// ── Sorteio estratificado determinístico ─────────────────────────────────────
/** Largest-remainder: distribui `total` entre células proporcional ao tamanho de cada célula. */
function proportionalAlloc(cells: { key: string; size: number }[], total: number): Map<string, number> {
  const sum = cells.reduce((a, c) => a + c.size, 0);
  const out = new Map<string, number>();
  if (sum === 0) return out;
  const raw = cells.map((c) => ({ key: c.key, exact: (c.size / sum) * total, size: c.size }));
  let floors = 0;
  for (const r of raw) {
    const f = Math.min(Math.floor(r.exact), r.size);
    out.set(r.key, f);
    floors += f;
  }
  let left = total - floors;
  // distribui o restante por maior parte fracionária, respeitando o teto = tamanho da célula
  const byRem = [...raw].sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)));
  while (left > 0) {
    let progressed = false;
    for (const r of byRem) {
      if (left === 0) break;
      const cur = out.get(r.key)!;
      if (cur < r.size) { out.set(r.key, cur + 1); left--; progressed = true; }
    }
    if (!progressed) break; // todas as células no teto
  }
  return out;
}

function sampleStratified(frame: FrameRow[]): { sample: FrameRow[]; allocLog: Record<string, Record<string, number>> } {
  const byStatus = new Map<string, FrameRow[]>();
  for (const r of frame) {
    if (!byStatus.has(r.statusList)) byStatus.set(r.statusList, []);
    byStatus.get(r.statusList)!.push(r);
  }
  const sample: FrameRow[] = [];
  const allocLog: Record<string, Record<string, number>> = {};

  for (const [status, alloc] of Object.entries(ALLOC_STATUS)) {
    const pool = byStatus.get(status) ?? [];
    allocLog[status] = {};
    if (alloc === "censo") {
      for (const r of pool) sample.push(r);
      allocLog[status]["(censo)"] = pool.length;
      continue;
    }
    // agrupa por época e aloca proporcional
    const byEpoca = new Map<string, FrameRow[]>();
    for (const r of pool) {
      if (!byEpoca.has(r.epoca)) byEpoca.set(r.epoca, []);
      byEpoca.get(r.epoca)!.push(r);
    }
    const cells = [...byEpoca.entries()].map(([key, rows]) => ({ key, size: rows.length }));
    const perEpoca = proportionalAlloc(cells, Math.min(alloc, pool.length));
    for (const [epoca, k] of perEpoca.entries()) {
      const ranked = [...byEpoca.get(epoca)!].sort((a, b) => hashKey(a.id) - hashKey(b.id));
      const picked = ranked.slice(0, k);
      sample.push(...picked);
      allocLog[status][epoca] = picked.length;
    }
  }
  return { sample, allocLog };
}

// ── Comparação de um evento (listagem × detalhe) ─────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function minutesOf(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}
function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round((da - db) / 86400000);
}

/**
 * Contagem CANÔNICA de comentários: o `#comentarios` do detalhe é populado por AJAX
 * (`ajaxColecaoComentarioAudiencia`), então a contagem verdadeira = nº de blocos
 * `<div class="comentario" id="comentario-N">` retornados pelo fragmento. Chamada única, sem
 * paginação (o JS faz `.empty().append(data)` de uma vez).
 */
async function fetchComentariosCanon(id: number): Promise<number> {
  const url = `${ECIDADANIA_BASE}/ajaxcolecaocomentarioaudiencia?audienciaId=${id}`;
  const r = await fetch(url, {
    headers: { Accept: "text/html,*/*", "User-Agent": USER_AGENT, "X-Requested-With": "XMLHttpRequest" },
  });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { retryable: r.status >= 500 || r.status === 429 });
  const t = await r.text();
  return (t.match(/<div class="comentario"\s+id="comentario-\d+"/gi) || []).length;
}

async function compareOne(row: FrameRow): Promise<CompareRow> {
  const base: CompareRow = {
    ...row, ok: false, detErro: null, statusDet: null, dataDet: null, horaDet: null,
    comentariosDetHtml: null, comentariosCanon: null, comentCanonErro: null,
    dataDivergente: null, dataDeltaDias: null, horaDivergente: null, horaDeltaMin: null,
    comentZeroEspurio: null, comentDivergente: null,
  };
  let det: Awaited<ReturnType<typeof obterEventoInternal>> | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      det = await obterEventoInternal(row.id);
      break;
    } catch (e) {
      const retry = (e as { retryable?: boolean }).retryable;
      base.detErro = (e as Error).message;
      if (!retry || attempt === 2) break;
      await sleep(1500 * (attempt + 1));
    }
  }

  // contagem canônica de comentários (endpoint separado; independe do parse do HTML de detalhe)
  await sleep(400);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      base.comentariosCanon = await fetchComentariosCanon(row.id);
      base.comentCanonErro = null;
      break;
    } catch (e) {
      base.comentCanonErro = (e as Error).message;
      if (!(e as { retryable?: boolean }).retryable || attempt === 2) break;
      await sleep(1500 * (attempt + 1));
    }
  }

  if (!det && base.comentariosCanon == null) return base; // nada obtido

  if (det) {
    base.detErro = null;
    base.statusDet = det.status;
    base.dataDet = det.data;
    base.horaDet = det.hora;
    base.comentariosDetHtml = det.comentarios; // esperado ~0: contagem não está no HTML
    // data
    if (row.dataList != null && det.data != null) {
      base.dataDivergente = row.dataList !== det.data;
      base.dataDeltaDias = daysBetween(row.dataList, det.data);
    }
    // hora
    const ml = minutesOf(row.horaList);
    const md = minutesOf(det.hora);
    if (ml != null && md != null) {
      base.horaDivergente = ml !== md;
      base.horaDeltaMin = ml - md; // sinal: +N ⇒ listagem adiantada frente ao detalhe
    }
  }
  // comentarios: listagem × canônico (AJAX)
  if (base.comentariosCanon != null) {
    base.comentDivergente = row.comentariosList !== base.comentariosCanon;
    base.comentZeroEspurio = row.comentariosList === 0 && base.comentariosCanon > 0;
  }
  base.ok = det != null; // ok = detalhe-HTML obtido (data/hora/status); comentário tem flag própria
  return base;
}

// ── Estatística agregada ─────────────────────────────────────────────────────
function summarize(rows: CompareRow[]) {
  const ok = rows.filter((r) => r.ok);
  const erros = rows.filter((r) => !r.ok);

  const dataPares = ok.filter((r) => r.dataDivergente != null);
  const horaPares = ok.filter((r) => r.horaDivergente != null);

  const horaDeltas = horaPares.map((r) => r.horaDeltaMin!).filter((n) => n !== 0);
  const dataDeltas = dataPares.filter((r) => r.dataDivergente).map((r) => r.dataDeltaDias!);

  const comentCanonOk = rows.filter((r) => r.comentariosCanon != null);
  const comentZero = comentCanonOk.filter((r) => r.comentariosList === 0);
  const comentZeroEspurio = comentZero.filter((r) => r.comentZeroEspurio);

  const quant = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
    return { n: s.length, min: s[0], p25: q(0.25), mediana: q(0.5), p75: q(0.75), max: s[s.length - 1] };
  };
  const dist = (xs: number[]) => {
    const m = new Map<number, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return Object.fromEntries([...m.entries()].sort((a, b) => a[0] - b[0]));
  };

  return {
    amostra: rows.length,
    detalhesOk: ok.length,
    erros: erros.length,
    errosIds: erros.map((r) => ({ id: r.id, status: r.statusList, erro: r.detErro })),
    data: {
      paresComparaveis: dataPares.length,
      divergentes: dataPares.filter((r) => r.dataDivergente).length,
      pctDivergente: dataPares.length ? +(100 * dataPares.filter((r) => r.dataDivergente).length / dataPares.length).toFixed(1) : null,
      deltaDiasDist: dist(dataDeltas),
    },
    hora: {
      paresComparaveis: horaPares.length,
      divergentes: horaPares.filter((r) => r.horaDivergente).length,
      pctDivergente: horaPares.length ? +(100 * horaPares.filter((r) => r.horaDivergente).length / horaPares.length).toFixed(1) : null,
      deltaMinResumo: quant(horaDeltas),
      deltaMinDist: dist(horaDeltas),
    },
    comentarios: {
      canonicoObtido: comentCanonOk.length,
      canonErros: rows.filter((r) => r.comentariosCanon == null).length,
      listagemZero: comentZero.length,
      listagemZeroComCanonMaior: comentZeroEspurio.length,
      pctZeroEspurio: comentZero.length ? +(100 * comentZeroEspurio.length / comentZero.length).toFixed(1) : null,
      canonMaiorQueZeroDist: quant(comentZeroEspurio.map((r) => r.comentariosCanon!)),
      // subcontagem total: quanto o dataset (listagem) perde frente ao canônico
      somaComentariosCanon: comentCanonOk.reduce((a, r) => a + (r.comentariosCanon ?? 0), 0),
      somaComentariosListagem: comentCanonOk.reduce((a, r) => a + r.comentariosList, 0),
      // eventos onde a listagem TINHA contagem (>0): confere com o canônico?
      listagemNaoZero: comentCanonOk.filter((r) => r.comentariosList > 0).map((r) => ({ id: r.id, listagem: r.comentariosList, canon: r.comentariosCanon })),
      // detalhe-HTML como fonte de comentários: prova de inviabilidade (deve ser ~0)
      somaComentariosDetalheHtml: ok.reduce((a, r) => a + (r.comentariosDetHtml ?? 0), 0),
    },
    statusFold: {
      // eventos agendados na listagem que no detalhe têm situacao diferente (fold REGISTRADO/etc.)
      agendadoListDetalheDiverge: ok.filter((r) => r.statusList === "agendado" && r.statusDet && r.statusDet !== "agendado")
        .map((r) => ({ id: r.id, statusDet: r.statusDet })),
    },
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  console.error("[A3] lendo corpus de eventos do D1…");
  const corpus = readCurrent("eventos");
  const frame: FrameRow[] = corpus.map((r) => {
    const p = r.payload as Record<string, unknown>;
    const dataList = (p.data as string | null) ?? null;
    return {
      id: r.entityId,
      statusList: String(p.status ?? ""),
      dataList,
      horaList: (p.hora as string | null) ?? null,
      comentariosList: Number(p.comentarios ?? 0),
      epoca: epocaBin(dataList),
    };
  });
  console.error(`[A3] frame = ${frame.length} eventos`);

  const { sample, allocLog } = sampleStratified(frame);
  // ordem determinística de processamento = por id
  sample.sort((a, b) => a.id - b.id);
  console.error(`[A3] amostra = ${sample.length} eventos. Alocação:`, JSON.stringify(allocLog));

  const results: CompareRow[] = [];
  for (let i = 0; i < sample.length; i++) {
    const row = sample[i];
    const res = await compareOne(row);
    results.push(res);
    console.error(`[A3] ${i + 1}/${sample.length} id=${row.id} ${row.statusList} ${res.ok ? "ok" : "ERRO:" + res.detErro}`);
    if (i < sample.length - 1) await sleep(800); // throttle educado com o e-Cidadania
  }

  const resumo = { geradoEm: new Date().toISOString(), design: { nAlvo: N_TOTAL, hash: "(id*2654435761)%2147483647", allocStatus: ALLOC_STATUS, epocaBins: "historico ≤2018 · intermediario 2019–2022 · recente 2023–2027 · sem-data" }, allocLog, ...summarize(results) };

  const outDir = "docs/estudo-a3";
  mkdirSync(outDir, { recursive: true });

  const cols = [
    "id", "statusList", "epoca", "dataList", "horaList", "comentariosList",
    "ok", "detErro", "statusDet", "dataDet", "horaDet", "comentariosDetHtml", "comentariosCanon", "comentCanonErro",
    "dataDivergente", "dataDeltaDias", "horaDivergente", "horaDeltaMin", "comentDivergente", "comentZeroEspurio",
  ];
  const csv = [cols.join(",")]
    .concat(results.map((r) => cols.map((c) => csvEscape((r as Record<string, unknown>)[c])).join(",")))
    .join("\n");
  writeFileSync(`${outDir}/amostra.csv`, csv + "\n", "utf8");
  writeFileSync(`${outDir}/resumo.json`, JSON.stringify(resumo, null, 2) + "\n", "utf8");

  console.error(`[A3] escrito ${outDir}/amostra.csv e resumo.json`);
  console.log(JSON.stringify(resumo, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
