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
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { errorFrom, ensureArray, safeInt } from "../utils/validation.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
import { CACHE_ON_DEMAND } from "../types.js";

const TRECHO_LEN = 200;
const MAX_QUARTOS_TEXTO = 20;

/**
 * Aviso quando o acervo não tem notas para o código (o upstream responde 404,
 * tratado como vazio). Smoke de 15/07/2026 em dez/2024 + jul/2026: a cobertura
 * das sessões plenárias do SF é boa e rápida (deliberativas, não deliberativas
 * e especiais transcritas em poucos dias); os buracos são estruturais — sessões
 * CONJUNTAS do Congresso Nacional, sessões canceladas/não realizadas e algumas
 * solenes 404am nas notas, embora a mídia possa existir (a conjunta 444468 tem
 * vídeos mas não tem notas).
 */
export const NOTAS_TAQUIGRAFICAS_AVISO_VAZIO =
  "Sem notas taquigráficas para este código no acervo. A cobertura são as sessões plenárias " +
  "do Senado (transcrição disponível poucos dias após a sessão); sessões CONJUNTAS do " +
  "Congresso Nacional, canceladas/não realizadas e algumas solenes não têm notas. A mídia " +
  "pode existir mesmo assim — tente senado_videos_taquigrafia. Confira também o `tipo`: " +
  "código de reunião de comissão exige tipo=reuniao (e código de sessão, tipo=sessao).";

