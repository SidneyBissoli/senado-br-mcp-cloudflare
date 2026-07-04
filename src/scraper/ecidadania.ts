/**
 * e-Cidadania scraper — isolated data-acquisition + normalization boundary (P2).
 *
 * Two acquisition modes:
 *   - REST JSON (lists): /restcolecaomais{materia,ideia,audiencia} — clean JSON, low fragility.
 *   - HTML scrape (detail): /visualizacao{materia,ideia,audiencia} — regex over the HTML string
 *     (no cheerio — Workers compatible; no HTMLRewriter — the regex parsers are tested and work).
 *
 * Everything here is pure parsing + fetch, with no MCP/tool/cache dependency, so it can be
 * driven by the Cron pipeline (step 3) and covered by fixture-based contract tests.
 */

import { UPSTREAM_TIMEOUT_MS } from "../types.js";
import { USER_AGENT } from "../version.js";

export const ECIDADANIA_BASE = "https://www12.senado.leg.br/ecidadania";

/**
 * Error carrying a `retryable` flag, mirroring UpstreamError so the tool layer
 * (`errorFrom` / `ecidadaniaError`) can surface it. e-Cidadania has its own fetch
 * (not `upstreamFetch`), so transient conditions are classified here: 5xx / 429 /
 * timeout / network → retryable; 4xx → not.
 */
function ecidadaniaFetchError(message: string, retryable: boolean): Error {
  return Object.assign(new Error(message), { retryable });
}
const isTransientStatus = (status: number) => status >= 500 || status === 429;

/**
 * Fetch an HTML page from e-Cidadania with descriptive errors.
 * `opts.ajax` sends the XHR headers the internal `ajax*` fragment endpoints expect
 * (`X-Requested-With: XMLHttpRequest`, wider `Accept`).
 */
export async function fetchPage(
  path: string,
  opts: { ajax?: boolean; allowEmpty?: boolean } = {},
): Promise<string> {
  const url = `${ECIDADANIA_BASE}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: opts.ajax
        ? { Accept: "text/html,*/*", "User-Agent": USER_AGENT, "X-Requested-With": "XMLHttpRequest" }
        : { Accept: "text/html", "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      throw ecidadaniaFetchError(`e-Cidadania retornou HTTP ${resp.status} para ${path}`, isTransientStatus(resp.status));
    }
    const text = await resp.text();
    // AJAX comment fragments are legitimately empty for events with zero comments — allowEmpty
    // lets the caller treat "" as a valid (empty) result instead of a transient failure.
    if (!opts.allowEmpty && !text.trim()) {
      throw ecidadaniaFetchError(`e-Cidadania retornou página vazia para ${path}`, true);
    }
    return text;
  } catch (e) {
    clearTimeout(timeout);
    if ((e as Error).name === "AbortError") {
      throw ecidadaniaFetchError(`e-Cidadania: timeout (${UPSTREAM_TIMEOUT_MS / 1000}s) ao acessar ${path}`, true);
    }
    if (e instanceof Error && "retryable" in e) throw e; // already classified above
    throw ecidadaniaFetchError(`e-Cidadania: falha de rede ao acessar ${path} (${(e as Error).message})`, true);
  }
}

/**
 * Fetch JSON from an e-Cidadania REST endpoint with validation.
 * Ensures the response is valid JSON and an array.
 */
export async function fetchEcidadaniaJson(endpoint: string): Promise<any[]> {
  const url = `${ECIDADANIA_BASE}${endpoint}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      throw ecidadaniaFetchError(`e-Cidadania REST API retornou HTTP ${resp.status} para ${endpoint}`, isTransientStatus(resp.status));
    }

    let data: unknown;
    try {
      data = await resp.json();
    } catch {
      throw ecidadaniaFetchError(`e-Cidadania REST API retornou JSON inválido para ${endpoint}`, true);
    }

    if (!Array.isArray(data)) {
      // API returned an object or other non-array — wrap or return empty
      if (data && typeof data === "object") return [data];
      return [];
    }
    return data;
  } catch (e) {
    clearTimeout(timeout);
    if ((e as Error).name === "AbortError") {
      throw ecidadaniaFetchError(`e-Cidadania REST API: timeout (${UPSTREAM_TIMEOUT_MS / 1000}s) ao acessar ${endpoint}`, true);
    }
    if (e instanceof Error && "retryable" in e) throw e; // already classified above
    throw ecidadaniaFetchError(`e-Cidadania REST API: falha de rede ao acessar ${endpoint} (${(e as Error).message})`, true);
  }
}

/** Parse Brazilian number: 1.234.567 -> 1234567 */
export function parseBrNum(s: string): number {
  return parseInt(s.replace(/\./g, ""), 10) || 0;
}

