/**
 * Group O — Senadores/Administrativo (2 tools)
 * senado_ceaps,
 * senado_senadores_admin (enum `tipo`: auxilio-moradia | escritorios-apoio | aposentados)
 *
 * Consumes the ADMINISTRATIVE open data API. The CEAPS dataset is ~10 MB per
 * year with no server-side filters, so the tool fetches once (cached by year)
 * and filters/aggregates in the Worker — never returning the raw dump.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { admFetch, admFetchLarge } from "../throttle/adm.js";
import { errorFrom, ensureArray, normalizeText, parseBRL } from "../utils/validation.js";
import { unwrapAdmEnvelope } from "../utils/upstream-parse.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
import {
  computarEstatisticas,
  arredondarEstatisticas,
  arredondarEntradas,
  type Estatisticas,
  type EstatisticasPorGrupo,
} from "../utils/estatisticas.js";
import { CACHE_SEMI_STATIC, CACHE_STATIC } from "../types.js";

export interface CeapsFiltros {
  mes?: number;
  codSenador?: number;
  nomeSenador?: string;
  tipoDespesa?: string;
  fornecedor?: string;
}

const norm = normalizeText;

/**
 * Read the reimbursed value of a CEAPS row. It arrives as a `number` in this dataset
 * (unlike payroll/execução, which come as pt-BR strings), but `parseBRL` also parses a
 * string vintage and yields 0 for garbage — so totals and statistics reconcile. Shared
 * by `agregarCeaps`, the `totalGeral` sum and the statistics path.
 */
export const valorCeaps = (d: any): number =>
  typeof d.valorReembolsado === "number" ? d.valorReembolsado : parseBRL(d.valorReembolsado);

/** Apply in-Worker filters to raw CEAPS items. */
export function filtrarCeaps(itens: any[], f: CeapsFiltros): any[] {
  return itens.filter((d: any) => {
    if (f.mes && d.mes !== f.mes) return false;
    if (f.codSenador && d.codSenador !== f.codSenador) return false;
    if (f.nomeSenador && !(typeof d.nomeSenador === "string" && norm(d.nomeSenador).includes(norm(f.nomeSenador)))) return false;
    if (f.tipoDespesa && !(typeof d.tipoDespesa === "string" && norm(d.tipoDespesa).includes(norm(f.tipoDespesa)))) return false;
    if (f.fornecedor && !(typeof d.fornecedor === "string" && norm(d.fornecedor).includes(norm(f.fornecedor)))) return false;
    return true;
  });
}

/** Aggregate CEAPS items by a key extractor. */
export function agregarCeaps(itens: any[], chave: (d: any) => string | number, extra?: (d: any) => Record<string, unknown>) {
  const grupos = new Map<string | number, { total: number; qtd: number; extra?: Record<string, unknown> }>();
  for (const d of itens) {
    const k = chave(d);
    const g = grupos.get(k) ?? { total: 0, qtd: 0, extra: extra ? extra(d) : undefined };
    g.total += valorCeaps(d);
    g.qtd += 1;
    grupos.set(k, g);
  }
  return Array.from(grupos.entries())
    .map(([k, g]) => ({ chave: k, ...(g.extra ?? {}), total: Math.round(g.total * 100) / 100, despesas: g.qtd }))
    .sort((a, b) => b.total - a.total);
}

/** Trim a raw CEAPS item for detail output. */
export function parseCeapsItem(d: any) {
  return {
    mes: d.mes ?? null,
    data: d.data || null,
    senador: d.nomeSenador || null,
    codSenador: d.codSenador ?? null,
    tipoDespesa: d.tipoDespesa || null,
    fornecedor: d.fornecedor || null,
    cnpjCpf: d.cpfCnpj || null,
    detalhamento: d.detalhamento || null,
    valor: d.valorReembolsado ?? null,
  };
}


/** Group-key extractor per `agruparPor` (label == key; homonyms/cnpj merges are noted in the aviso). */
const CHAVE_GRUPO_CEAPS: Record<string, (d: any) => string> = {
  senador: (d) => d.nomeSenador || "(sem nome)",
  tipo: (d) => d.tipoDespesa || "(sem tipo)",
  mes: (d) => String(d.mes ?? "?"),
  fornecedor: (d) => d.fornecedor || "(sem fornecedor)",
};

/** Human label for the grouping dimension (`agruparPor`), so responses never echo the raw param name. */
const AGRUPAR_ROTULO: Record<string, string> = {
  senador: "senador",
  tipo: "tipo de despesa",
  mes: "mês",
  fornecedor: "fornecedor",
};

