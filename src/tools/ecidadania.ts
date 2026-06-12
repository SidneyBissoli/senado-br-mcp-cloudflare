/**
 * Group G — e-Cidadania (11 tools)
 * Web scraping via fetch + regex (no cheerio — Workers compatible)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { toolResult, toolError } from "../utils/validation.js";
import { CACHE_DYNAMIC, CACHE_ON_DEMAND, UPSTREAM_TIMEOUT_MS } from "../types.js";

export const ECIDADANIA_BASE = "https://www12.senado.leg.br/ecidadania";

/** Fetch an HTML page from e-Cidadania with descriptive errors. */
async function fetchPage(path: string): Promise<string> {
  const url = `${ECIDADANIA_BASE}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: {
        Accept: "text/html",
        "User-Agent": "senado-br-mcp/2.0.0",
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
async function fetchEcidadaniaJson(endpoint: string): Promise<any[]> {
  const url = `${ECIDADANIA_BASE}${endpoint}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "senado-br-mcp/2.0.0" },
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

interface ConsultaResumo {
  id: number; materia: string; ementa: string;
  votosSim: number; votosNao: number; totalVotos: number;
  percentualSim: number; percentualNao: number;
  status: string; url: string;
}

export async function listarConsultasInternal(params: { pagina?: number; limite?: number }): Promise<ConsultaResumo[]> {
  const { limite = 20 } = params;
  const data = await fetchEcidadaniaJson("/restcolecaomaismateria");

  return data.slice(0, limite).map((item: any) => {
    const votosSim = parseBrNum(String(item.votosFavor || "0"));
    const votosNao = parseBrNum(String(item.votosContra || "0"));
    const totalVotos = parseBrNum(String(item.totalVotos || "0"));
    const percentualSim = totalVotos > 0 ? Math.round((votosSim / totalVotos) * 100) : 0;
    const percentualNao = totalVotos > 0 ? Math.round((votosNao / totalVotos) * 100) : 0;
    return {
      id: item.id,
      materia: item.identificacaoBasica || "",
      ementa: item.ementa || "",
      votosSim, votosNao, totalVotos, percentualSim, percentualNao,
      status: "aberta" as const,
      url: `${ECIDADANIA_BASE}/visualizacaomateria?id=${item.id}`,
    };
  });
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

interface IdeiaResumo {
  id: number; titulo: string; apoios: number;
  dataPublicacao: string | null; status: string; autor: string | null; url: string;
}

export async function listarIdeiasInternal(params: { status?: string; limite?: number; pagina?: number; ordenarPor?: string; ordem?: string }): Promise<IdeiaResumo[]> {
  const { limite = 20 } = params;
  const data = await fetchEcidadaniaJson("/restcolecaomaisideia");

  let ideias: IdeiaResumo[] = data.map((item: any) => ({
    id: item.id,
    titulo: item.titulo || "",
    apoios: parseBrNum(String(item.apoiamentos || "0")),
    dataPublicacao: null,
    status: "aberta" as const,
    autor: null,
    url: `${ECIDADANIA_BASE}/visualizacaoideia?id=${item.id}`,
  }));

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

interface EventoResumo {
  id: number; titulo: string; data: string | null; hora: string | null;
  comissao: string | null; comentarios: number; status: string; url: string;
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

    return {
      id: item.id,
      titulo: item.titulo || item.tituloAbreviado || "",
      data: dataStr,
      hora: horaStr,
      comissao: item.sigla || null,
      comentarios: item.qtdComentario || 0,
      status,
      url: `${ECIDADANIA_BASE}/visualizacaoaudiencia?id=${item.id}`,
    };
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

// ══════════════════════════════════════════════════════════════════════════
// Tool registration
// ══════════════════════════════════════════════════════════════════════════

export function registerECidadaniaTools(server: McpServer, _baseUrl: string) {
  function ecidadaniaError(e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro ao acessar e-Cidadania";
    const retryable = e instanceof Error && "retryable" in e && typeof (e as any).retryable === "boolean"
      ? (e as any).retryable
      : false;
    return toolError(`${msg}. As demais funcionalidades (senadores, matérias, votações) continuam operacionais.`, retryable);
  }

  // G1. senado_ecidadania_listar_consultas
  server.tool(
    "senado_ecidadania_listar_consultas",
    "Lista consultas públicas do e-Cidadania com votação cidadã sobre matérias em tramitação.",
    {
      status: z.enum(["aberta", "encerrada", "todas"]).optional().describe("Filtrar por status"),
      limite: z.number().int().min(1).max(100).optional().default(20).describe("Número máximo de resultados"),
      pagina: z.number().int().min(1).optional().default(1).describe("Página de resultados"),
    },
    async (params) => {
      try {
        const all = await cachedFetch("ecidadania_consultas", { p: params.pagina }, CACHE_DYNAMIC, () =>
          listarConsultasInternal({ pagina: params.pagina, limite: 100 }),
        );
        let filtered = all as ConsultaResumo[];
        if (params.status && params.status !== "todas") filtered = filtered.filter((c) => c.status === params.status);
        return toolResult({ count: filtered.slice(0, params.limite).length, consultas: filtered.slice(0, params.limite) });
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G2. senado_ecidadania_obter_consulta
  server.tool(
    "senado_ecidadania_obter_consulta",
    "Obtém detalhes de uma consulta pública específica, incluindo votos, autor e comentários.",
    { id: z.number().int().positive().describe("ID da consulta pública") },
    async (params) => {
      try {
        const r = await cachedFetch("ecidadania_consulta", { id: params.id }, CACHE_ON_DEMAND, () =>
          obterConsultaInternal(params.id),
        );
        return toolResult(r);
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G3. senado_ecidadania_consultas_consensuais
  server.tool(
    "senado_ecidadania_consultas_consensuais",
    "Retorna consultas com alta concordância (>85% em uma direção), útil para identificar temas de consenso.",
    {
      percentualMinimo: z.number().int().min(50).max(100).optional().default(85).describe("Percentual mínimo em uma direção"),
      minimoVotos: z.number().int().min(0).optional().default(1000).describe("Mínimo de votos para considerar"),
      limite: z.number().int().min(1).max(50).optional().default(10).describe("Número máximo de resultados"),
    },
    async (params) => {
      try {
        const all = await cachedFetch("ecidadania_consultas_full", {}, CACHE_DYNAMIC, () =>
          listarConsultasInternal({ limite: 100 }),
        );
        const filtered = (all as ConsultaResumo[])
          .filter((c) => c.totalVotos >= (params.minimoVotos ?? 1000) && Math.max(c.percentualSim, c.percentualNao) >= (params.percentualMinimo ?? 85))
          .sort((a, b) => Math.max(b.percentualSim, b.percentualNao) - Math.max(a.percentualSim, a.percentualNao))
          .slice(0, params.limite);
        return toolResult({
          criterio: `>${params.percentualMinimo}% em uma direção, mínimo ${params.minimoVotos} votos`,
          count: filtered.length, consultas: filtered,
        });
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G4. senado_ecidadania_consultas_polarizadas
  server.tool(
    "senado_ecidadania_consultas_polarizadas",
    "Retorna consultas com votação equilibrada (~50/50), útil para identificar temas polarizados na sociedade.",
    {
      margemPolarizacao: z.number().int().min(0).max(50).optional().default(15).describe("Considera polarizado se diferença < este percentual"),
      minimoVotos: z.number().int().min(0).optional().default(1000).describe("Mínimo de votos para considerar"),
      limite: z.number().int().min(1).max(50).optional().default(10).describe("Número máximo de resultados"),
    },
    async (params) => {
      try {
        const all = await cachedFetch("ecidadania_consultas_full", {}, CACHE_DYNAMIC, () =>
          listarConsultasInternal({ limite: 100 }),
        );
        const filtered = (all as ConsultaResumo[])
          .filter((c) => c.totalVotos >= (params.minimoVotos ?? 1000) && Math.abs(c.percentualSim - c.percentualNao) <= (params.margemPolarizacao ?? 15))
          .sort((a, b) => Math.abs(a.percentualSim - a.percentualNao) - Math.abs(b.percentualSim - b.percentualNao))
          .slice(0, params.limite);
        return toolResult({
          criterio: `Diferença sim/não < ${params.margemPolarizacao}%, mínimo ${params.minimoVotos} votos`,
          count: filtered.length, consultas: filtered,
        });
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G5. senado_ecidadania_listar_ideias
  server.tool(
    "senado_ecidadania_listar_ideias",
    "Lista ideias legislativas propostas por cidadãos no e-Cidadania.",
    {
      status: z.enum(["aberta", "encerrada", "convertida", "todas"]).optional().describe("Filtrar por status"),
      ordenarPor: z.enum(["apoios", "data", "comentarios"]).optional().describe("Campo para ordenação"),
      ordem: z.enum(["asc", "desc"]).optional().describe("Ordem de ordenação"),
      limite: z.number().int().min(1).max(100).optional().default(20).describe("Número máximo de resultados"),
      pagina: z.number().int().min(1).optional().default(1).describe("Página de resultados"),
    },
    async (params) => {
      try {
        const ideias = await cachedFetch("ecidadania_ideias", params, CACHE_DYNAMIC, () =>
          listarIdeiasInternal(params),
        );
        return toolResult({ count: (ideias as IdeiaResumo[]).length, ideias });
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G6. senado_ecidadania_obter_ideia
  server.tool(
    "senado_ecidadania_obter_ideia",
    "Obtém detalhes de uma ideia legislativa, incluindo descrição completa, apoios e se foi convertida em PL.",
    { id: z.number().int().positive().describe("ID da ideia legislativa") },
    async (params) => {
      try {
        const r = await cachedFetch("ecidadania_ideia", { id: params.id }, CACHE_ON_DEMAND, () =>
          obterIdeiaInternal(params.id),
        );
        return toolResult(r);
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G7. senado_ecidadania_ideias_populares
  server.tool(
    "senado_ecidadania_ideias_populares",
    "Retorna as ideias legislativas mais apoiadas pelos cidadãos.",
    {
      limite: z.number().int().min(1).max(50).optional().default(10).describe("Número máximo de resultados"),
      apenasAbertas: z.boolean().optional().default(true).describe("Apenas ideias com apoiamento aberto"),
    },
    async (params) => {
      try {
        const ideias = await cachedFetch("ecidadania_ideias_pop", params, CACHE_DYNAMIC, () =>
          listarIdeiasInternal({
            status: params.apenasAbertas ? "aberta" : "todas",
            ordenarPor: "apoios",
            ordem: "desc",
            limite: (params.limite ?? 10) * 2,
          }),
        );
        const result = (ideias as IdeiaResumo[]).slice(0, params.limite);
        return toolResult({
          criterio: params.apenasAbertas ? "Ideias abertas mais apoiadas" : "Todas as ideias mais apoiadas",
          count: result.length, ideias: result,
        });
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G8. senado_ecidadania_listar_eventos
  server.tool(
    "senado_ecidadania_listar_eventos",
    "Lista eventos interativos (audiências públicas, sabatinas, lives) do e-Cidadania.",
    {
      status: z.enum(["agendado", "encerrado", "todos"]).optional().describe("Filtrar por status"),
      comissao: z.string().optional().describe("Sigla da comissão"),
      limite: z.number().int().min(1).max(100).optional().default(20).describe("Número máximo de resultados"),
    },
    async (params) => {
      try {
        const eventos = await cachedFetch("ecidadania_eventos", params, CACHE_DYNAMIC, () =>
          listarEventosInternal(params),
        );
        return toolResult({ count: (eventos as EventoResumo[]).length, eventos });
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G9. senado_ecidadania_obter_evento
  server.tool(
    "senado_ecidadania_obter_evento",
    "Obtém detalhes de um evento interativo, incluindo pauta, convidados e link para vídeo.",
    { id: z.number().int().positive().describe("ID do evento") },
    async (params) => {
      try {
        const r = await cachedFetch("ecidadania_evento", { id: params.id }, CACHE_ON_DEMAND, () =>
          obterEventoInternal(params.id),
        );
        return toolResult(r);
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G10. senado_ecidadania_eventos_populares
  server.tool(
    "senado_ecidadania_eventos_populares",
    "Retorna eventos com mais comentários e perguntas dos cidadãos.",
    {
      limite: z.number().int().min(1).max(50).optional().default(10).describe("Número máximo de resultados"),
      apenasAgendados: z.boolean().optional().default(false).describe("Apenas eventos ainda não realizados"),
    },
    async (params) => {
      try {
        const eventos = await cachedFetch("ecidadania_eventos_pop", params, CACHE_DYNAMIC, () =>
          listarEventosInternal({
            status: params.apenasAgendados ? "agendado" : "todos",
            limite: (params.limite ?? 10) * 2,
          }),
        );
        const sorted = (eventos as EventoResumo[])
          .sort((a, b) => b.comentarios - a.comentarios)
          .slice(0, params.limite);
        return toolResult({
          criterio: params.apenasAgendados ? "Eventos agendados mais comentados" : "Eventos mais comentados",
          count: sorted.length, eventos: sorted,
        });
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G11. senado_ecidadania_sugerir_tema_enquete
  server.tool(
    "senado_ecidadania_sugerir_tema_enquete",
    "Analisa e sugere temas para enquete mensal baseado em critérios configuráveis. Evita temas muito polarizados ou com consenso total.",
    {
      criterios: z.object({
        evitarPolarizacao: z.boolean().optional().default(true).describe("Evita temas com ~50/50"),
        evitarConsenso: z.boolean().optional().default(true).describe("Evita temas com >85%"),
        minimoParticipacao: z.number().int().min(0).optional().default(500).describe("Mínimo de votos/apoios"),
        apenasEmTramitacao: z.boolean().optional().default(true).describe("Apenas matérias em tramitação"),
      }).optional(),
    },
    async (params) => {
      try {
        const criterios = params.criterios || {
          evitarPolarizacao: true, evitarConsenso: true,
          minimoParticipacao: 500, apenasEmTramitacao: true,
        };

        const [consultas, ideias] = await Promise.all([
          cachedFetch("ecidadania_consultas_full", {}, CACHE_DYNAMIC, () =>
            listarConsultasInternal({ limite: 50 }),
          ) as Promise<ConsultaResumo[]>,
          cachedFetch("ecidadania_ideias_sug", {}, CACHE_DYNAMIC, () =>
            listarIdeiasInternal({ status: "aberta", limite: 50, ordenarPor: "apoios", ordem: "desc" }),
          ) as Promise<IdeiaResumo[]>,
        ]);

        const sugestoes: any[] = [];

        for (const c of consultas) {
          if (c.totalVotos < (criterios.minimoParticipacao ?? 500)) continue;
          const polarizacao = Math.abs(c.percentualSim - c.percentualNao);
          if (criterios.evitarPolarizacao && polarizacao < 20) continue;
          if (criterios.evitarConsenso && Math.max(c.percentualSim, c.percentualNao) > 85) continue;
          let motivo = "Tema com boa participação cidadã";
          if (polarizacao >= 20 && polarizacao <= 40) motivo = "Tema com divisão moderada de opiniões, ideal para debate";
          else if (polarizacao > 40 && polarizacao <= 70) motivo = "Tema com tendência clara mas ainda com debate significativo";
          sugestoes.push({
            tipo: "consulta", id: c.id, titulo: c.ementa.substring(0, 200), motivo,
            metricas: { participacao: c.totalVotos, polarizacao: 100 - polarizacao },
            materiaRelacionada: c.materia || undefined, url: c.url,
          });
        }

        for (const i of ideias) {
          if (i.apoios < (criterios.minimoParticipacao ?? 500)) continue;
          sugestoes.push({
            tipo: "ideia", id: i.id, titulo: i.titulo.substring(0, 200),
            motivo: `Ideia popular com ${i.apoios.toLocaleString()} apoios`,
            metricas: { participacao: i.apoios }, url: i.url,
          });
        }

        sugestoes.sort((a, b) => b.metricas.participacao - a.metricas.participacao);

        return toolResult({
          criteriosAplicados: criterios,
          totalAnalisados: consultas.length + ideias.length,
          count: sugestoes.length,
          sugestoes: sugestoes.slice(0, 10),
        });
      } catch (e) { return ecidadaniaError(e); }
    },
  );
}