/** Extract ID from href like visualizacaomateria?id=1234 */
export function extractId(href: string): number | null {
  const m = href.match(/id=(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/** Normalize href from e-Cidadania pages (handles leading spaces and duplicate /ecidadania/ prefix). */
export function normalizeEcidadaniaUrl(href: string, type: "visualizacaomateria" | "visualizacaoideia" | "visualizacaoaudiencia"): string {
  const idMatch = href.match(/id=(\d+)/);
  if (idMatch) return `${ECIDADANIA_BASE}/${type}?id=${idMatch[1]}`;
  return `${ECIDADANIA_BASE}/${href.trim().replace(/^\/?ecidadania\//, "").replace(/^\//, "")}`;
}

/** Strip HTML tags from a string. */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Extract date DD/MM/YY or DD/MM/YYYY -> YYYY-MM-DD */
export function extractDate(text: string): string | null {
  const m = text.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2]}-${m[1]}`;
}

export function extractTime(text: string): string | null {
  const m = text.match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

// ── Consultas ─────────────────────────────────────────────────────────────

export interface ConsultaResumo {
  id: number; materia: string; ementa: string;
  votosSim: number; votosNao: number; totalVotos: number;
  percentualSim: number; percentualNao: number;
  /** Detail-enriched fields (v2). Public agents — name kept. Null until the detail crawl fills them. */
  autoria: string | null;
  relator: string | null;
  status: string; url: string;
}

/**
 * Canonical `ConsultaResumo` builder — the single source of the object's field order and the
 * percentual rounding. Both writers into `ecidadania_current` go through this so the JSON payload
 * (and therefore `contentHash`) is byte-identical for identical inputs: the 2h highlight Cron
 * (`listarConsultasInternal`, REST source) and the weekly full-corpus ingestion job (HTML listing
 * source). Diverging field order or rounding here would make every row read as "changed" forever,
 * bloating `ecidadania_history` and defeating change detection.
 *
 * `totalVotos` is taken from the caller when provided (the REST endpoint reports its own total,
 * which may differ slightly from votosSim+votosNao) and otherwise derived as votosSim+votosNao.
 * Percentuais are always derived here with `Math.round`.
 */
export function buildConsultaResumo(fields: {
  id: number; materia?: string; ementa?: string;
  votosSim: number; votosNao: number; totalVotos?: number;
  autoria?: string | null; relator?: string | null;
  status?: string; url?: string;
}): ConsultaResumo {
  const votosSim = fields.votosSim;
  const votosNao = fields.votosNao;
  const totalVotos = fields.totalVotos ?? votosSim + votosNao;
  const percentualSim = totalVotos > 0 ? Math.round((votosSim / totalVotos) * 100) : 0;
  const percentualNao = totalVotos > 0 ? Math.round((votosNao / totalVotos) * 100) : 0;
  return {
    id: fields.id,
    materia: fields.materia || "",
    ementa: fields.ementa || "",
    votosSim,
    votosNao,
    totalVotos,
    percentualSim,
    percentualNao,
    autoria: fields.autoria ?? null,
    relator: fields.relator ?? null,
    status: fields.status || "aberta",
    url: fields.url || `${ECIDADANIA_BASE}/visualizacaomateria?id=${fields.id}`,
  };
}

/** Campos detail-only da consulta para o corpus (v2). Agentes públicos — nome mantido. */
export interface ConsultaDetalheCorpus {
  autoria: string | null;
  relator: string | null;
}

/**
 * Pure parser of a consulta detail page (`visualizacaomateria?id=`) for the CORPUS — extracts the
 * public agents `autoria`/`relator` (name kept, per the privacy posture). Shares the anchors of
 * `obterConsultaInternal`.
 */
export function parseConsultaDetalheCorpus(html: string): ConsultaDetalheCorpus {
  const autorMatch = html.match(/<b>\s*Autoria:?\s*<\/b>\s*<span>([^<]+)<\/span>/i);
  const relatorMatch = html.match(/<b>\s*Relator(?:a)?:?\s*<\/b>\s*<span>([^<]+)<\/span>/i);
  return {
    autoria: autorMatch ? stripHtml(autorMatch[1]) || null : null,
    relator: relatorMatch ? stripHtml(relatorMatch[1]) || null : null,
  };
}

/** Fetch + parse the corpus-facing consulta detail (autoria/relator). */
export async function obterConsultaDetalheCorpus(id: number): Promise<ConsultaDetalheCorpus> {
  const html = await fetchPage(`/visualizacaomateria?id=${id}`);
  return parseConsultaDetalheCorpus(html);
}

export async function listarConsultasInternal(params: { pagina?: number; limite?: number }): Promise<ConsultaResumo[]> {
  const { limite = 20 } = params;
  const data = await fetchEcidadaniaJson("/restcolecaomaismateria");

  // status is hardcoded "aberta" here because this path serves only the REST "highlight"
  // collection (/restcolecaomais*), which lists active consultations by construction. Real
  // per-item status for the full set is derived from /processo (tramitando) in the ingestion
  // job, which is the source of truth. Edge case: a just-closed highlight may briefly show
  // "aberta" until the next corpus run corrects it — acceptable on this cold-start/fallback path.
  return data.slice(0, limite).map((item: any) =>
    buildConsultaResumo({
      id: item.id,
      materia: item.identificacaoBasica || "",
      ementa: item.ementa || "",
      votosSim: parseBrNum(String(item.votosFavor || "0")),
      votosNao: parseBrNum(String(item.votosContra || "0")),
      totalVotos: parseBrNum(String(item.totalVotos || "0")),
      status: "aberta",
    }),
  );
}

export async function obterConsultaInternal(id: number) {
  const html = await fetchPage(`/visualizacaomateria?id=${id}`);
  const text = stripHtml(html);

  // Materia short code: <span> inside section.materia-identificacao, e.g. "PLP 183/2019"
  const materiaShortMatch = html.match(/class="materia-identificacao"[\s\S]*?<span>([^<]+)<\/span>/);
  const materia = materiaShortMatch ? stripHtml(materiaShortMatch[1]) : "";

  // Ementa: <b>Ementa: </b><span>...</span>
  const ementaMatch = html.match(/<b>\s*Ementa:?\s*<\/b>\s*<span>([^<]+)<\/span>/i);
  const ementa = ementaMatch ? stripHtml(ementaMatch[1]) : "";

  // Vote counts: inside <figure class="grafico-consulta-publica"><footer>
  // Note: the same classes appear in HTML comments (<!-- -->) with placeholder "10+" values.
  // We must match inside <figure>...</figure> to get the real counts.
  const figureMatch = html.match(/<figure[^>]*class="grafico-consulta-publica"[\s\S]*?<\/figure>/);
  let votosSim = 0, votosNao = 0;
  if (figureMatch) {
    const fig = figureMatch[0];
    const favorMatch = fig.match(/class="contabilizacao-favor"[^>]*>([^<]+)</);
    const contraMatch = fig.match(/class="contabilizacao-contra"[^>]*>([^<]+)</);
    if (favorMatch) votosSim = parseBrNum(favorMatch[1]);
    if (contraMatch) votosNao = parseBrNum(contraMatch[1]);
  }

  const totalVotos = votosSim + votosNao;

  // Author: <b>Autoria:</b><span>...</span>
  const autorMatch = html.match(/<b>\s*Autoria:?\s*<\/b>\s*<span>([^<]+)<\/span>/i);
  // Relator
  const relatorMatch = html.match(/<b>\s*Relator(?:a)?:?\s*<\/b>\s*<span>([^<]+)<\/span>/i);
  const comentarioMatch = text.match(/(\d+)\s*coment[aá]rio/i);
  const status = text.toLowerCase().includes("encerrad") ? "encerrada" : "aberta";

  return {
    id, materia, ementa, votosSim, votosNao, totalVotos,
    percentualSim: totalVotos > 0 ? Math.round((votosSim / totalVotos) * 100) : 0,
    percentualNao: totalVotos > 0 ? Math.round((votosNao / totalVotos) * 100) : 0,
    status,
    url: `${ECIDADANIA_BASE}/visualizacaomateria?id=${id}`,
    autor: autorMatch ? stripHtml(autorMatch[1]) : null,
    relator: relatorMatch ? stripHtml(relatorMatch[1]) : null,
    comissao: null, dataAbertura: null, dataEncerramento: null,
    comentarios: comentarioMatch ? parseInt(comentarioMatch[1]) : 0,
    linkMateria: null,
  };
}

// ── Ideias ─────────────────────────────────────────────────────────────

export interface IdeiaResumo {
  id: number; titulo: string; apoios: number;
  /** Detail-enriched fields (v2). Null until the detail crawl fills them. */
  dataPublicacao: string | null;
  /** UF do cidadão autor (SEM nome — conteúdo de cidadão). */
  autorUf: string | null;
  descricao: string | null;
  plConvertido: string | null;
  status: string; url: string;
}

/**
 * Canonical `IdeiaResumo` builder — single source of the object's field order, so the JSON payload
 * (and `contentHash`) is byte-identical across the writers into `ecidadania_current`: the 2h highlight
 * Cron (`listarIdeiasInternal`, REST source), the daily full-corpus listing job (`pesquisaideia`,
 * per-situacao status), the resumable detail backfill, and the metric splice. Diverging field order
 * would make every row read as "changed" forever, bloating `ecidadania_history`.
 *
 * v2: the four detail fields (dataPublicacao/autorUf/descricao/plConvertido) are populated by the
 * detail crawl and default to `null` so a listing-only writer stays byte-compatible. PRIVACIDADE:
 * `autorUf` is UF-only — the citizen author's name is discarded at source, never carried here.
 */
export function buildIdeiaResumo(fields: {
  id: number; titulo?: string; apoios?: number;
  dataPublicacao?: string | null; autorUf?: string | null;
  descricao?: string | null; plConvertido?: string | null;
  status?: string; url?: string;
}): IdeiaResumo {
  return {
    id: fields.id,
    titulo: fields.titulo || "",
    apoios: fields.apoios ?? 0,
    dataPublicacao: fields.dataPublicacao ?? null,
    autorUf: fields.autorUf ?? null,
    descricao: fields.descricao ?? null,
    plConvertido: fields.plConvertido ?? null,
    status: fields.status || "aberta",
    url: fields.url || `${ECIDADANIA_BASE}/visualizacaoideia?id=${fields.id}`,
  };
}

/** Campos detail-only da ideia para o corpus (v2). UF-only — SEM nome do autor cidadão. */
export interface IdeiaDetalheCorpus {
  dataPublicacao: string | null;
  autorUf: string | null;
  descricao: string | null;
  plConvertido: string | null;
}

/**
 * Pure parser of an idea detail page (`visualizacaoideia?id=`) for the CORPUS — extracts only the
 * four detail fields, keeping ONLY the UF of the citizen author (name discarded at source, never
 * returned). Distinct from `obterIdeiaInternal` (the live tool), which still surfaces the portal's
 * semi-anonymized author string; this corpus path never touches the name.
 */
export function parseIdeiaDetalheCorpus(html: string): IdeiaDetalheCorpus {
  const text = stripHtml(html);

  // "Ideia proposta por <span>NOME</span> <span>(UF)</span>" — capturamos SÓ a UF.
  const autorMatch = html.match(/Ideia proposta por<\/div>\s*<div[^>]*>\s*<span>[^<]+<\/span>\s*<span>\s*\(([A-Z]{2})\)<\/span>/);
  const autorUf = autorMatch ? autorMatch[1] : null;

  const dataMatch = html.match(/Data limite[\s\S]*?<div[^>]*>\s*(\d{2}\/\d{2}\/\d{4})\s*<\/div>/i);
  const dataPublicacao = dataMatch ? extractDate(dataMatch[1]) : null;

  const descMatch = html.match(/<b><div[^>]*>[^<]+<\/div><\/b>\s*<div[^>]*>([\s\S]*?)<\/div>/);
  const descricao = descMatch ? stripHtml(descMatch[1]).substring(0, 2000) || null : null;

  const plMatch = text.match(/(SUGEST[ÃA]O|PEC|PL|PLP)\s*n?º?\s*(\d+)\s*(?:de\s*)?(\d{4})/i);
  const plConvertido = plMatch
    ? `${plMatch[1].toUpperCase().includes("SUGEST") ? "SUG" : plMatch[1].toUpperCase()} ${plMatch[2]}/${plMatch[3]}`
    : null;

  return { dataPublicacao, autorUf, descricao, plConvertido };
}

/** Fetch + parse the corpus-facing (UF-only) idea detail. */
export async function obterIdeiaDetalheCorpus(id: number): Promise<IdeiaDetalheCorpus> {
  const html = await fetchPage(`/visualizacaoideia?id=${id}`);
  return parseIdeiaDetalheCorpus(html);
}

export async function listarIdeiasInternal(params: { status?: string; limite?: number; pagina?: number; ordenarPor?: string; ordem?: string }): Promise<IdeiaResumo[]> {
  const { limite = 20 } = params;
  const data = await fetchEcidadaniaJson("/restcolecaomaisideia");

  // status is hardcoded "aberta" (via the builder default) because this REST "highlight" collection
  // lists active ideas by construction; real per-idea status for the full set comes from the
  // per-situacao corpus crawl (the source of truth). See buildConsultaResumo for the same rationale.
  let ideias: IdeiaResumo[] = data.map((item: any) =>
    buildIdeiaResumo({
      id: item.id,
      titulo: item.titulo || "",
      apoios: parseBrNum(String(item.apoiamentos || "0")),
    }),
  );

  if (params.ordenarPor === "apoios") {
    ideias.sort((a, b) => params.ordem === "asc" ? a.apoios - b.apoios : b.apoios - a.apoios);
  }
  return ideias.slice(0, limite);
}

export async function obterIdeiaInternal(id: number) {
  const html = await fetchPage(`/visualizacaoideia?id=${id}`);
  const text = stripHtml(html);

  // Title: <b><div style="font-size:24px;...">TITLE</div></b> inside article#ideia-legislativa
  const tituloMatch = html.match(/id="ideia-legislativa"[\s\S]*?<b><div[^>]*>([^<]+)<\/div><\/b>/);
  const titulo = tituloMatch ? stripHtml(tituloMatch[1]) : "";

  // Description: first <div style="margin-bottom:15px;"> after the title that has content
  const descMatch = html.match(/<b><div[^>]*>[^<]+<\/div><\/b>\s*<div[^>]*>([\s\S]*?)<\/div>/);
  const descricao = descMatch ? stripHtml(descMatch[1]).substring(0, 2000) : "";

  // Support count: <span class="contabilizacao">17.978</span>
  const apoiosMatch = html.match(/class="contabilizacao"[^>]*>([^<]+)</);
  const apoios = apoiosMatch ? parseBrNum(apoiosMatch[1]) : 0;

  // Status: <em> inside section[title="Situação da Ideia"]
  const statusMatch = html.match(/title="Situa[çc][ãa]o da Ideia"[\s\S]*?<em>([^<]+)<\/em>/i);
  let status = "aberta";
  if (statusMatch) {
    const st = statusMatch[1].toLowerCase().trim();
    if (st.includes("convertid") || st.includes("transformad")) status = "convertida";
    else if (st.includes("encerrad")) status = "encerrada";
  }

  // Author: after "Ideia proposta por"
  const autorMatch = html.match(/Ideia proposta por<\/div>\s*<div[^>]*>\s*<span>([^<]+)<\/span>\s*<span>\s*\(([A-Z]{2})\)<\/span>/);

  // Date limit
  const dataMatch = html.match(/Data limite[\s\S]*?<div[^>]*>\s*(\d{2}\/\d{2}\/\d{4})\s*<\/div>/i);
  const dataPublicacao = dataMatch ? extractDate(dataMatch[1]) : extractDate(text);

  const comentarioMatch = text.match(/(\d+)\s*coment[aá]rio/i);
  const plMatch = text.match(/(SUGEST[ÃA]O|PEC|PL|PLP)\s*n?º?\s*(\d+)\s*(?:de\s*)?(\d{4})/i);

  return {
    id, titulo, descricao, apoios, dataPublicacao, status,
    autor: autorMatch ? `${autorMatch[1].trim()} (${autorMatch[2]})` : null,
    url: `${ECIDADANIA_BASE}/visualizacaoideia?id=${id}`,
    problema: null, solucao: null,
    comentarios: comentarioMatch ? parseInt(comentarioMatch[1]) : 0,
    dataEncerramento: null,
    plConvertido: plMatch
      ? `${plMatch[1].toUpperCase().includes("SUGEST") ? "SUG" : plMatch[1].toUpperCase()} ${plMatch[2]}/${plMatch[3]}`
      : null,
  };
}

// ── Eventos ─────────────────────────────────────────────────────────────

export interface EventoResumo {
  id: number; titulo: string; data: string | null; hora: string | null;
  comissao: string | null;
  /** Detail-enriched fields (v2). Null/[] until the detail crawl fills them. */
  comissaoNomeCompleto: string | null;
  local: string | null;
  descricao: string | null;
  pauta: string[];
  convidados: string[];
  videoUrl: string | null;
  /** Canonical AJAX comment count (v2). Volatile — recounted every crawl cycle. */
  comentarios: number;
  status: string; url: string;
}

/**
 * Canonical `EventoResumo` builder — single source of the object's field order, so the JSON payload
 * (and `contentHash`) is byte-identical across the writers into `ecidadania_current`: the 2h
 * highlight Cron (`listarEventosInternal`, REST source), the daily full-corpus ingestion job (HTML
 * listing + detail + AJAX comments), and the metric splice. Diverging field order would make every
 * row read as "changed" forever, bloating `ecidadania_history`.
 *
 * v2: `data`/`hora` are the DETAIL-canonical values (estudo A3); `comentarios` is the canonical AJAX
 * count. The six detail fields (comissaoNomeCompleto/local/descricao/pauta/convidados/videoUrl) are
 * populated by the detail crawl and default to null/[] so a listing-only writer stays byte-compatible.
 */
export function buildEventoResumo(fields: {
  id: number; titulo?: string; data?: string | null; hora?: string | null;
  comissao?: string | null;
  comissaoNomeCompleto?: string | null; local?: string | null; descricao?: string | null;
  pauta?: string[]; convidados?: string[]; videoUrl?: string | null;
  comentarios?: number; status?: string; url?: string;
}): EventoResumo {
  return {
    id: fields.id,
    titulo: fields.titulo || "",
    data: fields.data ?? null,
    hora: fields.hora ?? null,
    comissao: fields.comissao ?? null,
    comissaoNomeCompleto: fields.comissaoNomeCompleto ?? null,
    local: fields.local ?? null,
    descricao: fields.descricao ?? null,
    pauta: fields.pauta ?? [],
    convidados: fields.convidados ?? [],
    videoUrl: fields.videoUrl ?? null,
    comentarios: fields.comentarios ?? 0,
    status: fields.status || "agendado",
    url: fields.url || `${ECIDADANIA_BASE}/visualizacaoaudiencia?id=${fields.id}`,
  };
}

export async function listarEventosInternal(params: { status?: string; comissao?: string; limite?: number }): Promise<EventoResumo[]> {
  const { limite = 20 } = params;
  const data = await fetchEcidadaniaJson("/restcolecaomaisaudiencia");

  // Parse date from "DD/MM/YY HH:MM" format
  let eventos: EventoResumo[] = data.map((item: any) => {
    const dp = item.dataPublicacao || "";
    const dateMatch = dp.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
    const timeMatch = dp.match(/(\d{2}):(\d{2})/);
    const year = dateMatch ? (dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3]) : null;
    const dataStr = dateMatch ? `${year}-${dateMatch[2]}-${dateMatch[1]}` : null;
    const horaStr = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : null;

    // situacaoAudienciaId: 2 = agendado, 3 = realizado/encerrado
    let status = "agendado";
    if (item.situacaoAudienciaId === 3 || item.situacaoAudienciaId === 4) status = "encerrado";

    return buildEventoResumo({
      id: item.id,
      titulo: item.titulo || item.tituloAbreviado || "",
      data: dataStr,
      hora: horaStr,
      comissao: item.sigla || null,
      comentarios: item.qtdComentario || 0,
      status,
    });
  });

  if (params.status && params.status !== "todos") eventos = eventos.filter((e) => e.status === params.status);
  if (params.comissao) {
    const s = params.comissao.toUpperCase();
    eventos = eventos.filter((e) => e.comissao?.toUpperCase().includes(s));
  }
  return eventos.slice(0, limite);
}

// ── Consultas (votos históricos / acervo Arquimedes) ────────────────────────

/** Votos por UF de uma matéria (diferencial regional do acervo histórico). */
export type VotosPorUf = Record<string, { sim: number; nao: number }>;

export interface ConsultaVotoResumo {
  id: number; materia: string; ementa: string; autoria: string; status: string;
  votosSim: number; votosNao: number; totalVotos: number;
  votosPorUf: VotosPorUf; url: string;
  /** Carimbo "dados atualizados até" do CSV (vintage). EXCLUÍDO do contentHash — ver consultaVotoCore. */
  referencePeriod: string | null;
}

/**
 * Canonical `ConsultaVotoResumo` builder — único writer é o job semanal do CSV Arquimedes (não há
 * fonte REST nem splice de 2h para esta entidade), mas o builder fixa a ordem dos campos para que o
 * `contentHash` seja estável entre execuções (history-on-change). `votosPorUf` deve chegar com chaves
 * já ordenadas (o agregador ordena) para o JSON ser determinístico.
 *
 * `totalVotos` é sempre derivado de `votosSim + votosNao`. `referencePeriod` é o vintage do CSV e fica
 * por ÚLTIMO de propósito: `consultaVotoCore` o remove antes do hash, de modo que um bump semanal do
 * carimbo sobre votos arquivados (congelados) NÃO gere ruído em `ecidadania_history`.
 */
export function buildConsultaVotoResumo(fields: {
  id: number; materia?: string; ementa?: string; autoria?: string; status?: string;
  votosSim: number; votosNao: number;
  votosPorUf?: VotosPorUf; url?: string; referencePeriod?: string | null;
}): ConsultaVotoResumo {
  const votosSim = fields.votosSim;
  const votosNao = fields.votosNao;
  return {
    id: fields.id,
    materia: fields.materia || "",
    ementa: fields.ementa || "",
    autoria: fields.autoria || "",
    status: fields.status || "Descontinuado",
    votosSim,
    votosNao,
    totalVotos: votosSim + votosNao,
    votosPorUf: fields.votosPorUf ?? {},
    url: fields.url || `${ECIDADANIA_BASE}/visualizacaomateria?id=${fields.id}`,
    referencePeriod: fields.referencePeriod ?? null,
  };
}

/**
 * Vote-relevant core of a `ConsultaVotoResumo` — everything EXCEPT `referencePeriod` (the CSV vintage
 * stamp). The corpus job hashes THIS (not the full payload), so a weekly stamp change on otherwise
 * unchanged archival votes does not append a junk `ecidadania_history` row. The stored `payload_json`
 * still carries `referencePeriod` (the tool reports it as the provenance vintage).
 */
export function consultaVotoCore(v: ConsultaVotoResumo): Omit<ConsultaVotoResumo, "referencePeriod"> {
  const { referencePeriod: _omit, ...core } = v;
  return core;
}

/** Campos extraídos da página de detalhe de uma audiência (`visualizacaoaudiencia`). Puro. */
export interface EventoDetalhe {
  titulo: string;
  descricao: string | null;
  data: string | null;
  hora: string | null;
  comissao: string | null;
  comissaoNomeCompleto: string | null;
  local: string | null;
  status: string;
  pauta: string[];
  convidados: string[];
  videoUrl: string | null;
}

/**
 * Pure parser of an event detail page (`visualizacaoaudiencia?id=`). Extracted from
 * `obterEventoInternal` so both the live detail tool and the corpus detail crawl (v2) share one
 * tested parser. `data`/`hora` here are the CANONICAL values (estudo A3). NOTE: the comment count is
 * NOT in this HTML (the `#comentarios` container is populated by AJAX) — use
 * `parseComentariosAudiencia` / `contarComentariosAudiencia` for the canonical count.
 */
export function parseEventoDetalhe(html: string): EventoDetalhe {
  // Title: <div class="audiencia-titulo">...</div>
  const tituloMatch = html.match(/class="audiencia-titulo"[^>]*>([^<]+)</);
  const titulo = tituloMatch ? stripHtml(tituloMatch[1]) : "";

  // Description/Finalidade: <div class="audiencia-finalidade">...</div>
  const descMatch = html.match(/class="audiencia-finalidade"[^>]*>([^<]+)</);
  const descricao = descMatch ? stripHtml(descMatch[1]) || null : null;

  // Date/time from <span class="audiencia-data">23/02/2026 - 10:00</span>
  const dataTagMatch = html.match(/class="audiencia-data"[^>]*>([^<]+)</);
  const dataTimeStr = dataTagMatch ? dataTagMatch[1] : "";
  const data = extractDate(dataTimeStr);
  const hora = extractTime(dataTimeStr);

  // Committee abbreviation: second <span class="audiencia-tag">
  const tagRegex = /class="audiencia-tag"[^>]*>([^<]+)</g;
  const tags: string[] = [];
  let tagMatch;
  while ((tagMatch = tagRegex.exec(html)) !== null) tags.push(tagMatch[1].trim());
  const comissaoAbrev = tags.length >= 2 ? tags[1] : null; // second tag is committee

  // Committee full name from <div class="audiencia-comissao">
  const comissaoFullMatch = html.match(/class="audiencia-comissao"[^>]*>([^<]+)</);
  const comissaoFull = comissaoFullMatch ? stripHtml(comissaoFullMatch[1]) || null : null;

  // Local
  const localMatch = html.match(/class="audiencia-local"[^>]*>([^<]+)</);
  const local = localMatch ? stripHtml(localMatch[1]) || null : null;

  // Status from class on #audiencia div: situacao-audiencia-AGENDADO / REALIZADO / CANCELADO
  const statusClassMatch = html.match(/class="situacao-audiencia-([A-Z]+)"/);
  let status = "agendado";
  if (statusClassMatch) {
    const st = statusClassMatch[1].toUpperCase();
    if (st === "REALIZADO" || st === "ENCERRADO") status = "encerrado";
    else if (st === "CANCELADO") status = "cancelado";
  } else {
    // Fallback: check status tag
    const statusTag = tags.find((t) => /agendad|realizad|encerrad|cancelad/i.test(t));
    if (statusTag?.toLowerCase().includes("realizad") || statusTag?.toLowerCase().includes("encerrad")) status = "encerrado";
  }

  // Convidados: <p class="titulo-convidados"><span>NAME</span></p> (nomes públicos — mantidos)
  const convidados: string[] = [];
  const convRegex = /class="titulo-convidados"[^>]*>\s*<span>([^<]+)<\/span>/g;
  let convMatch;
  while ((convMatch = convRegex.exec(html)) !== null) convidados.push(convMatch[1].trim());

  // Video URL from YouTube embed
  const videoMatch = html.match(/src="(https?:\/\/www\.youtube\.com\/embed\/[^"?]+)/);
  const videoUrl = videoMatch ? videoMatch[1] : null;

  // Pauta: <div class="audiencia-pauta">...</div>
  const pautaMatch = html.match(/class="audiencia-pauta"[^>]*>([\s\S]*?)<\/div>/);
  const pauta = pautaMatch
    ? stripHtml(pautaMatch[1]).split(/[;\n]/).map((s) => s.trim()).filter((s) => s.length > 5).slice(0, 15)
    : [];

  return {
    titulo, descricao, data, hora,
    comissao: comissaoAbrev || comissaoFull,
    comissaoNomeCompleto: comissaoFull,
    local, status, pauta, convidados, videoUrl,
  };
}

