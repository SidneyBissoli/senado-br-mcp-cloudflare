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
import {
  computarEstatisticas,
  arredondarEstatisticas,
  arredondarEntradas,
  type Estatisticas,
  type EstatisticasPorGrupo,
} from "../utils/estatisticas.js";
import { CACHE_STATIC } from "../types.js";
import { matchesFiltro } from "./contratacoes.js";

const PATHS: Record<string, (ano: number) => string> = {
  "supridos": (ano) => `/supridos/${ano}`,
  "atos-concessao": (ano) => `/supridos/atosConcessao/${ano}`,
  "empenhos": (ano) => `/supridos/empenhos/${ano}`,
  "movimentacoes": (ano) => `/supridos/movimentacoes/${ano}`,
  "transacoes": (ano) => `/supridos/transacoes/${ano}`,
};

// ── Modo estatísticas ──────────────────────────────────────────────────────
// Suprimento de fundos is the trickiest of the quantitative tools: the value
// column varies by `tipo`, so `campo` is contextual (default per tipo, fallback
// + aviso when incompatible — same pattern as senado_execucao_orcamentaria). The
// admin feed returns amounts already NUMERIC (int/float), not pt-BR strings, so
// no parseBRL — just coercion. Non-numeric/null values are EXCLUDED from the
// distribution (a null card `valor` means "no amount recorded", not "R$ 0").

/** Tipos that carry a numeric value column and therefore support estatísticas. */
export const TIPOS_COM_VALOR = ["transacoes", "empenhos", "atos-concessao"] as const;

/** Value-column config per tipo: the default column (rules the no-`campo` call) + allowed columns. */
export const CAMPOS_POR_TIPO: Record<string, { default: string; campos: string[] }> = {
  transacoes: { default: "valor", campos: ["valor"] },
  empenhos: { default: "valorExecutado", campos: ["valorExecutado", "valorConcedido"] },
  "atos-concessao": {
    default: "valorTotalTransacoes",
    campos: ["valorTotalTransacoes", "valorTotalEmpenhos", "valorTotalElementosDespesa", "valorTotalMovimentacoes"],
  },
};

/** Group-key extractors per tipo (label == key), for `agruparPor`. */
const CHAVES_POR_TIPO: Record<string, Record<string, (r: any) => string>> = {
  transacoes: {
    fornecedor: (r) => String(r.fornecedor ?? "(sem fornecedor)"),
    tipo: (r) => String(r.tipo ?? "(sem tipo)"),
    tipoInscricao: (r) => String(r.tipoInscricao ?? "(sem tipoInscrição)"),
    rubricas: (r) => String(r.rubricas ?? "(sem rubrica)"),
  },
  empenhos: {
    rubrica: (r) => String(r.rubrica ?? "(sem rubrica)"),
    descricao: (r) => String(r.descricao ?? "(sem descrição)"),
  },
  "atos-concessao": {
    elementoDespesa: (r) => String(r.elementoDespesa ?? "(sem elemento)"),
    regimeEspecial: (r) => rotuloRegime(r.regimeEspecial),
  },
};

/** Human label for the analyzed value column — so responses use plain words, never the raw field name. */
const CAMPO_ROTULO: Record<string, string> = {
  valor: "valor da transação",
  valorExecutado: "valor executado (gasto)",
  valorConcedido: "valor concedido (autorizado)",
  valorTotalTransacoes: "total gasto no cartão",
  valorTotalEmpenhos: "total empenhado (autorizado)",
  valorTotalElementosDespesa: "total dos elementos de despesa",
  valorTotalMovimentacoes: "total movimentado",
};

/** Human label for the grouping dimension (`agruparPor`). */
const AGRUPAR_ROTULO: Record<string, string> = {
  fornecedor: "fornecedor",
  tipo: "tipo de transação",
  tipoInscricao: "tipo de inscrição",
  rubricas: "rubrica",
  rubrica: "rubrica",
  descricao: "descrição",
  elementoDespesa: "elemento de despesa",
  regimeEspecial: "regime",
  suprido: "suprido",
};

/** Map the raw regime flag (boolean or S/N) to plain words, so `regimeEspecial = true` never reaches the user. */
function rotuloRegime(v: unknown): string {
  if (v === true || v === "S" || v === "SIM" || v === "s") return "regime especial";
  if (v === false || v === "N" || v === "NAO" || v === "NÃO" || v === "n") return "regime comum";
  return "regime não informado";
}

/** Identifier fields carried into argMax/top per tipo. */
const IDENTIFICAR_POR_TIPO: Record<string, (r: any) => Record<string, unknown>> = {
  transacoes: (r) => ({ fornecedor: r.fornecedor ?? null, data: r.data ?? null, rubricas: r.rubricas ?? null, tipo: r.tipo ?? null }),
  empenhos: (r) => ({ descricao: r.descricao ?? null, rubrica: r.rubrica ?? null, numero: r.numero ?? null, data: r.data ?? null }),
  // `atos-concessao` is handled inline in estatisticasSuprimento: its identifier is enriched with the
  // suprido's NAME (joined from the supridos registry), so the response identifies the beneficiary by
  // name, not by the internal code.
};


