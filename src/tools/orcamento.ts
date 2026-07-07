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
import { CACHE_SEMI_STATIC, MAX_RESPONSE_SIZE_LARGE } from "../types.js";

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

/**
 * Parse a destination-indication letter (ofício). Each oficio routes the funds of one or
 * more already-approved amendments (execution phase); the heavy `emendas[]` detail is
 * projected out by default. When `ano` is given, only that budget year's emendas are
 * counted/returned; with `incluirEmendas`, the per-emenda execution detail is included.
 */
export function parseOficio(o: any, ano?: number, incluirEmendas = false) {
  const emendas = ensureArray(o.emendas);
  const doAno = ano ? emendas.filter((e: any) => String(e.ano) === String(ano)) : emendas;
  const base: Record<string, unknown> = {
    id: o.id ?? null,
    autor: [o.tratamento, o.nome].filter(Boolean).join(" ").trim() || o.nome || null,
    protocolo: o.numeroProtocoloApresentacao || null,
    dataInclusao: o.dataInclusao ? String(o.dataInclusao).split("T")[0] : null,
    quantidadeEmendas: doAno.length,
  };
  if (incluirEmendas) {
    base.emendas = doAno.map((e: any) => ({
      numero: e.numero || null,
      ano: e.ano || null,
      tipo: e.tipo || null,
      autor: e.autor || null,
      favorecido: e.nomeFavorecido || null,
      cnpjFavorecido: e.cnpjFavorecido || null,
      orgao: e.nomeOrgaoUge || null,
      acaoOrcamentaria: e.acaoOrcamentaria || null,
      notaEmpenho: e.notaEmpenho || null,
    }));
  }
  return base;
}

export function registerOrcamentoTools(server: McpServer, baseUrl: string) {
  // K1. senado_orcamento_parlamentar (tipo: emendas | oficios)
  server.tool(
    "senado_orcamento_parlamentar",
    "Emendas parlamentares ao orçamento da União, conforme `tipo` (padrão `emendas`). " +
      "`tipo: emendas` (proposição) → `{ tipo, count, emendas }`, cada item (lote de emendas de um autor) com `autor`, `codigoAutor`, `quantidadeEmendas`, `anoExecucao`, `materia` (peça orçamentária, p.ex. `LOA 29/2023`), `tipoPl`, `dataOperacao` e `ativo`. " +
      "`tipo: oficios` (execução — indicação de destino de emendas já aprovadas) → `{ tipo, ano, count, total, aviso?, oficios }`, cada ofício com `id`, `autor`, `protocolo`, `dataInclusao` e `quantidadeEmendas`; filtre pelo `ano` do orçamento da emenda (recomendado — a base cobre vários anos), pagine com `limite`/`pagina`, e use `incluirEmendas: true` para o detalhe de cada emenda (favorecido, CNPJ, órgão, nota de empenho). " +
      "Nota: no modo oficios, o ofício é o documento de execução que indica o destino do recurso de uma emenda já aprovada (posterior à proposição); a data do ofício difere do ano do orçamento. " +
      "Para a execução do orçamento interno do próprio Senado (despesas/receitas) use `senado_execucao_orcamentaria`.",
    {
      tipo: z.enum(["emendas", "oficios"]).optional().default("emendas").describe("emendas (lotes de emendas propostas) ou oficios (ofícios de indicação de destino)"),
      ano: z.number().int().min(1990).max(2100).optional().describe("Ano do orçamento da emenda (filtra tipo=oficios pelo ano das emendas)"),
      limite: z.number().int().min(1).max(500).optional().default(50).describe("Máximo de ofícios por página (tipo=oficios; padrão 50)"),
      pagina: z.number().int().min(1).optional().default(1).describe("Página de ofícios (tipo=oficios; padrão 1)"),
      incluirEmendas: z.boolean().optional().default(false).describe("tipo=oficios: incluir o detalhe das emendas (favorecido, CNPJ, nota de empenho)"),
    },
    async (params) => {
      try {
        const tipo = params.tipo ?? "emendas";
        if (tipo === "oficios") {
          // ~8 MB flat array — raise the fetch guard, then project/paginate so the response
          // stays small (the bulk is each oficio's emendas[] detail).
          const { value: response, fetchedAt } = await cachedFetchWithMeta(
            "senado_orcamento_oficios",
            {},
            CACHE_SEMI_STATIC,
            () => upstreamFetch("/orcamento/oficios", {}, baseUrl, { maxSize: MAX_RESPONSE_SIZE_LARGE }),
          );
          let todos = digArrayRoot(
            response,
            [["OrcamentoOficios", "Oficios", "Oficio"], []],
            "senado_orcamento_parlamentar:oficios",
          );
          if (params.ano) {
            todos = todos.filter((o: any) => ensureArray(o.emendas).some((e: any) => String(e.ano) === String(params.ano)));
          }
          const limite = params.limite ?? 50;
          const offset = ((params.pagina ?? 1) - 1) * limite;
          const oficios = todos
            .slice(offset, offset + limite)
            .map((o) => parseOficio(o, params.ano, params.incluirEmendas ?? false));
          const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/orcamento/oficios", {
            dataset_id: `tipo=oficios${params.ano ? `; ano=${params.ano}` : ""}`,
            reference_period: params.ano ? String(params.ano) : undefined,
            retrieved_at: fetchedAt,
          });
          return resultWithProvenance({
            tipo,
            ano: params.ano ?? null,
            count: oficios.length,
            total: todos.length,
            ...(todos.length > offset + limite ? { aviso: `Exibindo ${oficios.length} de ${todos.length} ofícios${params.ano ? ` com emendas do orçamento de ${params.ano}` : ""}. Use pagina para navegar.` } : {}),
            oficios,
          }, prov);
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
