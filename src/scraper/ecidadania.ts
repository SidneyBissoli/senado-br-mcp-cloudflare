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

export const ECIDADANIA_BASE = "https://www12.senado.leg.br/ecidadania";

/** Fetch an HTML page from e-Cidadania with descriptive errors. */
export async function fetchPage(path: string): Promise<string> {
  const url = `${ECIDADANIA_BASE}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: {
        Accept: "text/html",
        "User-Agent": "senado-br-mcp/2.2.0",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`e-Cidadania retornou HTTP ${resp.status} para ${path}`);
    const text = await resp.text();
    if (!text.trim()) throw new Error(`e-Cidadania retornou página vazia para ${path}`);
    return text;
  } catch (e) {
    clearTimeout(timeout);
    if ((e as Error).name === "AbortError") {
      throw new Error(`e-Cidadania: timeout (${UPSTREAM_TIMEOUT_MS / 1000}s) ao acessar ${path}`);
    }
    throw e;
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
      headers: { Accept: "application/json", "User-Agent": "senado-br-mcp/2.2.0" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`e-Cidadania REST API retornou HTTP ${resp.status} para ${endpoint}`);

    let data: unknown;
    try {
      data = await resp.json();
    } catch {
      throw new Error(`e-Cidadania REST API retornou JSON inválido para ${endpoint}`);
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
      throw new Error(`e-Cidadania REST API: timeout (${UPSTREAM_TIMEOUT_MS / 1000}s) ao acessar ${endpoint}`);
    }
    throw e;
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
    status: fields.status || "aberta",
    url: fields.url || `${ECIDADANIA_BASE}/visualizacaomateria?id=${fields.id}`,
  };
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
  dataPublicacao: string | null; status: string; autor: string | null; url: string;
}

/**
 * Canonical `IdeiaResumo` builder — single source of the object's field order, so the JSON payload
 * (and `contentHash`) is byte-identical across the three writers into `ecidadania_current`: the 2h
 * highlight Cron (`listarIdeiasInternal`, REST source), the weekly full-corpus ingestion job
 * (`pesquisaideia` HTML listing, per-situacao status), and the metric splice. Diverging field order
 * would make every row read as "changed" forever, bloating `ecidadania_history`.
 *
 * `autor` and `dataPublicacao` are detail-only (the listing/REST sources never carry them), so they
 * default to `null` here — keep them out of the corpus payload to stay byte-compatible with the
 * highlight scrape, which also has only id/titulo/apoios/status.
 */
export function buildIdeiaResumo(fields: {
  id: number; titulo?: string; apoios?: number;
  dataPublicacao?: string | null; status?: string; autor?: string | null; url?: string;
}): IdeiaResumo {
  return {
    id: fields.id,
    titulo: fields.titulo || "",
    apoios: fields.apoios ?? 0,
    dataPublicacao: fields.dataPublicacao ?? null,
    status: fields.status || "aberta",
    autor: fields.autor ?? null,
    url: fields.url || `${ECIDADANIA_BASE}/visualizacaoideia?id=${fields.id}`,
  };
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
  comissao: string | null; comentarios: number; status: string; url: string;
}

/**
 * Canonical `EventoResumo` builder — single source of the object's field order, so the JSON payload
 * (and `contentHash`) is byte-identical across the three writers into `ecidadania_current`: the 2h
 * highlight Cron (`listarEventosInternal`, REST source), the weekly full-corpus ingestion job (HTML
 * listing source), and the metric splice. Diverging field order would make every row read as
 * "changed" forever, bloating `ecidadania_history`.
 */
export function buildEventoResumo(fields: {
  id: number; titulo?: string; data?: string | null; hora?: string | null;
  comissao?: string | null; comentarios?: number; status?: string; url?: string;
}): EventoResumo {
  return {
    id: fields.id,
    titulo: fields.titulo || "",
    data: fields.data ?? null,
    hora: fields.hora ?? null,
    comissao: fields.comissao ?? null,
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

export async function obterEventoInternal(id: number) {
  const html = await fetchPage(`/visualizacaoaudiencia?id=${id}`);

  // Title: <div class="audiencia-titulo">...</div>
  const tituloMatch = html.match(/class="audiencia-titulo"[^>]*>([^<]+)</);
  const titulo = tituloMatch ? stripHtml(tituloMatch[1]) : "";

  // Description/Finalidade: <div class="audiencia-finalidade">...</div>
  const descMatch = html.match(/class="audiencia-finalidade"[^>]*>([^<]+)</);
  const descricao = descMatch ? stripHtml(descMatch[1]) : "";

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
  const comissaoFull = comissaoFullMatch ? stripHtml(comissaoFullMatch[1]) : null;

  // Local
  const localMatch = html.match(/class="audiencia-local"[^>]*>([^<]+)</);
  const local = localMatch ? stripHtml(localMatch[1]) : null;

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

  // Convidados: <p class="titulo-convidados"><span>NAME</span></p>
  const convidados: string[] = [];
  const convRegex = /class="titulo-convidados"[^>]*>\s*<span>([^<]+)<\/span>/g;
  let convMatch;
  while ((convMatch = convRegex.exec(html)) !== null) convidados.push(convMatch[1].trim());

  // Video URL from YouTube embed
  const videoMatch = html.match(/src="(https?:\/\/www\.youtube\.com\/embed\/[^"?]+)/);
  const videoUrl = videoMatch ? videoMatch[1] : null;

  // Pauta: <div class="audiencia-pauta">...</div>
  const pautaMatch = html.match(/class="audiencia-pauta"[^>]*>([\s\S]*?)<\/div>/);
  const pauta = pautaMatch ? stripHtml(pautaMatch[1]).split(/[;\n]/).map((s) => s.trim()).filter((s) => s.length > 5) : [];

  const comentarioMatch = stripHtml(html).match(/(\d+)\s*coment[aá]rio/i);

  return {
    id, titulo, descricao, data, hora,
    comissao: comissaoAbrev || comissaoFull,
    comissaoNomeCompleto: comissaoFull,
    local,
    comentarios: comentarioMatch ? parseInt(comentarioMatch[1]) : 0,
    status,
    url: `${ECIDADANIA_BASE}/visualizacaoaudiencia?id=${id}`,
    pauta: pauta.slice(0, 15),
    convidados,
    videoUrl,
    documentos: [] as string[],
  };
}