/** Read the numeric value of a suprimento record for `campo`. Null/non-numeric → NaN (excluded). */
export function suprimentoValor(r: any, campo: string): number {
  const v = r?.[campo];
  if (v == null) return NaN;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Build the `estatisticas=true` response for suprimento de fundos. `lista` are the raw
 * admin records already filtered by `filtro`. Records whose value column is null/non-numeric
 * are EXCLUDED (reported via aviso). Without `agruparPor` it crunches the distribution over
 * the individual rows + top/bottom ranking; with `agruparPor` it ranks the groups by summed
 * `campo` desc (grupos[0] = biggest). `campo`/`agruparPor` invalid for the `tipo` fall back
 * to the default with an aviso.
 */
export function estatisticasSuprimento(
  lista: any[],
  opts: { tipo: string; campo?: string; agruparPor?: string; topN: number; nomePorCodigo?: Map<string, string> },
) {
  const cfg = CAMPOS_POR_TIPO[opts.tipo];
  const campoInvalido = opts.campo != null && !cfg.campos.includes(opts.campo);
  const campo = opts.campo && cfg.campos.includes(opts.campo) ? opts.campo : cfg.default;

  // atos-concessao: the beneficiary's name (joined from the supridos registry) is the public
  // identifier; the internal code is kept only for disambiguation. Enables agruparPor=suprido too.
  const nomeSuprido = (r: any): string | null =>
    opts.nomePorCodigo?.get(String(r.codigo_suprido)) ?? null;
  const identificar =
    opts.tipo === "atos-concessao"
      ? (r: any) => ({
          codigoAtoConcessao: r.codigoAtoConcessao ?? null,
          data: r.data ?? null,
          regime: rotuloRegime(r.regimeEspecial),
          suprido: nomeSuprido(r),
          codigoInternoSuprido: r.codigo_suprido ?? null,
        })
      : IDENTIFICAR_POR_TIPO[opts.tipo];

  const chaves =
    opts.tipo === "atos-concessao"
      ? { ...CHAVES_POR_TIPO[opts.tipo], suprido: (r: any) => nomeSuprido(r) ?? "(suprido não identificado)" }
      : CHAVES_POR_TIPO[opts.tipo];
  const agrupar = opts.agruparPor && chaves[opts.agruparPor] ? chaves[opts.agruparPor] : undefined;
  const agruparInvalido = opts.agruparPor != null && !agrupar;

  // Exclude rows without a numeric value from the distribution.
  const validos = lista.filter((r) => Number.isFinite(suprimentoValor(r, campo)));
  const excluidos = lista.length - validos.length;

  // Avisos are user-facing: describe adjustments in plain words, never with raw field/param names.
  const avisos: string[] = [];
  if (campoInvalido) avisos.push(`A medida solicitada não está disponível para esta relação; a estatística usa: ${CAMPO_ROTULO[campo] ?? campo}.`);
  if (agruparInvalido) avisos.push(`O agrupamento solicitado não se aplica a esta relação; os resultados não foram agrupados.`);
  if (excluidos > 0) avisos.push(`${excluidos} de ${lista.length} registros sem valor informado foram excluídos das estatísticas.`);

  const acessor = (r: any) => suprimentoValor(r, campo);

  if (agrupar) {
    const resultado = computarEstatisticas(validos, acessor, {
      agruparPor: agrupar,
      topN: 0, // groups already sorted by total desc = ranking; no per-group extremes
      maxGrupos: 50,
    }) as EstatisticasPorGrupo;
    const aviso = [resultado.aviso, ...avisos].filter(Boolean).join(" ");
    return {
      campoAnalisado: CAMPO_ROTULO[campo] ?? campo,
      agrupadoPorRotulo: opts.agruparPor ? (AGRUPAR_ROTULO[opts.agruparPor] ?? opts.agruparPor) : undefined,
      totalGrupos: resultado.totalGrupos,
      ...(aviso ? { aviso } : {}),
      grupos: resultado.grupos.map((g) => ({ grupo: g.grupo, ...arredondarEstatisticas(g) })),
    };
  }

  const e = computarEstatisticas(validos, acessor, {
    topN: opts.topN,
    identificar,
  }) as Estatisticas;
  return {
    campoAnalisado: CAMPO_ROTULO[campo] ?? campo,
    ...(avisos.length ? { aviso: avisos.join(" ") } : {}),
    distribuicao: arredondarEstatisticas(e),
    top: arredondarEntradas(e.top),
    bottom: arredondarEntradas(e.bottom),
  };
}

/**
 * Build a `codigo -> nome` map of supridos for a year, from the registry (tipo=supridos, ~1 MB),
 * so `atos-concessao` statistics can identify the beneficiary by NAME instead of the internal code.
 * Cached by year; a fetch failure degrades to an empty map (entries fall back to name = null).
 */
export async function nomesSupridos(ano: number, admBaseUrl: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { value } = await cachedFetchWithMeta(
      "senado_suprimento_fundos_nomes",
      { ano },
      CACHE_STATIC,
      () => admFetch(PATHS["supridos"](ano), {}, admBaseUrl),
    );
    for (const s of ensureArray(value) as any[]) {
      const cod = s?.codigo != null ? String(s.codigo) : null;
      if (cod && s?.nome) map.set(cod, String(s.nome));
    }
  } catch {
    // best-effort enrichment; the ranking still works without names
  }
  return map;
}

