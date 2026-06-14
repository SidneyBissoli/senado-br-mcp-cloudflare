/**
 * Group H — Reference/metadata (1 consolidated tool)
 * senado_tabelas_referencia — enum `tabela` switches between the reference lookups
 * that used to be separate tools (tipos-materia, partidos, ufs, legislatura-atual,
 * tipos-norma, tipos-uso-palavra). Mirrors the senado_tabelas_processo / _plenario pattern.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, errorFrom, ensureArray } from "../utils/validation.js";
import { CACHE_STATIC } from "../types.js";

export const TIPOS_MATERIA = [
  { sigla: "PEC", nome: "Proposta de Emenda à Constituição", descricao: "Altera a Constituição Federal" },
  { sigla: "PL", nome: "Projeto de Lei", descricao: "Projeto de lei ordinária" },
  { sigla: "PLP", nome: "Projeto de Lei Complementar", descricao: "Regulamenta dispositivos constitucionais" },
  { sigla: "MPV", nome: "Medida Provisória", descricao: "Medida com força de lei editada pelo Executivo" },
  { sigla: "PDL", nome: "Projeto de Decreto Legislativo", descricao: "Matéria de competência exclusiva do Congresso" },
  { sigla: "PRS", nome: "Projeto de Resolução do Senado", descricao: "Matéria de competência privativa do Senado" },
  { sigla: "PLC", nome: "Projeto de Lei da Câmara", descricao: "Projeto de lei originário da Câmara dos Deputados" },
  { sigla: "PLS", nome: "Projeto de Lei do Senado", descricao: "Projeto de lei originário do Senado (nomenclatura antiga)" },
  { sigla: "REQ", nome: "Requerimento", descricao: "Solicitação de providência ou informação" },
  { sigla: "RQS", nome: "Requerimento do Senado", descricao: "Requerimento de competência do Senado" },
  { sigla: "INC", nome: "Indicação", descricao: "Sugestão a outro Poder ou órgão" },
  { sigla: "SUG", nome: "Sugestão Legislativa", descricao: "Sugestão da sociedade civil" },
];

export const UFS = [
  { sigla: "AC", nome: "Acre" }, { sigla: "AL", nome: "Alagoas" }, { sigla: "AP", nome: "Amapá" },
  { sigla: "AM", nome: "Amazonas" }, { sigla: "BA", nome: "Bahia" }, { sigla: "CE", nome: "Ceará" },
  { sigla: "DF", nome: "Distrito Federal" }, { sigla: "ES", nome: "Espírito Santo" }, { sigla: "GO", nome: "Goiás" },
  { sigla: "MA", nome: "Maranhão" }, { sigla: "MT", nome: "Mato Grosso" }, { sigla: "MS", nome: "Mato Grosso do Sul" },
  { sigla: "MG", nome: "Minas Gerais" }, { sigla: "PA", nome: "Pará" }, { sigla: "PB", nome: "Paraíba" },
  { sigla: "PR", nome: "Paraná" }, { sigla: "PE", nome: "Pernambuco" }, { sigla: "PI", nome: "Piauí" },
  { sigla: "RJ", nome: "Rio de Janeiro" }, { sigla: "RN", nome: "Rio Grande do Norte" },
  { sigla: "RS", nome: "Rio Grande do Sul" }, { sigla: "RO", nome: "Rondônia" }, { sigla: "RR", nome: "Roraima" },
  { sigla: "SC", nome: "Santa Catarina" }, { sigla: "SP", nome: "São Paulo" }, { sigla: "SE", nome: "Sergipe" },
  { sigla: "TO", nome: "Tocantins" },
];

/** Shared fetcher for the current senators list (used by partidos, ufs, legislatura). */
async function fetchSenadoresAtuais(baseUrl: string) {
  return cachedFetch("_senadores_atuais", {}, CACHE_STATIC, () =>
    upstreamFetch("/senador/lista/atual", {}, baseUrl),
  );
}

export function extractParlamentares(response: any): any[] {
  const list =
    response?.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar ??
    response?.ListaParlamentarLegislatura?.Parlamentares?.Parlamentar;
  return ensureArray(list);
}

/** Derive the current federal legislatura from the senators list. */
export function deriveLegislaturaAtual(parlamentares: any[]) {
  const primeiro = parlamentares[0];
  let legislatura = primeiro?.Mandato?.PrimeiraLegislaturaDoMandato?.NumeroLegislatura;
  if (legislatura) {
    legislatura = parseInt(legislatura);
    const anoInicio = 2023 - (57 - legislatura) * 4;
    return {
      numero: legislatura,
      periodo: `${anoInicio}-${anoInicio + 4}`,
      dataInicio: `${anoInicio}-02-01`,
      dataFim: `${anoInicio + 4}-01-31`,
    };
  }
  // Fallback to the 57th legislatura (2023-2027)
  return { numero: 57, periodo: "2023-2027", dataInicio: "2023-02-01", dataFim: "2027-01-31" };
}