/**
 * Build the `estatisticas=true` response for CEAPS. Each row is one standalone expense
 * (no consolidation, unlike payroll): without `agruparPor` it crunches the distribution
 * over individual expenses (min/máx/média/mediana/desvio/percentis) + top/bottom ranking;
 * with `agruparPor` it ranks the groups by total spend desc (grupos[0] = biggest spender),
 * each carrying its own mini-distribution (no per-group top/bottom, kept lean).
 */
export function estatisticasCeaps(
  filtrado: any[],
  opts: { agruparPor?: "senador" | "tipo" | "mes" | "fornecedor"; topN: number },
) {
  if (opts.agruparPor) {
    const resultado = computarEstatisticas(filtrado, valorCeaps, {
      agruparPor: CHAVE_GRUPO_CEAPS[opts.agruparPor],
      topN: 0, // groups already sorted by total desc = ranking; no per-group extremes
      maxGrupos: 50,
    }) as EstatisticasPorGrupo;
    return {
      agrupadoPor: opts.agruparPor,
      agrupadoPorRotulo: AGRUPAR_ROTULO[opts.agruparPor] ?? opts.agruparPor,
      totalGrupos: resultado.totalGrupos,
      ...(resultado.aviso ? { aviso: resultado.aviso } : {}),
      grupos: resultado.grupos.map((g) => ({ grupo: g.grupo, ...arredondarEstatisticas(g) })),
    };
  }

  const e = computarEstatisticas(filtrado, valorCeaps, {
    topN: opts.topN,
    identificar: (d: any) => ({
      codSenador: d.codSenador ?? null,
      senador: d.nomeSenador ?? null,
      tipoDespesa: d.tipoDespesa ?? null,
      fornecedor: d.fornecedor ?? null,
      data: d.data ?? null,
    }),
    desempate: (d: any) => d.codSenador ?? Number.MAX_SAFE_INTEGER,
  }) as Estatisticas;
  return {
    distribuicao: arredondarEstatisticas(e),
    top: arredondarEntradas(e.top),
    bottom: arredondarEntradas(e.bottom),
  };
}

