/**
 * Group K — Orçamento / Budget (1 tool)
 * senado_orcamento_parlamentar (enum `tipo`: emendas | oficios)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { errorFrom, ensureArray } from "../utils/validation.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
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
  // K1. senado_orcamento_parlamentar (tipo: emendas | oficios)
  server.tool(
    "senado_orcamento_parlamentar",
    "Lista emendas parlamentares dos senadores ao orçamento da União (e os ofícios de apoio a elas), conforme `tipo` (padrão `emendas`). " +
      "`tipo: emendas` → `{ tipo, count, emendas }`, cada item com `codigo`, `numero`, `ano`, `tipo`, `autor`, `valor` e `descricao`. " +
      "`tipo: oficios` → `{ tipo, count, oficios }`, cada item com `codigo`, `numero`, `data`, `tipo`, `descricao` e `situacao` (ofícios de apoio às emendas). " +
      "Não recebe outros parâmetros; `count` é 0 e a lista vem vazia quando não há registros. " +
      "Use para as emendas dos parlamentares ao orçamento federal — para a execução do orçamento interno do próprio Senado (despesas/receitas) use `senado_execucao_orcamentaria`.",
    {
      tipo: z.enum(["emendas", "oficios"]).optional().default("emendas").describe("emendas (lotes de emendas) ou oficios (ofícios de apoio)"),
    },
    async (params) => {
      try {
        const tipo = params.tipo ?? "emendas";
        if (tipo === "oficios") {
          const { value: response, fetchedAt } = await cachedFetchWithMeta(
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
          const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/orcamento/oficios", {
            dataset_id: "tipo=oficios", retrieved_at: fetchedAt,
          });
          return resultWithProvenance({ tipo, count: oficios.length, oficios }, prov);
        }
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
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
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/orcamento/lista", {
          dataset_id: "tipo=emendas", retrieved_at: fetchedAt,
        });
        return resultWithProvenance({ tipo, count: emendas.length, emendas }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao obter dados orçamentários");
      }
    },
  );
}