/** Tally seated senators per party (sigla → count). */
export function tabularPartidos(parlamentares: any[]) {
  const counts: Record<string, { sigla: string; nome: string; senadores: number }> = {};
  for (const p of parlamentares) {
    const m = p.Mandato || {};
    const sigla = m.Partido?.SiglaPartido || p.IdentificacaoParlamentar?.SiglaPartidoParlamentar || "S/Partido";
    const nome = m.Partido?.NomePartido || sigla;
    if (!counts[sigla]) counts[sigla] = { sigla, nome, senadores: 0 };
    counts[sigla].senadores++;
  }
  return Object.values(counts).sort((a, b) => b.senadores - a.senadores);
}

/** Tally seated senators per UF. */
export function tabularUfs(parlamentares: any[]) {
  const ufCount: Record<string, number> = {};
  for (const p of parlamentares) {
    const uf = p.Mandato?.UfParlamentar || p.IdentificacaoParlamentar?.UfParlamentar || "";
    if (uf) ufCount[uf] = (ufCount[uf] || 0) + 1;
  }
  return UFS.map((u) => ({ ...u, senadores: ufCount[u.sigla] || 0 }));
}

const TABELAS = [
  "tipos-materia",
  "partidos",
  "ufs",
  "legislatura-atual",
  "tipos-norma",
  "tipos-uso-palavra",
] as const;

export function registerReferenciaTools(server: McpServer, baseUrl: string) {
  // H1. senado_tabelas_referencia (consolida tipos-materia, partidos, ufs,
  // legislatura-atual, tipos-norma e tipos-uso-palavra sob o parâmetro `tabela`).
  server.tool(
    "senado_tabelas_referencia",
    "Consulta tabelas de referência do Senado pelo parâmetro `tabela`. Valores: " +
      "`tipos-materia` → `{ count, tipos }` (sigla/nome/descricao dos tipos de proposição, p.ex. PEC, PL, MPV) — use para achar a `sigla` correta antes de `senado_buscar_materias`/`senado_search_processos`; " +
      "`partidos` → `{ count, totalSenadores, partidos }` (partidos com bancada atual, ordenados por nº de senadores); " +
      "`ufs` → `{ count, totalSenadores, ufs }` (as 27 UFs com a contagem de senadores em exercício); " +
      "`legislatura-atual` → `{ numero, periodo, dataInicio, dataFim }` da legislatura vigente; " +
      "`tipos-norma` → `{ count, tipos }` (sigla/descricao dos tipos de norma para `senado_buscar_legislacao`); " +
      "`tipos-uso-palavra` → `{ count, tipos }` (codigo/descricao para interpretar `tipoUsoPalavra` em `senado_discursos_senador`). " +
      "Toda resposta inclui o campo `tabela`. Para a relação nominal de parlamentares use `senado_listar_senadores`.",
    {
      tabela: z.enum(TABELAS).describe(
        "Qual tabela de referência consultar: tipos-materia, partidos, ufs, legislatura-atual, tipos-norma ou tipos-uso-palavra",
      ),
    },
    async (params) => {
      try {
        switch (params.tabela) {
          case "tipos-materia":
            return toolResult({ tabela: params.tabela, count: TIPOS_MATERIA.length, tipos: TIPOS_MATERIA });

          case "partidos": {
            const parlamentares = extractParlamentares(await fetchSenadoresAtuais(baseUrl));
            const partidos = tabularPartidos(parlamentares);
            return toolResult({ tabela: params.tabela, count: partidos.length, totalSenadores: parlamentares.length, partidos });
          }

          case "ufs": {
            const parlamentares = extractParlamentares(await fetchSenadoresAtuais(baseUrl));
            const ufs = tabularUfs(parlamentares);
            return toolResult({ tabela: params.tabela, count: ufs.length, totalSenadores: parlamentares.length, ufs });
          }

          case "legislatura-atual": {
            const parlamentares = extractParlamentares(await fetchSenadoresAtuais(baseUrl));
            return toolResult({ tabela: params.tabela, ...deriveLegislaturaAtual(parlamentares) });
          }

          case "tipos-norma": {
            const response = await cachedFetch("senado_tipos_norma", {}, CACHE_STATIC, () =>
              upstreamFetch("/legislacao/tiposNorma", {}, baseUrl),
            );
            const r = response as any;
            const tipos = ensureArray(
              r?.ListaTiposNorma?.TiposNorma?.TipoNorma ??
              r?.TiposNorma?.TipoNorma,
            ).map((t: any) => ({
              sigla: t.Sigla || t.sigla || null,
              descricao: t.Descricao || t.descricao || null,
            }));
            return toolResult({ tabela: params.tabela, count: tipos.length, tipos });
          }

          case "tipos-uso-palavra": {
            const response = await cachedFetch("senado_tipos_uso_palavra", {}, CACHE_STATIC, () =>
              upstreamFetch("/senador/lista/tiposUsoPalavra", {}, baseUrl),
            );
            const r = response as any;
            const tipos = ensureArray(
              r?.ListaTiposUsoPalavra?.TiposUsoPalavra?.TipoUsoPalavra ??
              r?.TiposUsoPalavra?.TipoUsoPalavra,
            ).map((t: any) => ({
              codigo: t.Codigo || t.codigo || null,
              descricao: t.Descricao || t.descricao || null,
            }));
            return toolResult({ tabela: params.tabela, count: tipos.length, tipos });
          }
        }
      } catch (e) {
        return errorFrom(e, "Erro ao obter tabela de referência");
      }
    },
  );
}
