/**
 * Group N — Taquigrafia / Stenographic records (2 tools)
 * senado_notas_taquigraficas, senado_videos_taquigrafia
 *
 * Covers /taquigrafia/notas/{sessao|reuniao}/{id} and
 * /taquigrafia/videos/{sessao|reuniao}/{id}.
 * Full transcripts are large (hundreds of KB), so the notes tool defaults to a
 * summary mode and exposes the full text in paginated blocks ("quartos").
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, errorFrom, ensureArray, safeInt } from "../utils/validation.js";
import { CACHE_ON_DEMAND } from "../types.js";

const TRECHO_LEN = 200;
const MAX_QUARTOS_TEXTO = 20;

/** Summarize a transcript block (quarto) without the full text. */
export function parseQuartoResumo(q: any) {
  const texto = typeof q.texto === "string" ? q.texto : "";
  return {
    sequencia: safeInt(q.sequencia),
    dataInicio: q.dataInicio || null,
    dataFim: q.dataFim || null,
    trecho: texto.slice(0, TRECHO_LEN) + (texto.length > TRECHO_LEN ? "…" : ""),
    caracteres: texto.length,
    linkAudio: q.linkAudio || null,
  };
}

/** Full transcript block. */
export function parseQuartoTexto(q: any) {
  return {
    sequencia: safeInt(q.sequencia),
    dataInicio: q.dataInicio || null,
    dataFim: q.dataFim || null,
    texto: typeof q.texto === "string" ? q.texto : "",
  };
}

/** Parse a video/audio descriptive unit. */
export function parseVideoUnidade(v: any) {
  return {
    codigo: v.codigo ?? null,
    data: v.dataUnidade || null,
    descricao: v.descricao || null,
    orador: v.descricaoOrador || null,
    duracaoSegundos: safeInt(v.duracaoVideo || v.duracaoAudio) || null,
    urlVideo: v.enderecoVideo || null,
    urlAudio: v.enderecoAudio || null,
    urlThumbnail: v.enderecoThumbnail || null,
  };
}

export function registerTaquigrafiaTools(server: McpServer, baseUrl: string) {
  // N1. senado_notas_taquigraficas
  server.tool(
    "senado_notas_taquigraficas",
    "Obtém as notas taquigráficas (transcrição oficial) de uma sessão plenária ou reunião de comissão. Retorna `{ id, tipo, sessao, data, totalBlocos, blocos }`: no modo `resumo` (padrão) cada bloco traz `sequencia`, `dataInicio/Fim`, `trecho` (primeiros 200 chars), `caracteres` e `linkAudio`; no modo `texto` traz o `texto` integral de no máx. 20 blocos por chamada (controle a janela com `sequenciaInicio`/`sequenciaFim`) e inclui `intervalo`. Obtenha o `id` da sessão via `senado_agenda_plenario`/`senado_resultado_plenario` ou da reunião via `senado_reuniao_comissao`; use `orador` para filtrar blocos por nome e `senado_videos_taquigrafia` para a mídia.",
    {
      id: z.number().int().positive().describe("Código da sessão plenária ou da reunião de comissão"),
      tipo: z.enum(["sessao", "reuniao"]).optional().default("sessao").describe("sessao = plenário (padrão); reuniao = comissão"),
      modo: z.enum(["resumo", "texto"]).optional().default("resumo").describe("resumo = blocos com trecho inicial; texto = transcrição integral dos blocos selecionados"),
      sequenciaInicio: z.number().int().min(1).optional().describe("Primeiro bloco (quarto) a retornar no modo texto (padrão: 1)"),
      sequenciaFim: z.number().int().min(1).optional().describe("Último bloco a retornar no modo texto (máx. 20 blocos por chamada)"),
      orador: z.string().optional().describe("Filtra blocos que mencionam este nome (busca no texto)"),
    },
    async (params) => {
      try {
        const tipo = params.tipo ?? "sessao";
        const response = await cachedFetch(
          "senado_notas_taquigraficas",
          { tipo, id: params.id },
          CACHE_ON_DEMAND,
          () => upstreamFetch(`/taquigrafia/notas/${tipo}/${params.id}`, {}, baseUrl),
        );
        const nt = (response as any)?.notasTaquigraficas ?? response;
        let quartos = ensureArray(nt?.quartos);
        if (params.orador) {
          const alvo = params.orador.toLowerCase();
          quartos = quartos.filter((q: any) =>
            typeof q.texto === "string" && q.texto.toLowerCase().includes(alvo));
        }
        const dados = {
          id: params.id,
          tipo,
          sessao: nt?.dadosSessao || null,
          data: nt?.data || null,
          totalBlocos: quartos.length,
        };
        if ((params.modo ?? "resumo") === "resumo") {
          return toolResult({ ...dados, blocos: quartos.map(parseQuartoResumo) });
        }
        const inicio = params.sequenciaInicio ?? 1;
        const fim = Math.min(params.sequenciaFim ?? inicio + MAX_QUARTOS_TEXTO - 1, inicio + MAX_QUARTOS_TEXTO - 1);
        const selecionados = quartos.filter((q: any) => {
          const seq = safeInt(q.sequencia);
          return seq >= inicio && seq <= fim;
        });
        return toolResult({
          ...dados,
          intervalo: { sequenciaInicio: inicio, sequenciaFim: fim },
          blocos: selecionados.map(parseQuartoTexto),
        });
      } catch (e) {
        return errorFrom(e, "Erro ao obter notas taquigráficas");
      }
    },
  );

  // N2. senado_videos_taquigrafia
  server.tool(
    "senado_videos_taquigrafia",
    "Lista os vídeos e áudios (unidades descritivas) de uma sessão plenária ou reunião de comissão. Retorna `{ id, tipo, count, videos }`, onde cada item traz `codigo`, `data`, `descricao`, `orador`, `duracaoSegundos`, e links `urlVideo`, `urlAudio`, `urlThumbnail`. Obtenha o `id` da sessão via `senado_agenda_plenario`/`senado_resultado_plenario` ou da reunião via `senado_reuniao_comissao`; use `orador` para filtrar pelo nome de quem fala e `senado_notas_taquigraficas` para a transcrição textual correspondente.",
    {
      id: z.number().int().positive().describe("Código da sessão plenária ou da reunião de comissão"),
      tipo: z.enum(["sessao", "reuniao"]).optional().default("sessao").describe("sessao = plenário (padrão); reuniao = comissão"),
      orador: z.string().optional().describe("Filtra unidades por nome do orador"),
    },
    async (params) => {
      try {
        const tipo = params.tipo ?? "sessao";
        const response = await cachedFetch(
          "senado_videos_taquigrafia",
          { tipo, id: params.id },
          CACHE_ON_DEMAND,
          () => upstreamFetch(`/taquigrafia/videos/${tipo}/${params.id}`, {}, baseUrl),
        );
        let videos = ensureArray(response).map(parseVideoUnidade);
        if (params.orador) {
          const alvo = params.orador.toLowerCase();
          videos = videos.filter((v) => v.orador?.toLowerCase().includes(alvo));
        }
        return toolResult({ id: params.id, tipo, count: videos.length, videos });
      } catch (e) {
        return errorFrom(e, "Erro ao obter vídeos da sessão");
      }
    },
  );
}