export function registerSenadoresAdminTools(server: McpServer, admBaseUrl: string) {
  // O1. senado_ceaps
  server.tool(
    "senado_ceaps",
    "Despesas da Cota para Exercício da Atividade Parlamentar (CEAPS) dos senadores em um ano. Para perguntas de **maior/menor/média/mediana/distribuição/ranking** ('quem gastou mais CEAPS', 'gasto mediano', 'distribuição das despesas') use `estatisticas=true`: computa min/máx/média/mediana/desvio/percentis sobre TODAS as despesas filtradas e devolve `top`/`bottom` (padrão 10) com identificadores — os modos agregados só somam por grupo e não revelam a distribuição nem o extremo individual. Sem `agruparPor` → `distribuicao` das despesas individuais + `top`/`bottom`; com `agruparPor` (`senador`/`tipo`/`mes`/`fornecedor`) → `grupos[]` ranqueados por soma decrescente (`grupos[0]` = maior gastador), cada um com sua mini-distribuição. Sem `estatisticas`: nos modos agregados (`por-senador`/`por-tipo`/`por-mes`/`por-fornecedor`, padrão `por-senador`) traz `agregado[]` ordenado por `total` desc com `chave`, `total` e `despesas` (contagem); em `modo='detalhe'` traz `despesas[]` (mês, data, senador, tipoDespesa, fornecedor, cnpjCpf, valor). Filtre por `mes`, `codSenador`, `nomeSenador`, `tipoDespesa` ou `fornecedor` (busca parcial); `limite` cap 100 com `aviso` ao truncar. Obtenha `codSenador` via `senado_listar_senadores`.",
    {
      ano: z.number().int().min(2008).max(2100).describe("Ano das despesas"),
      modo: z.enum(["por-senador", "por-tipo", "por-mes", "por-fornecedor", "detalhe"]).optional().default("por-senador").describe("Agregação ou detalhe (padrão: por-senador). Ignorado quando estatisticas=true"),
      estatisticas: z.boolean().optional().default(false).describe("Computa estatísticas (min/máx/média/mediana/percentis) + ranking top/bottom sobre todas as despesas filtradas. Use para 'quem gastou mais/menos', 'gasto médio/mediano', 'distribuição', 'ranking'"),
      agruparPor: z.enum(["senador", "tipo", "mes", "fornecedor"]).optional().describe("Quando estatisticas=true, ranqueia os grupos por soma decrescente (grupos[0] = maior gastador), cada grupo com sua mini-distribuição"),
      topN: z.number().int().min(1).max(100).optional().default(10).describe("Tamanho das listas top/bottom quando estatisticas=true sem agruparPor (padrão: 10, máx: 100)"),
      mes: z.number().int().min(1).max(12).optional().describe("Filtrar por mês"),
      codSenador: z.number().int().optional().describe("Filtrar por código do senador"),
      nomeSenador: z.string().optional().describe("Filtrar por nome do senador (busca parcial)"),
      tipoDespesa: z.string().optional().describe("Filtrar por tipo de despesa (busca parcial)"),
      fornecedor: z.string().optional().describe("Filtrar por fornecedor (busca parcial)"),
      limite: z.number().int().min(1).max(1000).optional().default(100).describe("Máximo de linhas no resultado (padrão: 100)"),
    },
    async (params) => {
      try {
        // Cache the full year dataset once; filters/aggregation run per call.
        const { value: bruto, fetchedAt } = await cachedFetchWithMeta(
          "senado_ceaps",
          { ano: params.ano },
          CACHE_STATIC,
          () => admFetchLarge(`/senadores/despesas_ceaps/${params.ano}`, {}, admBaseUrl),
        );
        const filtrado = filtrarCeaps(ensureArray(bruto), {
          mes: params.mes,
          codSenador: params.codSenador,
          nomeSenador: params.nomeSenador,
          tipoDespesa: params.tipoDespesa,
          fornecedor: params.fornecedor,
        });
        const totalGeral = Math.round(filtrado.reduce((s, d) => s + valorCeaps(d), 0) * 100) / 100;

        const prov = provenanceFor("SENADO_ADM", admBaseUrl, `/api/v1/senadores/despesas_ceaps/${params.ano}`, {
          dataset_id: `ceaps; ano=${params.ano}`,
          reference_period: params.mes ? `${params.ano}-${String(params.mes).padStart(2, "0")}` : String(params.ano),
          retrieved_at: fetchedAt,
        });

        if (params.estatisticas) {
          return resultWithProvenance({
            ano: params.ano,
            modo: "estatisticas",
            totalDespesas: filtrado.length,
            valorTotal: totalGeral,
            ...estatisticasCeaps(filtrado, { agruparPor: params.agruparPor, topN: params.topN ?? 10 }),
          }, prov);
        }

        const limite = params.limite ?? 100;
        const modo = params.modo ?? "por-senador";

        let resultado: any;
        if (modo === "detalhe") {
          resultado = {
            despesas: filtrado.slice(0, limite).map(parseCeapsItem),
            ...(filtrado.length > limite ? { aviso: `Exibindo ${limite} de ${filtrado.length} despesas. Refine os filtros ou use um modo agregado.` } : {}),
          };
        } else if (modo === "por-tipo") {
          resultado = { agregado: agregarCeaps(filtrado, (d) => d.tipoDespesa || "(sem tipo)").slice(0, limite) };
        } else if (modo === "por-mes") {
          resultado = { agregado: agregarCeaps(filtrado, (d) => d.mes ?? 0).sort((a: any, b: any) => Number(a.chave) - Number(b.chave)) };
        } else if (modo === "por-fornecedor") {
          resultado = { agregado: agregarCeaps(filtrado, (d) => d.cpfCnpj || d.fornecedor || "(sem fornecedor)", (d) => ({ fornecedor: d.fornecedor || null })).slice(0, limite) };
        } else {
          resultado = { agregado: agregarCeaps(filtrado, (d) => d.codSenador ?? 0, (d) => ({ senador: d.nomeSenador || null })).slice(0, limite) };
        }

        return resultWithProvenance({
          ano: params.ano,
          modo,
          totalDespesas: filtrado.length,
          valorTotal: totalGeral,
          ...resultado,
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao consultar despesas CEAPS");
      }
    },
  );

  // O2. senado_senadores_admin (tipo: auxilio-moradia | escritorios-apoio | aposentados)
  server.tool(
    "senado_senadores_admin",
    "Dados administrativos dos senadores conforme o parâmetro `tipo`: " +
      "`auxilio-moradia` → `{ tipo, count, senadores }` (`nome`, `uf`, `partido`, `auxilioMoradia`, `imovelFuncional`; legislatura atual). " +
      "`escritorios-apoio` → `{ tipo, count, escritorios }` (`senador`, `uf`, `partido`, `setor`, `endereco`, `telefone`). " +
      "`aposentados` → `{ tipo, count, aposentados }` ex-senadores aposentados pelos planos de previdência do Congresso (IPC e PSSC), com `nome`, `tipo` do plano, `dataInicial`, `remuneracao`. " +
      "Filtros opcionais `uf` e `nome` (busca parcial) aplicam-se a auxilio-moradia e escritorios-apoio; `nome` também filtra aposentados. Cada `tipo` retorna `count` 0 e lista vazia quando não há registros. Para gastos de cota parlamentar use `senado_ceaps`.",
    {
      tipo: z.enum(["auxilio-moradia", "escritorios-apoio", "aposentados"]).describe("Qual dado administrativo consultar"),
      uf: z.string().max(2).optional().describe("Filtrar por estado (auxilio-moradia/escritorios-apoio)"),
      nome: z.string().optional().describe("Filtrar por nome do senador (busca parcial)"),
    },
    async (params) => {
      try {
        if (params.tipo === "escritorios-apoio") {
          const { value: response, fetchedAt } = await cachedFetchWithMeta(
            "senado_escritorios_apoio", {}, CACHE_SEMI_STATIC,
            () => admFetch("/senadores/escritorios", {}, admBaseUrl),
          );
          // Enveloped ({statusCode,msg,data}); each record nests parlamentar/setor.
          let escritorios = ensureArray(unwrapAdmEnvelope(response)).map((e: any) => ({
            senador: e.parlamentar?.nome || "",
            uf: e.parlamentar?.estado || null,
            partido: e.parlamentar?.partido || null,
            setor: e.setor?.nome || null,
            endereco: e.setor?.endereco || null,
            telefone: e.setor?.telefone || null,
          }));
          if (params.uf) {
            const uf = params.uf.toUpperCase();
            escritorios = escritorios.filter((e) => e.uf?.toUpperCase() === uf);
          }
          if (params.nome) escritorios = escritorios.filter((e) => norm(e.senador).includes(norm(params.nome!)));
          const prov = provenanceFor("SENADO_ADM", admBaseUrl, "/api/v1/senadores/escritorios", {
            dataset_id: "tipo=escritorios-apoio", retrieved_at: fetchedAt,
          });
          return resultWithProvenance({ tipo: params.tipo, count: escritorios.length, escritorios }, prov);
        }

        if (params.tipo === "aposentados") {
          const { value: response, fetchedAt } = await cachedFetchWithMeta(
            "senado_senadores_aposentados", {}, CACHE_SEMI_STATIC,
            () => admFetch("/senadores/aposentados", {}, admBaseUrl),
          );
          let aposentados = ensureArray(unwrapAdmEnvelope(response)).map((a: any) => ({
            nome: a.nome || "",
            tipo: a.tipo || null,
            dataInicial: a.dataInicial || null,
            remuneracao: a.remuneracao ?? null,
          }));
          if (params.nome) aposentados = aposentados.filter((a) => norm(a.nome).includes(norm(params.nome!)));
          const prov = provenanceFor("SENADO_ADM", admBaseUrl, "/api/v1/senadores/aposentados", {
            dataset_id: "tipo=aposentados", retrieved_at: fetchedAt,
          });
          return resultWithProvenance({ tipo: params.tipo, count: aposentados.length, aposentados }, prov);
        }

        // tipo === "auxilio-moradia"
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_auxilio_moradia", {}, CACHE_SEMI_STATIC,
          () => admFetch("/senadores/auxilio-moradia", {}, admBaseUrl),
        );
        let senadores = ensureArray(unwrapAdmEnvelope(response)).map((s: any) => ({
          nome: s.nomeParlamentar || "",
          uf: s.estadoEleito || null,
          partido: s.partidoEleito || null,
          auxilioMoradia: s.auxilioMoradia || null,
          imovelFuncional: s.imovelFuncional || null,
        }));
        if (params.uf) {
          const uf = params.uf.toUpperCase();
          senadores = senadores.filter((s) => s.uf?.toUpperCase() === uf);
        }
        if (params.nome) senadores = senadores.filter((s) => norm(s.nome).includes(norm(params.nome!)));
        const prov = provenanceFor("SENADO_ADM", admBaseUrl, "/api/v1/senadores/auxilio-moradia", {
          dataset_id: "tipo=auxilio-moradia", retrieved_at: fetchedAt,
        });
        return resultWithProvenance({ tipo: params.tipo, count: senadores.length, senadores }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao consultar dados administrativos dos senadores");
      }
    },
  );
}
