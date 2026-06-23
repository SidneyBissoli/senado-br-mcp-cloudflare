/**
 * Group L — Legislação / Federal Law (2 tools)
 * senado_buscar_legislacao, senado_obter_legislacao
 * (a tabela de tipos de norma migrou para senado_tabelas_referencia em referencia.ts)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolError, errorFrom, buildParams, ensureArray } from "../utils/validation.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
import { CACHE_ON_DEMAND } from "../types.js";

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
    "Busca normas jurídicas federais (leis, decretos, etc.) por `tipo`, `numero`, `ano` ou `data`. Retorna `{ count, normas }`, cada norma com `codigo`, `tipo`, `numero`, `ano`, `data`, `ementa`, `situacao` e `url` do texto. É obrigatório informar ao menos um parâmetro, senão retorna erro. Use o `codigo` retornado em `senado_obter_legislacao` para o detalhe; consulte os tipos válidos em `senado_tabelas_referencia` (`tabela: \"tipos-norma\"`).",
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
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_buscar_legislacao", qp, CACHE_ON_DEMAND,
          () => upstreamFetch("/legislacao/lista", qp, baseUrl),
        );
        const r = response as any;
        const normas = ensureArray(
          r?.ListaNormas?.Normas?.Norma ??
          r?.Normas?.Norma,
        ).map(parseLegislacaoResumo);
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/legislacao/lista", {
          reference_period: params.ano ? String(params.ano) : undefined,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({ count: normas.length, normas }, prov);
      } catch (e) {
        return errorFrom(e, "Erro na busca de legislação");
      }
    },
  );

  // L2. senado_obter_legislacao
  server.tool(
    "senado_obter_legislacao",
    "Obtém os detalhes de uma norma jurídica federal específica pelo seu `codigo`. Retorna um objeto com `codigo`, `tipo`, `descricaoTipo`, `numero`, `ano`, `data`, `ementa`, `indexacao`, `situacao`, `origem`, `observacao` e `url` do texto integral. Obtenha o `codigo` primeiro via `senado_buscar_legislacao`.",
    {
      codigo: z.number().int().positive().describe("Código único da norma"),
    },
    async (params) => {
      try {
        const path = `/legislacao/${params.codigo}`;
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_obter_legislacao",
          { codigo: params.codigo },
          CACHE_ON_DEMAND,
          () => upstreamFetch(path, {}, baseUrl),
        );
        const r = response as any;
        const norma = r?.DetalheNorma?.Norma || r?.Norma || r;
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          dataset_id: `norma=${params.codigo}`, retrieved_at: fetchedAt,
        });
        return resultWithProvenance(parseLegislacaoDetalhe(norma), prov);
      } catch (e) {
        return errorFrom(e, "Norma não encontrada");
      }
    },
  );
}