/** Aviso equivalente para o acervo de mídia (também 404 tratado como vazio). */
export const VIDEOS_TAQUIGRAFIA_AVISO_VAZIO =
  "Sem mídia para este código no acervo (sessões canceladas/não realizadas não têm vídeos). " +
  "Confira também o `tipo`: código de reunião de comissão exige tipo=reuniao " +
  "(e código de sessão, tipo=sessao).";

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
    "Transcrição oficial (notas taquigráficas) de uma sessão plenária ou reunião de comissão, em blocos sequenciais. Retorna `{ id, tipo, sessao, data, totalBlocos, aviso?, blocos }`; `id` inexistente ou sem transcrição no acervo retorna `totalBlocos` 0 com `aviso` explicando. Cobertura: sessões plenárias do SF (deliberativas, não deliberativas, especiais) são transcritas em poucos dias; sessões CONJUNTAS do Congresso, canceladas/não realizadas e algumas solenes NÃO têm notas (a mídia pode existir em `senado_videos_taquigrafia`). `modo` governa o payload: `resumo` (padrão) traz por bloco `sequencia`, `dataInicio/Fim`, `trecho` (200 chars), `caracteres` e `linkAudio`, limitado a `limite` (padrão 20; pagine com `sequenciaInicio`, `aviso` sinaliza corte); `texto` traz o conteúdo integral de até 20 blocos por chamada (janela `sequenciaInicio`→`sequenciaFim`) e inclui `intervalo`. `sequenciaFim` só atua em `modo=texto`. Obtenha o `id` via `senado_agenda_plenario`/`senado_resultado_plenario` (sessão) ou `senado_reuniao_comissao` (reunião); `orador` filtra blocos pelo nome citado. Para a mídia (vídeo/áudio) use `senado_videos_taquigrafia`, não esta.",
    {
      id: z.number().int().positive().describe("Código da sessão plenária ou da reunião de comissão"),
      tipo: z.enum(["sessao", "reuniao"]).optional().default("sessao").describe("sessao = plenário (padrão); reuniao = comissão"),
      modo: z.enum(["resumo", "texto"]).optional().default("resumo").describe("resumo = blocos com trecho inicial; texto = transcrição integral dos blocos selecionados"),
      sequenciaInicio: z.number().int().min(1).optional().describe("Primeiro bloco a retornar (base 1); pagina o modo resumo e abre a janela do modo texto (padrão: 1)"),
      sequenciaFim: z.number().int().min(1).optional().describe("Último bloco no modo texto (ignorado no modo resumo); a janela é capada em 20 blocos por chamada"),
      limite: z.number().int().min(1).max(100).optional().default(20).describe("modo=resumo: máximo de blocos por chamada (padrão 20); o excedente é sinalizado em aviso"),
      orador: z.string().optional().describe("Retorna só blocos cujo texto menciona este nome (busca parcial no conteúdo)"),
    },
    async (params) => {
      try {
        const tipo = params.tipo ?? "sessao";
        const path = `/taquigrafia/notas/${tipo}/${params.id}`;
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_notas_taquigraficas",
          { tipo, id: params.id },
          CACHE_ON_DEMAND,
          // The acervo answers 404 for codes without transcript (CN joint sessions,
          // cancelled/not-held sessions, some solemn ones) — serve the promised
          // empty result instead of an upstream error.
          () => upstreamFetch(path, {}, baseUrl, { treat404AsEmpty: true }),
        );
        const nt = (response as any)?.notasTaquigraficas ?? response;
        const quartosTodos = ensureArray(nt?.quartos);
        let quartos = quartosTodos;
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
          ...(quartosTodos.length === 0 ? { aviso: NOTAS_TAQUIGRAFICAS_AVISO_VAZIO } : {}),
        };
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          dataset_id: `${tipo}=${params.id}`,
          reference_period: nt?.data || undefined,
          retrieved_at: fetchedAt,
        });
        if ((params.modo ?? "resumo") === "resumo") {
          // OBS-1: resumo used to dump every block (77 blocks ≈ 30k chars). Window it.
          const inicioR = params.sequenciaInicio ?? 1;
          const limiteR = params.limite ?? 20;
          const janela = quartos.filter((q: any) => safeInt(q.sequencia) >= inicioR);
          const selecionadosR = janela.slice(0, limiteR);
          return resultWithProvenance({
            ...dados,
            ...(janela.length > limiteR
              ? { aviso: `Exibindo ${selecionadosR.length} de ${quartos.length} blocos (a partir de ${inicioR}). Avance com sequenciaInicio.` }
              : {}),
            blocos: selecionadosR.map(parseQuartoResumo),
          }, prov);
        }
        const inicio = params.sequenciaInicio ?? 1;
        const fim = Math.min(params.sequenciaFim ?? inicio + MAX_QUARTOS_TEXTO - 1, inicio + MAX_QUARTOS_TEXTO - 1);
        const selecionados = quartos.filter((q: any) => {
          const seq = safeInt(q.sequencia);
          return seq >= inicio && seq <= fim;
        });
        return resultWithProvenance({
          ...dados,
          intervalo: { sequenciaInicio: inicio, sequenciaFim: fim },
          blocos: selecionados.map(parseQuartoTexto),
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao obter notas taquigráficas");
      }
    },
  );

  // N2. senado_videos_taquigrafia
  server.tool(
    "senado_videos_taquigrafia",
    "Lista os vídeos e áudios (unidades descritivas) de uma sessão plenária ou reunião de comissão. Retorna `{ id, tipo, count, total, aviso?, videos }` (sessão sem mídia no acervo → `count`/`total` 0 com `aviso`; ao passar de `limite` inclui `aviso`). A cobertura de mídia é mais ampla que a das notas: sessões conjuntas do Congresso costumam ter vídeos mesmo sem transcrição, cada item com `codigo`, `data`, `descricao`, `orador`, `duracaoSegundos` e os links `urlVideo`, `urlAudio`, `urlThumbnail`. Obtenha o `id` via `senado_agenda_plenario`/`senado_resultado_plenario` (sessão) ou `senado_reuniao_comissao` (reunião). Para a transcrição textual correspondente use `senado_notas_taquigraficas`, não esta.",
    {
      id: z.number().int().positive().describe("Código da sessão plenária ou da reunião de comissão, conforme `tipo`"),
      tipo: z.enum(["sessao", "reuniao"]).optional().default("sessao").describe("sessao = plenário (padrão); reuniao = comissão"),
      orador: z.string().optional().describe("Retorna só unidades cujo orador contém este nome (busca parcial)"),
      limite: z.number().int().min(1).max(200).optional().default(50).describe("Máximo de unidades (padrão 50, máx 200); o excedente é sinalizado em aviso"),
    },
    async (params) => {
      try {
        const tipo = params.tipo ?? "sessao";
        const path = `/taquigrafia/videos/${tipo}/${params.id}`;
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_videos_taquigrafia",
          { tipo, id: params.id },
          CACHE_ON_DEMAND,
          // Same 404-as-empty posture as the notes acervo (missing media -> 404).
          () => upstreamFetch(path, {}, baseUrl, { treat404AsEmpty: true }),
        );
        const videosTodos = ensureArray(response).map(parseVideoUnidade);
        let videos = videosTodos;
        if (params.orador) {
          const alvo = params.orador.toLowerCase();
          videos = videos.filter((v) => v.orador?.toLowerCase().includes(alvo));
        }
        const limite = params.limite ?? 50;
        const total = videos.length;
        const selecionados = videos.slice(0, limite);
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          dataset_id: `${tipo}=${params.id}`, retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          id: params.id,
          tipo,
          count: selecionados.length,
          total,
          ...(videosTodos.length === 0
            ? { aviso: VIDEOS_TAQUIGRAFIA_AVISO_VAZIO }
            : total > limite ? { aviso: `Exibindo ${limite} de ${total} unidades.` } : {}),
          videos: selecionados,
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao obter vídeos da sessão");
      }
    },
  );
}
