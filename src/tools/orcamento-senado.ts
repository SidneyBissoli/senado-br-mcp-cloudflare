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
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { errorFrom, ensureArray, safeInt, parseBRL } from "../utils/validation.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
import {
  computarEstatisticas,
  arredondarEstatisticas,
  arredondarEntradas,
  type Estatisticas,
  type EstatisticasPorGrupo,
} from "../utils/estatisticas.js";
import { CACHE_STATIC } from "../types.js";

const FINANCEIRO_BASE = "https://www.senado.gov.br";
const PATH_DESPESAS = "/bi-arqs/Arquimedes/Financeiro/DespesaSenadoDadosAbertos.json";
const PATH_RECEITAS = "/bi-arqs/Arquimedes/Financeiro/ReceitasSenadoDadosAbertos.json";

/**
 * Parse a Brazilian decimal string ("1.234,56" or "1234,56") into a number.
 * Thin wrapper over the shared `parseBRL` (kept as a named export for existing tests
 * and call sites in this module).
 */
export function parseValorBR(v: unknown): number {
  return parseBRL(v);
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

// ── Modo estatísticas ──────────────────────────────────────────────────────
// Unlike CEAPS/payroll this tool carries TWO datasets (despesas vs receitas) and
// several value columns per dataset (no single canonical amount), so `campo` is a
// real parameter here. Everything else follows the CEAPS template.


/** Value-column accessors per tipo. The default column (paid / collected) rules the no-arg call. */
const ACESSOR_DESPESA: Record<string, (d: any) => number> = {
  pago: (d) => d.pago,
  liquidado: (d) => d.liquidado,
  empenhado: (d) => d.empenhado,
  dotacaoInicial: (d) => d.dotacaoInicial,
  dotacaoAtualizada: (d) => d.dotacaoAtualizada,
};
const ACESSOR_RECEITA: Record<string, (r: any) => number> = {
  arrecadada: (r) => r.arrecadada,
  prevista: (r) => r.prevista,
};

/** Group-key extractors per `agruparPor`, keyed by tipo (label == key). */
const CHAVE_DESPESA: Record<string, (d: any) => string> = {
  ano: (d) => String(d.exercicio ?? "?"),
  acao: (d) => d.acao || "(sem ação)",
  grupo: (d) => d.grupoDespesa || "(sem grupo)",
  fonte: (d) => d.fonte || "(sem fonte)",
  modalidade: (d) => d.modalidade || "(sem modalidade)",
  resultadoLei: (d) => d.resultadoLei || "(sem resultado)",
  plano: (d) => d.planoOrcamentario || "(sem plano)",
};
const CHAVE_RECEITA: Record<string, (r: any) => string> = {
  origem: (r) => r.origem || "(sem origem)",
  ano: (r) => String(r.ano ?? "?"),
  categoria: (r) => r.categoria || "(sem categoria)",
  especie: (r) => r.especie || "(sem espécie)",
  natureza: (r) => r.natureza || "(sem natureza)",
};

/** Human label for the analyzed value column — responses use plain words, never the raw field name. */
const CAMPO_ROTULO: Record<string, string> = {
  pago: "valor pago",
  liquidado: "valor liquidado",
  empenhado: "valor empenhado",
  dotacaoInicial: "dotação inicial",
  dotacaoAtualizada: "dotação atualizada",
  arrecadada: "valor arrecadado",
  prevista: "valor previsto",
};

/** Human label for the grouping dimension (`agruparPor`). */
const AGRUPAR_ROTULO: Record<string, string> = {
  ano: "ano",
  acao: "ação",
  grupo: "grupo de despesa",
  fonte: "fonte",
  modalidade: "modalidade",
  resultadoLei: "resultado primário",
  plano: "plano orçamentário",
  origem: "origem da receita",
  categoria: "categoria",
  especie: "espécie",
  natureza: "natureza",
};

/**
 * Build the `estatisticas=true` response for budget execution. `itens` are already
 * normalized (parseDespesa|parseReceita) and filtered by `ano`. Without `agruparPor`
 * it crunches the distribution over individual budget cells + top/bottom ranking; with
 * `agruparPor` it ranks the groups by summed `campo` desc (grupos[0] = biggest).
 * `campo`/`agruparPor` that don't apply to the `tipo` fall back to the default with an aviso.
 */
export function estatisticasExecucao(
  itens: any[],
  opts: { tipo: "despesas" | "receitas"; campo?: string; agruparPor?: string; topN: number },
) {
  const acessores = opts.tipo === "despesas" ? ACESSOR_DESPESA : ACESSOR_RECEITA;
  const campoDefault = opts.tipo === "despesas" ? "pago" : "arrecadada";
  const campoInvalido = opts.campo != null && !acessores[opts.campo];
  const campo = opts.campo && acessores[opts.campo] ? opts.campo : campoDefault;

  const chaves = opts.tipo === "despesas" ? CHAVE_DESPESA : CHAVE_RECEITA;
  const agrupar = opts.agruparPor && chaves[opts.agruparPor] ? chaves[opts.agruparPor] : undefined;
  const agruparInvalido = opts.agruparPor != null && !agrupar;

  // Avisos are user-facing: describe adjustments in plain words, never with raw field/param names.
  const avisos: string[] = [];
  if (campoInvalido) avisos.push(`A medida solicitada não está disponível para ${opts.tipo}; a estatística usa: ${CAMPO_ROTULO[campo] ?? campo}.`);
  if (agruparInvalido) avisos.push(`O agrupamento solicitado não se aplica a ${opts.tipo}; os resultados não foram agrupados.`);

  if (agrupar) {
    const resultado = computarEstatisticas(itens, acessores[campo], {
      agruparPor: agrupar,
      topN: 0, // groups already sorted by total desc = ranking; no per-group extremes
      maxGrupos: 50,
    }) as EstatisticasPorGrupo;
    const aviso = [resultado.aviso, ...avisos].filter(Boolean).join(" ");
    return {
      campo,
      campoAnalisado: CAMPO_ROTULO[campo] ?? campo,
      agrupadoPor: opts.agruparPor,
      agrupadoPorRotulo: opts.agruparPor ? (AGRUPAR_ROTULO[opts.agruparPor] ?? opts.agruparPor) : undefined,
      totalGrupos: resultado.totalGrupos,
      ...(aviso ? { aviso } : {}),
      grupos: resultado.grupos.map((g) => ({ grupo: g.grupo, ...arredondarEstatisticas(g) })),
    };
  }

  const e = computarEstatisticas(itens, acessores[campo], {
    topN: opts.topN,
    identificar: opts.tipo === "despesas"
      ? (d: any) => ({ exercicio: d.exercicio ?? null, acao: d.acao ?? null, grupoDespesa: d.grupoDespesa ?? null, fonte: d.fonte ?? null })
      : (r: any) => ({ ano: r.ano ?? null, origem: r.origem ?? null, especie: r.especie ?? null, mes: r.mes ?? null }),
  }) as Estatisticas;
  return {
    campo,
    campoAnalisado: CAMPO_ROTULO[campo] ?? campo,
    ...(avisos.length ? { aviso: avisos.join(" ") } : {}),
    distribuicao: arredondarEstatisticas(e),
    top: arredondarEntradas(e.top),
    bottom: arredondarEntradas(e.bottom),
  };
}

export function registerOrcamentoSenadoTools(server: McpServer) {
  // S1. senado_execucao_orcamentaria
  server.tool(
    "senado_execucao_orcamentaria",
    "Execução orçamentária do Senado: despesas (dotação, empenhado, liquidado, pago; desde 2013) ou receitas próprias (previstas e arrecadadas; desde 2012). Para maior/menor/média/mediana/distribuição/ranking ('quanto o Senado pagou/arrecadou com X', 'maior grupo de despesa') use `estatisticas=true`: SEM `agruparPor` = distribuição das linhas (min/máx/média/mediana/percentis) + top/bottom; COM `agruparPor` = grupos ranqueados por soma do `campo` (grupos[0]=maior). `campo` escolhe a coluna (despesas padrão `pago`; receitas padrão `arrecadada`); `campo`/`agruparPor` inválidos para o `tipo` caem no default com `aviso`. Retorna `{ tipo, modo, ano, totalLinhas, ... }`: nos modos agregados, `agregado[]` com `{ chave, ...valores }` ordenado por valor; em `detalhe`, `despesas[]`/`receitas[]` limitado por `limite` (padrão 100, com `aviso` ao truncar). Use `tipo=despesas` com `modo` por-ano/por-acao/por-grupo/por-fonte e `tipo=receitas` com por-origem; filtre por `ano` para reduzir o volume antes de pedir `detalhe`. Única ferramenta de orçamento interno do Senado; não confundir com `senado_orcamento_parlamentar` (emendas/ofícios parlamentares ao orçamento da União).",
    {
      tipo: z.enum(["despesas", "receitas"]).optional().default("despesas").describe("despesas = dotação e execução; receitas = receitas próprias"),
      ano: z.number().int().min(2012).max(2100).optional().describe("Filtrar por exercício financeiro"),
      modo: z.enum(["por-ano", "por-acao", "por-grupo", "por-fonte", "por-origem", "detalhe"]).optional().default("por-ano").describe("Agregação (por-acao/por-grupo/por-fonte: despesas; por-origem: receitas) ou detalhe. Ignorado quando estatisticas=true"),
      estatisticas: z.boolean().optional().default(false).describe("Distribuição/ranking sobre as linhas: min/máx/média/mediana/percentis + top/bottom, ou grupos ranqueados por soma via agruparPor"),
      campo: z.enum(["pago", "liquidado", "empenhado", "dotacaoInicial", "dotacaoAtualizada", "arrecadada", "prevista"]).optional().describe("Coluna de valor para estatísticas (despesas padrão `pago`; receitas padrão `arrecadada`)"),
      agruparPor: z.enum(["ano", "acao", "grupo", "fonte", "modalidade", "resultadoLei", "plano", "origem", "categoria", "especie", "natureza"]).optional().describe("Ranquear grupos por soma do campo (despesas: ano/acao/grupo/fonte/modalidade/resultadoLei/plano; receitas: origem/ano/categoria/especie/natureza)"),
      topN: z.number().int().min(1).max(100).optional().default(10).describe("Tamanho do top/bottom nas estatísticas (padrão: 10)"),
      limite: z.number().int().min(1).max(1000).optional().default(100).describe("Máximo de linhas (padrão: 100)"),
    },
    async (params) => {
      try {
        const tipo = params.tipo ?? "despesas";
        const modo = params.modo ?? "por-ano";
        const limite = params.limite ?? 100;
        const feedPath = tipo === "despesas" ? PATH_DESPESAS : PATH_RECEITAS;
        const { value: bruto, fetchedAt } = await cachedFetchWithMeta(
          "senado_execucao_orcamentaria",
          { tipo },
          CACHE_STATIC,
          () => upstreamFetch(feedPath, {}, FINANCEIRO_BASE, { noJsonSuffix: true }),
        );
        const prov = provenanceFor("SENADO_ORCAMENTO_EXEC", FINANCEIRO_BASE, feedPath, {
          dataset_id: `tipo=${tipo}`,
          reference_period: params.ano ? String(params.ano) : undefined,
          retrieved_at: fetchedAt,
        });

        if (params.estatisticas) {
          const itens = tipo === "despesas"
            ? ensureArray((bruto as any)?.despesas).map(parseDespesa).filter((d) => !params.ano || d.exercicio === params.ano)
            : ensureArray((bruto as any)?.receitas).map(parseReceita).filter((r) => !params.ano || r.ano === params.ano);
          return resultWithProvenance({
            tipo,
            modo: "estatisticas",
            ano: params.ano ?? null,
            totalLinhas: itens.length,
            ...estatisticasExecucao(itens, { tipo, campo: params.campo, agruparPor: params.agruparPor, topN: params.topN ?? 10 }),
          }, prov);
        }

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
          return resultWithProvenance({ tipo, modo, ano: params.ano ?? null, totalLinhas: itens.length, ...resultado }, prov);
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
        return resultWithProvenance({ tipo, modo, ano: params.ano ?? null, totalLinhas: itens.length, ...resultado }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao consultar execução orçamentária");
      }
    },
  );
}
