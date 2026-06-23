/**
 * Group R — Supridos / Suprimento de Fundos (1 tool)
 * senado_suprimento_fundos
 *
 * Petty-cash advances (suprimento de fundos) granted to Senate units,
 * with concession acts, commitments, movements and card transactions.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { admFetch } from "../throttle/adm.js";
import { errorFrom, ensureArray } from "../utils/validation.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
import { CACHE_STATIC } from "../types.js";
import { matchesFiltro } from "./contratacoes.js";

const PATHS: Record<string, (ano: number) => string> = {
  "supridos": (ano) => `/supridos/${ano}`,
  "atos-concessao": (ano) => `/supridos/atosConcessao/${ano}`,
  "empenhos": (ano) => `/supridos/empenhos/${ano}`,
  "movimentacoes": (ano) => `/supridos/movimentacoes/${ano}`,
  "transacoes": (ano) => `/supridos/transacoes/${ano}`,
};

export function registerSupridosTools(server: McpServer, admBaseUrl: string) {
  // R1. senado_suprimento_fundos
  server.tool(
    "senado_suprimento_fundos",
    "Suprimento de fundos do Senado (adiantamentos a supridos): relação anual de supridos, atos de concessão, empenhos, movimentações ou transações de cartão corporativo, conforme `tipo`. Retorna `{ ano, tipo, count, total, registros }` (snake_case da API administrativa), filtrável por `filtro` textual e limitado por `limite` (padrão 100, máx 500); ao truncar, inclui `aviso`. Informe o `ano` (>=2010); use os mesmos códigos administrativos vistos em `senado_contratacoes_lista` ou `senado_execucao_orcamentaria` para cruzar gastos.",
    {
      ano: z.number().int().min(2010).max(2100).describe("Ano de referência"),
      tipo: z.enum(["supridos", "atos-concessao", "empenhos", "movimentacoes", "transacoes"]).optional().default("supridos").describe("Qual relação consultar (padrão: supridos)"),
      filtro: z.string().optional().describe("Filtro textual (nome, unidade...)"),
      limite: z.number().int().min(1).max(500).optional().default(100).describe("Máximo de resultados (padrão: 100)"),
    },
    async (params) => {
      try {
        const tipo = params.tipo ?? "supridos";
        const path = PATHS[tipo](params.ano);
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_suprimento_fundos",
          { ano: params.ano, tipo },
          CACHE_STATIC,
          () => admFetch(path, {}, admBaseUrl),
        );
        let lista = ensureArray(response);
        if (params.filtro) {
          const f = params.filtro;
          lista = lista.filter((item: any) => matchesFiltro(JSON.stringify(item), f));
        }
        const limite = params.limite ?? 100;
        const prov = provenanceFor("SENADO_ADM", admBaseUrl, `/api/v1${path}`, {
          dataset_id: `suprimento; tipo=${tipo}; ano=${params.ano}`,
          reference_period: String(params.ano),
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          ano: params.ano,
          tipo,
          count: Math.min(lista.length, limite),
          total: lista.length,
          ...(lista.length > limite ? { aviso: `Exibindo ${limite} de ${lista.length} registros.` } : {}),
          registros: lista.slice(0, limite),
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao consultar suprimento de fundos");
      }
    },
  );
}