export async function obterEventoInternal(id: number) {
  const html = await fetchPage(`/visualizacaoaudiencia?id=${id}`);
  const d = parseEventoDetalhe(html);
  const comentarioMatch = stripHtml(html).match(/(\d+)\s*coment[aá]rio/i);

  return {
    id,
    titulo: d.titulo,
    descricao: d.descricao ?? "",
    data: d.data,
    hora: d.hora,
    comissao: d.comissao,
    comissaoNomeCompleto: d.comissaoNomeCompleto,
    local: d.local,
    comentarios: comentarioMatch ? parseInt(comentarioMatch[1]) : 0,
    status: d.status,
    url: `${ECIDADANIA_BASE}/visualizacaoaudiencia?id=${id}`,
    pauta: d.pauta,
    convidados: d.convidados,
    videoUrl: d.videoUrl,
    documentos: [] as string[],
  };
}

/** Fetch + parse the corpus-facing event detail (canonical data/hora + v2 detail fields). */
export async function obterEventoDetalhe(id: number): Promise<EventoDetalhe> {
  const html = await fetchPage(`/visualizacaoaudiencia?id=${id}`);
  return parseEventoDetalhe(html);
}

// ── Eventos: comentários (nível-comentário, fragmento AJAX) ─────────────────
// A contagem CANÔNICA de comentários e o nível-comentário vêm do fragmento AJAX
// `ajaxcolecaocomentarioaudiencia?audienciaId={id}` — o container `#comentarios` da página de
// detalhe é vazio no HTML (populado por JS). Estudo A3: a listagem tinha 0 espúrio em 82% dos
// eventos. PRIVACIDADE: extraímos SÓ a UF; o nome do comentarista é descartado NA ORIGEM.

