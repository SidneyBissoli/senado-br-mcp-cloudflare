/**
 * Group H — Reference/metadata (1 consolidated tool)
 * senado_tabelas_referencia — enum `tabela` switches between the reference lookups
 * that used to be separate tools (tipos-materia, partidos, ufs, legislatura-atual,
 * tipos-norma, tipos-uso-palavra). Mirrors the senado_tabelas_processo / _plenario pattern.
 */

import type { SenadoToolHost } from "../tool-host.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { errorFrom, ensureArray, safeInt } from "../utils/validation.js";
import { RootNotFoundError, digArrayRoot } from "../utils/upstream-parse.js";
import { hojeEmBrasilia } from "../utils/janela.js";
import { NOTA_DERIVACAO_LEGISLATURA, NOTA_DERIVACAO_SOMAS, derivado, provenanceFor, resultWithProvenance, type Provenance } from "../utils/provenance.js";
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

/** Shared fetcher for the current senators list (used by partidos and ufs).
 *  Returns the upstream value + its real extraction timestamp (for provenance). */
async function fetchSenadoresAtuais(baseUrl: string) {
  return cachedFetchWithMeta("_senadores_atuais", {}, CACHE_STATIC, () =>
    upstreamFetch("/senador/lista/atual", {}, baseUrl),
  );
}

export function extractParlamentares(response: any): any[] {
  const list =
    response?.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar ??
    response?.ListaParlamentarLegislatura?.Parlamentares?.Parlamentar;
  return ensureArray(list);
}

