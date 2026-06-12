/**
 * Group K — Orçamento / Budget (2 tools)
 * senado_orcamento_emendas, senado_orcamento_oficios
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, errorFrom, ensureArray } from "../utils/validation.js";
import { CACHE_SEMI_STATIC } from "../types.js";

/** Parse a budget amendment batch. */
export function parseEmenda(e: any) {
  return {
    codigo: e.Codigo || e.codigo || null,
    numero: e.Numero || e.numero || null,
    ano: e.Ano || e.ano || null,
    tipo: e.TipoEmenda || e.tipoEmenda || e.Tipo || null,
    autor: e.Autor || e.autor || null,
    valor: e.Valor || e.valor || null,
    descricao: e.Descricao || e.descricao || e.Ementa || null,
  };
}

/** Parse a budget support letter (ofício). */
export function parseOficio(o: any) {
  return {
    codigo: o.Codigo || o.codigo || null,
    numero: o.Numero || o.numero || null,
    data: o.Data || o.data || null,
    tipo: o.Tipo || o.tipo || null,
    descricao: o.Descricao || o.descricao || null,
    situacao: o.Situacao || o.situacao || null,
  };
}

export function registerOrcamentoTools(server: McpServer, baseUrl: string) {
  // K1. senado_orcamento_emendas
  server.tool(
    "senado_orcamento_emendas",
    "Lista lotes de emendas orçamentárias do Senado.",
    {},
    async () => {
      try {
        const response = await cachedFetch(
          "senado_orcamento_emendas",
          {},
          CACHE_SEMI_STATIC,
          () => upstreamFetch("/orcamento/lista", {}, baseUrl),
        );
        const r = response as any;
        const emendas = ensureArray(
          r?.OrcamentoList?.Emendas?.Emenda ??
          r?.Emendas?.Emenda ??
          r?.ListaEmendas?.Emendas?.Emenda,
        ).map(parseEmenda);
        return toolResult({ count: emendas.length, emendas });
      } catch (e) {
        return errorFrom(e, "Erro ao obter emendas orçamentárias");
      }
    },
  );

  // K2. senado_orcamento_oficios
  server.tool(
    "senado_orcamento_oficios",
    "Lista ofícios de apoio a emendas orçamentárias.",
    {},
    async () => {
      try {
        const response = await cachedFetch(
          "senado_orcamento_oficios",
          {},
          CACHE_SEMI_STATIC,
          () => upstreamFetch("/orcamento/oficios", {}, baseUrl),
        );
        const r = response as any;
        const oficios = ensureArray(
          r?.OrcamentoOficios?.Oficios?.Oficio ??
          r?.Oficios?.Oficio ??
          r?.ListaOficios?.Oficios?.Oficio,
        ).map(parseOficio);
        return toolResult({ count: oficios.length, oficios });
      } catch (e) {
        return errorFrom(e, "Erro ao obter ofícios orçamentários");
      }
    },
  );
}
