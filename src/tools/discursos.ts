/**
 * Group I — Speeches (5 tools)
 * senado_discursos_senador, senado_discursos_plenario,
 * senado_discurso_texto, senado_tipos_uso_palavra, senado_apartes_senador
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, errorFrom, ensureArray } from "../utils/validation.js";
import { CACHE_DYNAMIC, CACHE_ON_DEMAND, CACHE_STATIC, UPSTREAM_TIMEOUT_MS } from "../types.js";

/** Parse a speech summary from the senator or plenary speeches endpoint. */
export function parseDiscursoResumo(d: any) {
  const pronunciamento = d.Pronunciamento || d;
  return {
    codigo: pronunciamento.CodigoPronunciamento || pronunciamento.codigoPronunciamento || null,
    data: pronunciamento.DataPronunciamento || pronunciamento.dataPronunciamento || null,
    casa: pronunciamento.SiglaCasaPronunciamento || pronunciamento.siglaCasa || null,
    tipoUsoPalavra: pronunciamento.TipoUsoPalavra?.Descricao ||
      pronunciamento.tipoUsoPalavra || null,
    resumo: pronunciamento.TextoResumo || pronunciamento.resumo || null,
    indexacao: pronunciamento.Indexacao || pronunciamento.indexacao || null,
    url: pronunciamento.UrlTexto || pronunciamento.urlTexto || null,
    nomeParlamentar: pronunciamento.NomeParlamentar || pronunciamento.nomeParlamentar || null,
  };
}

