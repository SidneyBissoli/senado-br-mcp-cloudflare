/**
 * Group C — Processes (2 tools — NEW, confirmed in OpenAPI)
 * senado_search_processos, senado_obter_processo
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, toolError, buildParams, ensureArray } from "../utils/validation.js";
import { CACHE_ON_DEMAND } from "../types.js";

export function registerProcessosTools(server: McpServer, baseUrl: string) {
  // C1. senado_search_processos
  server.tool(
    "senado_search_processos",
    "Busca processos legislativos usando o endpoint de processos da API. Oferece parâmetros de busca diferentes/complementares ao senado_buscar_materias. É obrigatório informar pelo menos um parâmetro de busca.",
    {
      sigla: z.string().optional().describe("Sigla do tipo de processo (ex: PL, PEC)"),
      numero: z.number().int().optional().describe("Número do processo"),
      ano: z.number().int().optional().describe("Ano do processo"),
      autor: z.string().optional().describe("Nome do autor"),
      codigoParlamentarAutor: z.number().int().optional().describe("Código do parlamentar autor"),
      tramitando: z.enum(["S", "N"]).optional().describe("Em tramitação (S/N)"),
      dataInicioApresentacao: z.string().optional().describe("Data início da apresentação (YYYYMMDD)"),
      dataFimApresentacao: z.string().optional().describe("Data fim da apresentação (YYYYMMDD)"),
    },
    async (params) => {
      try {
        const qp = buildParams({
          sigla: params.sigla,
          numero: params.numero,
          ano: params.ano,
          autor: params.autor,
          codigoParlamentarAutor: params.codigoParlamentarAutor,
          tramitando: params.tramitando,
          dataInicioApresentacao: params.dataInicioApresentacao,
          dataFimApresentacao: params.dataFimApresentacao,
        });
        if (Object.keys(qp).length === 0) {
          return toolError("É obrigatório informar pelo menos um parâmetro de busca.");
        }
        const response = await cachedFetch("senado_search_processos", qp, CACHE_ON_DEMAND, () =>
          upstreamFetch("/processo", qp, baseUrl),
        );
        const r = response as any;
        const processos = ensureArray(r?.processos ?? r?.Processos ?? r).map((p: any) => ({
          id: p.id || p.idProcesso || null,
          sigla: p.sigla || p.siglaTipoProcesso || null,
          numero: p.numero || null,
          ano: p.ano || null,
          ementa: p.ementa || p.descricao || null,
          autor: p.autor || p.nomeAutor || null,
          situacao: p.situacao || p.descricaoSituacao || null,
          dataApresentacao: p.dataApresentacao || null,
        }));
        return toolResult({ count: processos.length, processos });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Erro na busca de processos");
      }
    },
  );

  // C2. senado_obter_processo
  server.tool(
    "senado_obter_processo",
    "Obtém detalhes completos de um processo legislativo específico, incluindo tramitação.",
    {
      idProcesso: z.number().int().positive().describe("ID do processo legislativo"),
    },
    async (params) => {
      try {
        const response = await cachedFetch(
          "senado_obter_processo",
          { id: params.idProcesso },
          CACHE_ON_DEMAND,
          () => upstreamFetch(`/processo/${params.idProcesso}`, {}, baseUrl),
        );
        // The /processo/{id} endpoint returns detailed process information
        return toolResult(response);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Processo não encontrado");
      }
    },
  );
}