export function registerSupridosTools(server: McpServer, admBaseUrl: string) {
  // R1. senado_suprimento_fundos
  server.tool(
    "senado_suprimento_fundos",
    "Suprimento de fundos do Senado (adiantamentos a supridos): relação anual de supridos, atos de concessão, empenhos, movimentações ou transações de cartão corporativo, conforme `tipo`. Retorna `{ ano, tipo, count, total, registros }` (snake_case da API administrativa), filtrável por `filtro` textual e limitado por `limite` (padrão 100, máx 500); ao truncar, inclui `aviso`. Para maior/menor/média/mediana/distribuição/ranking ('quem mais recebeu', 'fornecedor com maior gasto', 'valor mediano') use `estatisticas=true` (só nos tipos `transacoes`, `empenhos`, `atos-concessao` — os demais não têm coluna de valor): SEM `agruparPor` = distribuição das linhas (min/máx/média/mediana/percentis) + top/bottom; COM `agruparPor` = grupos ranqueados por soma decrescente (grupos[0]=maior). A coluna de valor analisada é escolhida automaticamente conforme o `tipo`; o resultado já traz o rótulo legível dela em `campoAnalisado`. Registros sem valor são excluídos das estatísticas. Em atos de concessão, cada beneficiário é identificado pelo NOME (cruzado com o cadastro de supridos) e pode-se usar `agruparPor='suprido'` para ranquear por beneficiário. Informe o `ano` (>=2010); use os mesmos códigos administrativos vistos em `senado_contratacoes_lista` ou `senado_execucao_orcamentaria` para cruzar gastos.",
    {
      ano: z.number().int().min(2010).max(2100).describe("Ano de referência"),
      tipo: z.enum(["supridos", "atos-concessao", "empenhos", "movimentacoes", "transacoes"]).optional().default("supridos").describe("Qual relação consultar (padrão: supridos)"),
      filtro: z.string().optional().describe("Filtro textual (nome, unidade...)"),
      estatisticas: z.boolean().optional().default(false).describe("Distribuição/ranking sobre as linhas: min/máx/média/mediana/percentis + top/bottom, ou grupos ranqueados por soma via agruparPor. Só para tipo transacoes/empenhos/atos-concessao"),
      campo: z.enum(["valor", "valorExecutado", "valorConcedido", "valorTotalTransacoes", "valorTotalEmpenhos", "valorTotalElementosDespesa", "valorTotalMovimentacoes"]).optional().describe("Opcional: força a coluna de valor analisada; por padrão ela é escolhida conforme o tipo. Se a opção não se aplicar ao tipo, o padrão é usado automaticamente."),
      agruparPor: z.enum(["fornecedor", "tipo", "tipoInscricao", "rubricas", "rubrica", "descricao", "elementoDespesa", "regimeEspecial", "suprido"]).optional().describe("Opcional: agrupa e ranqueia os resultados por esta dimensão (as opções válidas dependem do tipo; em atos de concessão, `suprido` agrupa por beneficiário, com o nome)."),
      topN: z.number().int().min(1).max(100).optional().default(10).describe("Tamanho do top/bottom nas estatísticas (padrão: 10)"),
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

        if (params.estatisticas) {
          if (!(TIPOS_COM_VALOR as readonly string[]).includes(tipo)) {
            // supridos/movimentacoes têm cadastro/sem coluna de valor: devolve a listagem normal com aviso.
            return resultWithProvenance({
              ano: params.ano,
              tipo,
              count: Math.min(lista.length, limite),
              total: lista.length,
              aviso: `Esta relação não possui valores monetários; estatísticas indisponíveis. Peça as transações de cartão, os empenhos ou os atos de concessão.`,
              registros: lista.slice(0, limite),
            }, prov);
          }
          // atos-concessao: join the supridos registry so entries carry the beneficiary's NAME.
          const nomePorCodigo = tipo === "atos-concessao" ? await nomesSupridos(params.ano, admBaseUrl) : undefined;
          return resultWithProvenance({
            ano: params.ano,
            tipo,
            modo: "estatisticas",
            total: lista.length,
            ...estatisticasSuprimento(lista, { tipo, campo: params.campo, agruparPor: params.agruparPor, topN: params.topN ?? 10, nomePorCodigo }),
          }, prov);
        }

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