/** Um comentário de audiência (nível-comentário). SEM o nome do comentarista (só UF). */
export interface ComentarioAudiencia {
  comentarioId: number;
  /** UF do comentarista (só a sigla; o nome é descartado na origem). */
  uf: string | null;
  texto: string;
  data: string | null;
  hora: string | null;
  /** Presente só em comentários ancorados a um momento do vídeo. */
  momentoVideoUrl: string | null;
  /** Convidado (público) associado ao momento, quando houver. */
  convidadoAssociado: string | null;
}

/** Converte "HHhMM" (ex.: "07h27") em "HH:MM". */
function parseHoraComentario(text: string): string | null {
  const m = text.match(/(\d{1,2})h(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/**
 * Pure parser of the AJAX comment fragment. One `ComentarioAudiencia` per
 * `<div class="comentario" ... data-id="N">` block. UF-only (name discarded at source).
 * `momentoVideoUrl`/`convidadoAssociado` are best-effort (present only on video-anchored comments).
 */
export function parseComentariosAudiencia(html: string): ComentarioAudiencia[] {
  const blocks = html.split(/<div class="comentario"/i).slice(1);
  const out: ComentarioAudiencia[] = [];
  for (const block of blocks) {
    const idMatch = block.match(/data-id="(\d+)"/) || block.match(/id="comentario-(\d+)"/);
    if (!idMatch) continue;
    const comentarioId = parseInt(idMatch[1], 10);

    // titulo-comentarios: "NOME (UF)" — mantemos SÓ a UF; o nome é descartado.
    const tituloMatch = block.match(/class="titulo-comentarios"[^>]*>([\s\S]*?)<\/div>/i);
    const tituloRaw = tituloMatch ? stripHtml(tituloMatch[1]) : "";
    const ufMatch = tituloRaw.match(/\(([A-Z]{2})\)\s*$/);
    const uf = ufMatch ? ufMatch[1] : null;

    const textoMatch = block.match(/class="texto-comentarios"[^>]*>([\s\S]*?)<\/div>/i);
    const texto = textoMatch ? stripHtml(textoMatch[1]) : "";

    const horadataMatch = block.match(/class="horadata-comentarios"[^>]*>([\s\S]*?)<\/div>/i);
    const horadataRaw = horadataMatch ? stripHtml(horadataMatch[1]) : "";
    const data = extractDate(horadataRaw);
    const hora = parseHoraComentario(horadataRaw);

    // Momento do vídeo (best-effort; presente só em comentários ancorados a um instante).
    const momentoLinkMatch = block.match(/class="momento-por-link"[^>]*href="([^"]+)"/i)
      || block.match(/class="momento-comentario"[^>]*href="([^"]+)"/i);
    const momentoVideoUrl = momentoLinkMatch ? momentoLinkMatch[1] : null;

    // Convidado associado (público — nome mantido), quando houver.
    const convNomeMatch = block.match(/class="momento-convidado-nome"[^>]*>([\s\S]*?)<\/[a-z]+>/i);
    const convCargoMatch = block.match(/class="momento-convidado-cargo"[^>]*>([\s\S]*?)<\/[a-z]+>/i);
    const convNome = convNomeMatch ? stripHtml(convNomeMatch[1]) : "";
    const convCargo = convCargoMatch ? stripHtml(convCargoMatch[1]) : "";
    const convidadoAssociado = convNome || convCargo
      ? [convNome, convCargo].filter(Boolean).join(" — ") || null
      : null;

    out.push({ comentarioId, uf, texto, data, hora, momentoVideoUrl, convidadoAssociado });
  }
  return out;
}

/** Fetch the AJAX comment fragment of an audiência (Worker-safe). */
export async function fetchComentariosAudienciaHtml(id: number): Promise<string> {
  return fetchPage(`/ajaxcolecaocomentarioaudiencia?audienciaId=${id}`, { ajax: true, allowEmpty: true });
}

/** Fetch + parse the comments of an audiência (nível-comentário). UF-only. */
export async function obterComentariosAudiencia(id: number): Promise<ComentarioAudiencia[]> {
  const html = await fetchComentariosAudienciaHtml(id);
  return parseComentariosAudiencia(html);
}

/** Canonical comment count of an audiência = number of comment blocks in the AJAX fragment. */
export async function contarComentariosAudiencia(id: number): Promise<number> {
  return (await obterComentariosAudiencia(id)).length;
}

/**
 * Build the ENRICHED (v2) `EventoResumo` for the corpus: detail-canonical `data`/`hora`, the six new
 * detail fields, and the canonical AJAX comment count. Detail overrides the listing (estudo A3), with
 * the listing kept as a fallback for rows not yet detail-enriched. Centralized so the fallback rules
 * live in one tested place and every writer produces byte-identical payloads.
 */
export function buildEventoResumoEnriquecido(fields: {
  id: number;
  titulo?: string;
  comissao?: string | null;
  status?: string;
  /** Listing-derived provisional date/time (fallback when the detail lacks them). */
  dataListagem?: string | null;
  horaListagem?: string | null;
  comentariosListagem?: number;
  detalhe?: EventoDetalhe | null;
  /** Canonical AJAX comment count; when null, falls back to the listing count. */
  comentariosCanon?: number | null;
}): EventoResumo {
  const d = fields.detalhe ?? null;
  return buildEventoResumo({
    id: fields.id,
    titulo: d?.titulo || fields.titulo,
    data: d?.data ?? fields.dataListagem ?? null,
    hora: d?.hora ?? fields.horaListagem ?? null,
    comissao: fields.comissao ?? d?.comissao ?? null,
    comissaoNomeCompleto: d?.comissaoNomeCompleto ?? null,
    local: d?.local ?? null,
    descricao: d?.descricao ?? null,
    pauta: d?.pauta ?? [],
    convidados: d?.convidados ?? [],
    videoUrl: d?.videoUrl ?? null,
    comentarios: fields.comentariosCanon ?? fields.comentariosListagem ?? 0,
    status: fields.status ?? d?.status,
  });
}