export function registerDiscursosTools(server: McpServer, baseUrl: string) {
  // I1. senado_discursos_senador
  server.tool(
    "senado_discursos_senador",
    "Lista discursos/pronunciamentos de um senador específico, filtráveis por período e casa legislativa.",
    {
      codigoSenador: z.number().int().positive().describe("Código único do senador"),
      casa: z.string().optional().describe("Casa legislativa (SF=Senado, CN=Congresso)"),
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim (YYYYMMDD)"),
    },
    async (params) => {
      try {
        const qp: Record<string, string> = {};
        if (params.casa) qp.casa = params.casa;
        if (params.dataInicio) qp.dataInicio = params.dataInicio;
        if (params.dataFim) qp.dataFim = params.dataFim;

        const response = await cachedFetch(
          "senado_discursos_senador",
          { codigo: params.codigoSenador, ...qp },
          CACHE_DYNAMIC,
          () => upstreamFetch(`/senador/${params.codigoSenador}/discursos`, qp, baseUrl),
        );
        const r = response as any;
        const discursos = ensureArray(
          r?.DiscursosParlamentar?.Parlamentar?.Pronunciamentos?.Pronunciamento ??
          r?.Pronunciamentos?.Pronunciamento,
        ).map(parseDiscursoResumo);
        return toolResult({ codigoSenador: params.codigoSenador, count: discursos.length, discursos });
      } catch (e) {
        return errorFrom(e, "Erro ao obter discursos do senador");
      }
    },
  );

  // I2. senado_discursos_plenario
  server.tool(
    "senado_discursos_plenario",
    "Lista todos os discursos realizados em plenário num período de datas.",
    {
      dataInicio: z.string().regex(/^\d{8}$/).describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).describe("Data fim (YYYYMMDD)"),
    },
    async (params) => {
      try {
        const response = await cachedFetch(
          "senado_discursos_plenario",
          { dataInicio: params.dataInicio, dataFim: params.dataFim },
          CACHE_DYNAMIC,
          () => upstreamFetch(`/plenario/lista/discursos/${params.dataInicio}/${params.dataFim}`, {}, baseUrl),
        );
        const r = response as any;
        const discursos = ensureArray(
          r?.DiscursosPlenario?.Pronunciamentos?.Pronunciamento ??
          r?.Pronunciamentos?.Pronunciamento,
        ).map(parseDiscursoResumo);
        return toolResult({ periodo: { dataInicio: params.dataInicio, dataFim: params.dataFim }, count: discursos.length, discursos });
      } catch (e) {
        return errorFrom(e, "Erro ao obter discursos do plenário");
      }
    },
  );

  // I3. senado_discurso_texto
  // This endpoint returns plain text, not JSON. Use direct fetch with cachedFetch.
  server.tool(
    "senado_discurso_texto",
    "Obtém o texto integral de um pronunciamento/discurso específico.",
    {
      codigoPronunciamento: z.number().int().positive().describe("Código do pronunciamento"),
    },
    async (params) => {
      try {
        const texto = await cachedFetch(
          "senado_discurso_texto",
          { codigo: params.codigoPronunciamento },
          CACHE_ON_DEMAND,
          async () => {
            const url = `${baseUrl}/discurso/texto-integral/${params.codigoPronunciamento}.json`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
            try {
              const resp = await fetch(url, {
                method: "GET",
                headers: {
                  Accept: "text/plain, application/json",
                  "User-Agent": "senado-br-mcp/2.2.0",
                },
                signal: controller.signal,
              });
              clearTimeout(timeout);
              if (!resp.ok) {
                throw new Error(`Upstream retornou HTTP ${resp.status} para texto do discurso ${params.codigoPronunciamento}`);
              }
              const text = await resp.text();
              if (!text.trim()) {
                throw new Error(`Texto do discurso ${params.codigoPronunciamento} vazio`);
              }
              // Try to parse as JSON first — API might wrap the text
              try {
                const json = JSON.parse(text);
                // If it's an object with a text field, extract it
                if (json && typeof json === "object") {
                  return json.TextoIntegral || json.textoIntegral || json.texto || text;
                }
                return text;
              } catch {
                // Not JSON — return raw text
                return text;
              }
            } catch (e) {
              clearTimeout(timeout);
              if ((e as Error).name === "AbortError") {
                throw new Error(`Timeout ao obter texto do discurso ${params.codigoPronunciamento}`);
              }
              throw e;
            }
          },
        );
        return toolResult({ codigoPronunciamento: params.codigoPronunciamento, texto });
      } catch (e) {
        return errorFrom(e, "Erro ao obter texto do discurso");
      }
    },
  );

  // I4. senado_tipos_uso_palavra
  server.tool(
    "senado_tipos_uso_palavra",
    "Lista os tipos de uso da palavra (tipos de discurso/pronunciamento) disponíveis no Senado.",
    {},
    async () => {
      try {
        const response = await cachedFetch(
          "senado_tipos_uso_palavra",
          {},
          CACHE_STATIC,
          () => upstreamFetch("/senador/lista/tiposUsoPalavra", {}, baseUrl),
        );
        const r = response as any;
        const tipos = ensureArray(
          r?.ListaTiposUsoPalavra?.TiposUsoPalavra?.TipoUsoPalavra ??
          r?.TiposUsoPalavra?.TipoUsoPalavra,
        ).map((t: any) => ({
          codigo: t.Codigo || t.codigo || null,
          descricao: t.Descricao || t.descricao || null,
        }));
        return toolResult({ count: tipos.length, tipos });
      } catch (e) {
        return errorFrom(e, "Erro ao obter tipos de uso da palavra");
      }
    },
  );

  // I5. senado_apartes_senador
  server.tool(
    "senado_apartes_senador",
    "Lista apartes (intervenções em discursos de outros parlamentares) feitos por um senador, filtráveis por período e casa legislativa.",
    {
      codigoSenador: z.number().int().positive().describe("Código único do senador"),
      casa: z.string().optional().describe("Casa legislativa (SF=Senado, CN=Congresso)"),
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim (YYYYMMDD)"),
    },
    async (params) => {
      try {
        const qp: Record<string, string> = {};
        if (params.casa) qp.casa = params.casa;
        if (params.dataInicio) qp.dataInicio = params.dataInicio;
        if (params.dataFim) qp.dataFim = params.dataFim;

        const response = await cachedFetch(
          "senado_apartes_senador",
          { codigo: params.codigoSenador, ...qp },
          CACHE_DYNAMIC,
          () => upstreamFetch(`/senador/${params.codigoSenador}/apartes`, qp, baseUrl),
        );
        const r = response as any;
        const apartes = ensureArray(
          r?.ApartesParlamentar?.Parlamentar?.Apartes?.Aparte ??
          r?.Apartes?.Aparte,
        ).map(parseDiscursoResumo);
        return toolResult({ codigoSenador: params.codigoSenador, count: apartes.length, apartes });
      } catch (e) {
        return errorFrom(e, "Erro ao obter apartes do senador");
      }
    },
  );
}