/** Upstream path for the legislatura in force on an ISO date (`AAAA-MM-DD` → `/plenario/legislatura/AAAAMMDD`). */
export function caminhoLegislaturaNaData(dataIso: string): string {
  return `/plenario/legislatura/${dataIso.replaceAll("-", "")}`;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The legislatura in force on the queried date, as `/plenario/legislatura/{data}` publishes it:
 * number, start and end are the source's; only `periodo` is composed here, from the years of those
 * two dates. No pinned fallback — a fixed number answers the wrong legislatura, silently, as soon
 * as the next one starts. (The previous reading took the FIRST senator's
 * `PrimeiraLegislaturaDoMandato`, which is the previous legislatura for the two thirds elected
 * four years earlier — measured 15/11/2026: 54 of 81 senators carry 56; right only by list order.)
 */
export function parseLegislaturaVigente(response: unknown) {
  const contexto = "senado_tabelas_referencia:legislatura-atual";
  const leg: any = digArrayRoot(response, [["ListaLegislatura", "Legislaturas", "Legislatura"]], contexto)[0];
  const numero = safeInt(leg?.NumeroLegislatura);
  const dataInicio = leg?.DataInicio;
  const dataFim = leg?.DataFim;
  if (!numero || !DATA_ISO.test(dataInicio ?? "") || !DATA_ISO.test(dataFim ?? "")) {
    throw new RootNotFoundError(
      contexto,
      "A fonte oficial não informou a legislatura vigente (número, início e fim) para a data de hoje. " +
        "Pode indicar mudança de formato no upstream.",
    );
  }
  return { numero, periodo: `${dataInicio.slice(0, 4)}-${dataFim.slice(0, 4)}`, dataInicio, dataFim };
}

/** `tabela=legislatura-atual` (contract v1.3): the `periodo` label is the server's composition. */
export function provenanceDaLegislatura(prov: Provenance): Provenance {
  return derivado(prov, NOTA_DERIVACAO_LEGISLATURA);
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

export function registerReferenciaTools(server: SenadoToolHost, baseUrl: string) {
  // H1. senado_tabelas_referencia (consolida tipos-materia, partidos, ufs,
  // legislatura-atual, tipos-norma e tipos-uso-palavra sob o parâmetro `tabela`).
  server.tool(
    "senado_tabelas_referencia",
    "Consulta tabelas de referência do Senado pelo parâmetro `tabela`. Valores: " +
      "`tipos-materia` → `{ count, tipos }` (sigla/nome/descricao dos tipos de proposição, p.ex. PEC, PL, MPV) — **catálogo curado mantido neste servidor** (12 tipos mais comuns, não é a lista viva do upstream `processo/siglas`, que tem ~184 siglas); use para achar a `sigla` correta antes de `senado_buscar_materias`/`senado_search_processos`; " +
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
          case "tipos-materia": {
            // Catálogo mantido em código (sem ida ao upstream): source_url aponta para a
            // base oficial e retrieved_at faz default ao instante da resposta.
            const prov = provenanceFor("SENADO_LEGIS", baseUrl, "", {
              dataset_id: "catalogo=tipos-materia",
            });
            return resultWithProvenance(
              { tabela: params.tabela, count: TIPOS_MATERIA.length, tipos: TIPOS_MATERIA },
              prov,
            );
          }

          case "partidos": {
            const { value, fetchedAt } = await fetchSenadoresAtuais(baseUrl);
            const parlamentares = extractParlamentares(value);
            const partidos = tabularPartidos(parlamentares);
            const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/senador/lista/atual", {
              dataset_id: "tabela=partidos", retrieved_at: fetchedAt,
            });
            return resultWithProvenance(
              { tabela: params.tabela, count: partidos.length, totalSenadores: parlamentares.length, partidos },
              derivado(prov, NOTA_DERIVACAO_SOMAS),
            );
          }

          case "ufs": {
            const { value, fetchedAt } = await fetchSenadoresAtuais(baseUrl);
            const parlamentares = extractParlamentares(value);
            const ufs = tabularUfs(parlamentares);
            const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/senador/lista/atual", {
              dataset_id: "tabela=ufs", retrieved_at: fetchedAt,
            });
            return resultWithProvenance(
              { tabela: params.tabela, count: ufs.length, totalSenadores: parlamentares.length, ufs },
              derivado(prov, NOTA_DERIVACAO_SOMAS),
            );
          }

          case "legislatura-atual": {
            // Keyed by Brasília's date: the cached answer can never outlive the day it was read for.
            const hoje = hojeEmBrasilia();
            const caminho = caminhoLegislaturaNaData(hoje);
            const { value, fetchedAt } = await cachedFetchWithMeta(
              "senado_legislatura_vigente", { data: hoje }, CACHE_STATIC,
              () => upstreamFetch(caminho, {}, baseUrl),
            );
            const prov = provenanceFor("SENADO_LEGIS", baseUrl, caminho, {
              dataset_id: "tabela=legislatura-atual", retrieved_at: fetchedAt,
            });
            return resultWithProvenance(
              { tabela: params.tabela, ...parseLegislaturaVigente(value) },
              provenanceDaLegislatura(prov),
            );
          }

          case "tipos-norma": {
            const { value: response, fetchedAt } = await cachedFetchWithMeta(
              "senado_tipos_norma", {}, CACHE_STATIC,
              () => upstreamFetch("/legislacao/tiposNorma", {}, baseUrl),
            );
            const tipos = digArrayRoot(
              response,
              [["ListaTiposDocumento", "TiposDocumento", "TipoDocumento"]],
              "senado_tabelas_referencia:tipos-norma",
            ).map((t: any) => ({
              sigla: t.Sigla || t.sigla || null,
              descricao: t.Descricao || t.descricao || null,
            }));
            const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/legislacao/tiposNorma", {
              dataset_id: "tabela=tipos-norma", retrieved_at: fetchedAt,
            });
            return resultWithProvenance({ tabela: params.tabela, count: tipos.length, tipos }, prov);
          }

          case "tipos-uso-palavra": {
            const { value: response, fetchedAt } = await cachedFetchWithMeta(
              "senado_tipos_uso_palavra", {}, CACHE_STATIC,
              () => upstreamFetch("/senador/lista/tiposUsoPalavra", {}, baseUrl),
            );
            const r = response as any;
            const tipos = ensureArray(
              r?.ListaTiposUsoPalavra?.TiposUsoPalavra?.TipoUsoPalavra ??
              r?.TiposUsoPalavra?.TipoUsoPalavra,
            ).map((t: any) => ({
              codigo: t.Codigo || t.codigo || null,
              descricao: t.Descricao || t.descricao || null,
            }));
            const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/senador/lista/tiposUsoPalavra", {
              dataset_id: "tabela=tipos-uso-palavra", retrieved_at: fetchedAt,
            });
            return resultWithProvenance({ tabela: params.tabela, count: tipos.length, tipos }, prov);
          }
        }
      } catch (e) {
        return errorFrom(e, "Erro ao obter tabela de referência");
      }
    },
  );
}
