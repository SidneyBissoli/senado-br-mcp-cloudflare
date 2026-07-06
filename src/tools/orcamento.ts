/**
 * Group K — Orçamento / Budget (1 tool)
 * senado_orcamento_parlamentar (enum `tipo`: emendas | oficios)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { errorFrom, ensureArray, safeInt, normalizeText } from "../utils/validation.js";
import { digArrayRoot } from "../utils/upstream-parse.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
import { CACHE_SEMI_STATIC } from "../types.js";

/**
 * Parse a budget amendment batch (ListaLoteEmendas.LotesEmendasOrcamento.LoteEmendasOrcamento).
 * The upstream has no `valor`/`descricao` fields — each row is an author's batch with a
 * count of amendments tied to a budget bill (LOA/LDO/PPA).
 */
export function parseEmenda(e: any) {
  const num = e.NumeroMateria || e.numero || null;
  const ano = e.AnoMateria || e.ano || null;
  const sigla = e.SiglaTipoPlOrcamento || "";
  return {
    autor: e.NomeAutorOrcamento || null,
    codigoAutor: safeInt(e.CodigoAutorOrcamento) || null,
    quantidadeEmendas: safeInt(e.QuantidadeEmendas),
    anoExecucao: e.AnoExecucao || null,
    materia: num && ano ? `${sigla ? sigla + " " : ""}${num}/${ano}` : null,
    tipoPl: e.DescricaoTipoPlOrcamento || null,
    dataOperacao: e.DataOperacao || null,
    ativo: normalizeText(e.IndicadorAtivo) === "sim",
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
      "`tipo: emendas` → `{ tipo, count, emendas }`, cada item (lote de emendas de um autor) com `autor`, `codigoAutor`, `quantidadeEmendas`, `anoExecucao`, `materia` (peça orçamentária, p.ex. `LOA 29/2023`), `tipoPl`, `dataOperacao` e `ativo`. " +
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
        const emendas = digArrayRoot(
          response,
          [["ListaLoteEmendas", "LotesEmendasOrcamento", "LoteEmendasOrcamento"]],
          "senado_orcamento_parlamentar:emendas",
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
