/**
 * Group S — Orçamento do Senado / Budget Execution (1 tool)
 * senado_execucao_orcamentaria
 *
 * Consumes the Arquimedes/Financeiro JSON feeds (updated daily):
 *  - DespesaSenadoDadosAbertos.json — dotação e despesas desde 2013
 *  - ReceitasSenadoDadosAbertos.json — receitas próprias desde 2012
 *
 * Despesa amounts arrive as Brazilian-format strings ("10800,00") and are
 * normalized to numbers; aggregation happens in-Worker.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, errorFrom, ensureArray, safeInt } from "../utils/validation.js";
import { CACHE_STATIC } from "../types.js";

const FINANCEIRO_BASE = "https://www.senado.gov.br";
const PATH_DESPESAS = "/bi-arqs/Arquimedes/Financeiro/DespesaSenadoDadosAbertos.json";
const PATH_RECEITAS = "/bi-arqs/Arquimedes/Financeiro/ReceitasSenadoDadosAbertos.json";

/** Parse a Brazilian decimal string ("1.234,56" or "1234,56") into a number. */
export function parseValorBR(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return 0;
  const n = parseFloat(v.replace(/\./g, "").replace(",", "."));
  return Number.isNaN(n) ? 0 : n;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Normalize a despesa item (decimal-comma strings → numbers). */
export function parseDespesa(d: any) {
  return {
    exercicio: d["exercício_financeiro_lan_ef"] ?? d.exercicio_financeiro_lan_ef ?? null,
    acao: d.acao_codigo ? `${d.acao_codigo} - ${d.acao_nome || ""}`.trim() : null,
    planoOrcamentario: d.plano_orcamentario_nome || null,
    grupoDespesa: d.grupo_despesa_nome || null,
    modalidade: d.modalidade_aplicacao_nome || null,
    fonte: d.fonte_nome || null,
    resultadoLei: d.resultado_lei_nome || null,
    dotacaoInicial: parseValorBR(d.valor_dotacao_inicial),
    dotacaoAtualizada: parseValorBR(d.valor_dotacao_atualizada),
    empenhado: parseValorBR(d.valor_total_empenhado),
    liquidado: parseValorBR(d.valor_liquidado),
    pago: parseValorBR(d.valor_pago),
  };
}

/** Normalize a receita item. */
export function parseReceita(r: any) {
  return {
    ano: safeInt(r.ano),
    mes: safeInt(r.mes),
    categoria: r.categoria_economica_cod_desc || null,
    origem: r.origem_cod_desc || null,
    especie: r.especie_cod_desc || null,
    natureza: r.natureza_receita_cod_desc || null,
    prevista: typeof r.receita_anual_prevista === "number" ? r.receita_anual_prevista : parseValorBR(r.receita_anual_prevista),
    arrecadada: typeof r.receita_arrecadada === "number" ? r.receita_arrecadada : parseValorBR(r.receita_arrecadada),
  };
}

/** Aggregate normalized despesas by a key, summing the five value columns. */
export function agregarDespesas(itens: ReturnType<typeof parseDespesa>[], chave: (d: any) => string) {
  const grupos = new Map<string, any>();
  for (const d of itens) {
    const k = chave(d) || "(não informado)";
    const g = grupos.get(k) ?? { chave: k, dotacaoInicial: 0, dotacaoAtualizada: 0, empenhado: 0, liquidado: 0, pago: 0 };
    g.dotacaoInicial += d.dotacaoInicial;
    g.dotacaoAtualizada += d.dotacaoAtualizada;
    g.empenhado += d.empenhado;
    g.liquidado += d.liquidado;
    g.pago += d.pago;
    grupos.set(k, g);
  }
  return Array.from(grupos.values())
    .map((g) => ({ ...g, dotacaoInicial: round2(g.dotacaoInicial), dotacaoAtualizada: round2(g.dotacaoAtualizada), empenhado: round2(g.empenhado), liquidado: round2(g.liquidado), pago: round2(g.pago) }))
    .sort((a, b) => b.dotacaoAtualizada - a.dotacaoAtualizada);
}

export function registerOrcamentoSenadoTools(server: McpServer) {
  // S1. senado_execucao_orcamentaria
  server.tool(
    "senado_execucao_orcamentaria",
    "Execução orçamentária do Senado Federal: dotação autorizada e despesas (empenhadas, liquidadas e pagas, desde 2013) ou receitas próprias (previstas e arrecadadas, desde 2012). Agregações por exercício, ação, grupo de despesa, fonte ou origem de receita.",
    {
      tipo: z.enum(["despesas", "receitas"]).optional().default("despesas").describe("despesas = dotação e execução; receitas = receitas próprias"),
      ano: z.number().int().min(2012).max(2100).optional().describe("Filtrar por exercício financeiro"),
      modo: z.enum(["por-ano", "por-acao", "por-grupo", "por-fonte", "por-origem", "detalhe"]).optional().default("por-ano").describe("Agregação (por-acao/por-grupo/por-fonte: despesas; por-origem: receitas) ou detalhe"),
      limite: z.number().int().min(1).max(1000).optional().default(100).describe("Máximo de linhas (padrão: 100)"),
    },
    async (params) => {
      try {
        const tipo = params.tipo ?? "despesas";
        const modo = params.modo ?? "por-ano";
        const limite = params.limite ?? 100;
        const bruto = await cachedFetch(
          "senado_execucao_orcamentaria",
          { tipo },
          CACHE_STATIC,
          () => upstreamFetch(tipo === "despesas" ? PATH_DESPESAS : PATH_RECEITAS, {}, FINANCEIRO_BASE, { noJsonSuffix: true }),
        );

        if (tipo === "despesas") {
          let itens = ensureArray((bruto as any)?.despesas).map(parseDespesa);
          if (params.ano) itens = itens.filter((d) => d.exercicio === params.ano);
          let resultado: any;
          if (modo === "detalhe") {
            resultado = {
              despesas: itens.slice(0, limite),
              ...(itens.length > limite ? { aviso: `Exibindo ${limite} de ${itens.length} linhas. Filtre por ano ou use um modo agregado.` } : {}),
            };
          } else {
            const chave = modo === "por-acao" ? (d: any) => d.acao
              : modo === "por-grupo" ? (d: any) => d.grupoDespesa
              : modo === "por-fonte" ? (d: any) => d.fonte
              : (d: any) => String(d.exercicio ?? "?");
            let agregado = agregarDespesas(itens, chave);
            if (modo === "por-ano") agregado = agregado.sort((a, b) => String(a.chave).localeCompare(String(b.chave)));
            resultado = { agregado: agregado.slice(0, limite) };
          }
          return toolResult({ tipo, modo, ano: params.ano ?? null, totalLinhas: itens.length, ...resultado });
        }

        // receitas
        let itens = ensureArray((bruto as any)?.receitas).map(parseReceita);
        if (params.ano) itens = itens.filter((r) => r.ano === params.ano);
        let resultado: any;
        if (modo === "detalhe") {
          resultado = {
            receitas: itens.slice(0, limite),
            ...(itens.length > limite ? { aviso: `Exibindo ${limite} de ${itens.length} linhas. Filtre por ano ou use um modo agregado.` } : {}),
          };
        } else {
          const chave = modo === "por-origem" ? (r: any) => r.origem || "(sem origem)" : (r: any) => String(r.ano);
          const grupos = new Map<string, { chave: string; prevista: number; arrecadada: number; lancamentos: number }>();
          for (const r of itens) {
            const k = chave(r);
            const g = grupos.get(k) ?? { chave: k, prevista: 0, arrecadada: 0, lancamentos: 0 };
            g.prevista += r.prevista;
            g.arrecadada += r.arrecadada;
            g.lancamentos += 1;
            grupos.set(k, g);
          }
          let agregado = Array.from(grupos.values())
            .map((g) => ({ ...g, prevista: round2(g.prevista), arrecadada: round2(g.arrecadada) }));
          agregado = modo === "por-origem"
            ? agregado.sort((a, b) => b.arrecadada - a.arrecadada)
            : agregado.sort((a, b) => a.chave.localeCompare(b.chave));
          resultado = { agregado: agregado.slice(0, limite) };
        }
        return toolResult({ tipo, modo, ano: params.ano ?? null, totalLinhas: itens.length, ...resultado });
      } catch (e) {
        return errorFrom(e, "Erro ao consultar execução orçamentária");
      }
    },
  );
}
