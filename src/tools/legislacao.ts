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
import { digArrayRoot } from "../utils/upstream-parse.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
import { CACHE_ON_DEMAND } from "../types.js";

/** Convert a "DD/MM/AAAA" date to ISO "AAAA-MM-DD"; passes through other strings. */
function brDateToISO(v: any): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}

/** Parse a legislation search result (ListaDocumento.documentos.documento[], lowercase). */
export function parseLegislacaoResumo(l: any) {
  const data = brDateToISO(l.dataassinatura || l.Data || l.data);
  return {
    codigo: l.id || l.Codigo || l.codigo || null,
    tipo: l.tipo || l.TipoNorma || null,
    descricaoTipo: l.descricao || null,
    numero: l.numero || l.Numero || null,
    ano: l.anoassinatura || l.ano || (data ? data.slice(0, 4) : null),
    data,
    norma: l.normaNome || null,
    ementa: l.ementa || l.Ementa || null,
    apelido: l.apelido || null,
  };
}

/** Parse a legislation detail (DetalheDocumento.documentos.documento[0], identificacao nested). */
export function parseLegislacaoDetalhe(doc: any) {
  const id = doc.identificacao || doc;
  const data = brDateToISO(id.dataassinatura || id.Data || id.data);
  return {
    codigo: doc.id || id.id || null,
    tipo: id.tipo || null,
    descricaoTipo: id.descricao || null,
    numero: id.numero || null,
    ano: data ? data.slice(0, 4) : null,
    data,
    norma: id.normaNome || null,
    apelido: id.apelido || null,
    ementa: doc.ementa || null,
    indexacao: ensureArray(doc.indexacao?.frase).join(" ").replace(/\s+/g, " ").trim() || null,
    url: id.urlDocumento || null,
  };
}

export function registerLegislacaoTools(server: McpServer, baseUrl: string) {
  // L1. senado_buscar_legislacao
  server.tool(
    "senado_buscar_legislacao",
    "Busca normas jurídicas federais (leis, decretos, etc.) por `tipo`, `numero`, `ano` ou `data`. Retorna `{ count, normas }`, cada norma com `codigo`, `tipo`, `descricaoTipo`, `numero`, `ano`, `data` (ISO), `norma`, `ementa` e `apelido`. É obrigatório informar ao menos um parâmetro, senão retorna erro. Use o `codigo` retornado em `senado_obter_legislacao` para o detalhe (com indexação e URL do texto); consulte os tipos válidos em `senado_tabelas_referencia` (`tabela: \"tipos-norma\"`).",
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
        const normas = digArrayRoot(
          response,
          [["ListaDocumento", "documentos", "documento"]],
          "senado_buscar_legislacao",
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
    "Obtém os detalhes de uma norma jurídica federal específica pelo seu `codigo`. Retorna um objeto com `codigo`, `tipo`, `descricaoTipo`, `numero`, `ano`, `data` (ISO), `norma`, `apelido`, `ementa`, `indexacao` e `url` do texto integral. Obtenha o `codigo` primeiro via `senado_buscar_legislacao`.",
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
        const docs = digArrayRoot(
          response,
          [["DetalheDocumento", "documentos", "documento"]],
          "senado_obter_legislacao",
        );
        if (docs.length === 0) return toolError("Norma não encontrada.");
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          dataset_id: `norma=${params.codigo}`, retrieved_at: fetchedAt,
        });
        return resultWithProvenance(parseLegislacaoDetalhe(docs[0]), prov);
      } catch (e) {
        return errorFrom(e, "Norma não encontrada");
      }
    },
  );
}
