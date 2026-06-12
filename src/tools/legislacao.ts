/**
 * Group L — Legislação / Federal Law (3 tools)
 * senado_buscar_legislacao, senado_obter_legislacao, senado_tipos_norma
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, toolError, errorFrom, buildParams, ensureArray } from "../utils/validation.js";
import { CACHE_ON_DEMAND, CACHE_STATIC } from "../types.js";

/** Parse a legislation search result. */
export function parseLegislacaoResumo(l: any) {
  return {
    codigo: l.Codigo || l.codigo || null,
    tipo: l.TipoNorma || l.tipoNorma || l.Tipo || null,
    numero: l.Numero || l.numero || null,
    ano: l.Ano || l.ano || null,
    data: l.Data || l.data || l.DataNorma || null,
    ementa: l.Ementa || l.ementa || null,
    situacao: l.Situacao || l.situacao || null,
    url: l.UrlTexto || l.urlTexto || null,
  };
}

/** Parse a legislation detail. */
export function parseLegislacaoDetalhe(l: any) {
  return {
    codigo: l.Codigo || l.codigo || null,
    tipo: l.TipoNorma || l.tipoNorma || l.Tipo || null,
    descricaoTipo: l.DescricaoTipoNorma || l.descricaoTipoNorma || null,
    numero: l.Numero || l.numero || null,
    ano: l.Ano || l.ano || null,
    data: l.Data || l.data || l.DataNorma || null,
    ementa: l.Ementa || l.ementa || null,
    indexacao: l.Indexacao || l.indexacao || null,
    situacao: l.Situacao || l.situacao || null,
    url: l.UrlTexto || l.urlTexto || null,
    origem: l.Origem || l.origem || null,
    observacao: l.Observacao || l.observacao || null,
  };
}

export function registerLegislacaoTools(server: McpServer, baseUrl: string) {
  // L1. senado_buscar_legislacao
  server.tool(
    "senado_buscar_legislacao",
    "Busca normas jurídicas federais (leis, decretos, etc.) por tipo, número, ano ou data. É obrigatório informar pelo menos um parâmetro.",
    {
      tipo: z.string().optional().describe("Tipo da norma (ex: LEI, DEC, LCP, EMC)"),
      numero: z.number().int().optional().describe("Número da norma"),
      ano: z.number().int().min(1900).max(2100).optional().describe("Ano da norma"),
      data: z.string().optional().describe("Data da norma (YYYYMMDD)"),
    },
    async (params) => {
      try {
        const qp = buildParams({
          tipo: params.tipo,
          numero: params.numero,
          ano: params.ano,
          data: params.data,
        });
        if (Object.keys(qp).length === 0) {
          return toolError("É obrigatório informar pelo menos um parâmetro de busca.");
        }
        const response = await cachedFetch("senado_buscar_legislacao", qp, CACHE_ON_DEMAND, () =>
          upstreamFetch("/legislacao/lista", qp, baseUrl),
        );
        const r = response as any;
        const normas = ensureArray(
          r?.ListaNormas?.Normas?.Norma ??
          r?.Normas?.Norma,
        ).map(parseLegislacaoResumo);
        return toolResult({ count: normas.length, normas });
      } catch (e) {
        return errorFrom(e, "Erro na busca de legislação");
      }
    },
  );

  // L2. senado_obter_legislacao
  server.tool(
    "senado_obter_legislacao",
    "Obtém detalhes de uma norma jurídica federal específica.",
    {
      codigo: z.number().int().positive().describe("Código único da norma"),
    },
    async (params) => {
      try {
        const response = await cachedFetch(
          "senado_obter_legislacao",
          { codigo: params.codigo },
          CACHE_ON_DEMAND,
          () => upstreamFetch(`/legislacao/${params.codigo}`, {}, baseUrl),
        );
        const r = response as any;
        const norma = r?.DetalheNorma?.Norma || r?.Norma || r;
        return toolResult(parseLegislacaoDetalhe(norma));
      } catch (e) {
        return errorFrom(e, "Norma não encontrada");
      }
    },
  );

  // L3. senado_tipos_norma
  server.tool(
    "senado_tipos_norma",
    "Lista os tipos de normas jurídicas federais disponíveis (LEI, DEC, LCP, EMC, etc.).",
    {},
    async () => {
      try {
        const response = await cachedFetch(
          "senado_tipos_norma",
          {},
          CACHE_STATIC,
          () => upstreamFetch("/legislacao/tiposNorma", {}, baseUrl),
        );
        const r = response as any;
        const tipos = ensureArray(
          r?.ListaTiposNorma?.TiposNorma?.TipoNorma ??
          r?.TiposNorma?.TipoNorma,
        ).map((t: any) => ({
          sigla: t.Sigla || t.sigla || null,
          descricao: t.Descricao || t.descricao || null,
        }));
        return toolResult({ count: tipos.length, tipos });
      } catch (e) {
        return errorFrom(e, "Erro ao obter tipos de norma");
      }
    },
  );
}
