/**
 * Group D — Votes (5 tools)
 * senado_listar_votacoes, senado_votacoes_recentes, senado_obter_votacao,
 * senado_votos_materia, senado_search_votacoes
 *
 * D1/D2/D3/D5 use the /votacao endpoint (new API, camelCase, ISO dates).
 * D4 uses the old /materia/votacoes/{codigo} endpoint (PascalCase).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, toolError, errorFrom, buildParams, ensureArray } from "../utils/validation.js";
import { CACHE_DYNAMIC, CACHE_ON_DEMAND } from "../types.js";

/** Convert YYYYMMDD → YYYY-MM-DD (required by /votacao endpoint). */
export function toISODate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** Format Date as YYYY-MM-DD. */
export function formatISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Last day of a month. */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Parse a single vote item from the /votacao endpoint (flat camelCase). */
export function parseVotacaoItem(v: any, includeVotos = false) {
  const result: any = {
    codigoSessao: v.codigoSessao || null,
    codigoVotacao: v.codigoSessaoVotacao || null,
    data: v.dataSessao ? v.dataSessao.split("T")[0] : "",
    materia: v.identificacao || (v.sigla ? `${v.sigla} ${v.numero}/${v.ano}` : null),
    codigoMateria: v.codigoMateria || null,
    ementa: v.ementa || null,
    descricao: v.descricaoVotacao || null,
    resultado: v.resultadoVotacao || null,
    totalSim: v.totalVotosSim ?? null,
    totalNao: v.totalVotosNao ?? null,
    totalAbstencao: v.totalVotosAbstencao ?? null,
    secreta: v.votacaoSecreta === "S",
  };
  if (includeVotos && Array.isArray(v.votos) && v.votos.length > 0) {
    result.votos = v.votos.map((vt: any) => ({
      codigoSenador: vt.codigoParlamentar || 0,
      nomeSenador: vt.nomeParlamentar || "",
      partido: vt.siglaPartidoParlamentar || null,
      uf: vt.siglaUFParlamentar || null,
      voto: vt.descricaoVotoParlamentar || vt.siglaVotoParlamentar || "",
    }));
  }
  return result;
}

export function registerVotacoesTools(server: McpServer, baseUrl: string) {
  // D1. senado_listar_votacoes
  server.tool(
    "senado_listar_votacoes",
    "Lista votações do plenário do Senado por ano, com filtro opcional por `mes` ou período (`dataInicio`/`dataFim`, YYYYMMDD). Retorna `{ ano, count, votacoes }`, onde cada item traz `codigoSessao`, `codigoVotacao`, `data`, `materia`, `codigoMateria`, `resultado`, `totalSim`/`totalNao`/`totalAbstencao` e `secreta` (sem votos nominais). Use `senado_obter_votacao` com o `codigoSessao` para os votos de cada senador, ou `senado_search_votacoes` para critérios combinados.",
    {
      ano: z.number().int().min(1900).max(2100).describe("Ano das votações (obrigatório)"),
      mes: z.number().int().min(1).max(12).optional().describe("Mês (1-12)"),
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim (YYYYMMDD)"),
    },
    async (params) => {
      try {
        let di: string;
        let df: string;
        if (params.dataInicio && params.dataFim) {
          di = toISODate(params.dataInicio);
          df = toISODate(params.dataFim);
        } else if (params.mes) {
          di = `${params.ano}-${String(params.mes).padStart(2, "0")}-01`;
          df = `${params.ano}-${String(params.mes).padStart(2, "0")}-${lastDayOfMonth(params.ano, params.mes)}`;
        } else {
          di = `${params.ano}-01-01`;
          df = `${params.ano}-12-31`;
        }
        const qp = { dataInicio: di, dataFim: df };
        const response = await cachedFetch(
          "senado_listar_votacoes",
          { ano: params.ano, ...qp },
          CACHE_DYNAMIC,
          () => upstreamFetch("/votacao", qp, baseUrl),
        );
        const votacoes = ensureArray(response).map((v: any) => parseVotacaoItem(v));
        return toolResult({ ano: params.ano, count: votacoes.length, votacoes });
      } catch (e) {
        return errorFrom(e, "Erro ao listar votações");
      }
    },
  );

  // D2. senado_votacoes_recentes
  server.tool(
    "senado_votacoes_recentes",
    "Obtém as votações mais recentes do plenário nos últimos `dias` (padrão 7, máx 365). Retorna `{ periodo, count, votacoes }` ordenadas da mais recente para a mais antiga; cada item traz `codigoSessao`, `data`, `materia`, `resultado` e placar (`totalSim`/`totalNao`/`totalAbstencao`), sem votos nominais. Para acompanhar atividade recente; use `senado_obter_votacao` para detalhar uma votação ou `senado_listar_votacoes` para um ano/mês específico.",
    {
      dias: z.number().int().min(1).max(365).optional().default(7).describe("Quantidade de dias (padrão: 7)"),
    },
    async (params) => {
      try {
        const hoje = new Date();
        const inicio = new Date(hoje);
        inicio.setDate(inicio.getDate() - (params.dias ?? 7));
        const qp = { dataInicio: formatISO(inicio), dataFim: formatISO(hoje) };
        const response = await cachedFetch(
          "senado_votacoes_recentes",
          { dias: params.dias, ...qp },
          CACHE_DYNAMIC,
          () => upstreamFetch("/votacao", qp, baseUrl),
        );
        const votacoes = ensureArray(response)
          .map((v: any) => parseVotacaoItem(v))
          .sort((a, b) => b.data.localeCompare(a.data));
        return toolResult({ periodo: { dias: params.dias ?? 7, ...qp }, count: votacoes.length, votacoes });
      } catch (e) {
        return errorFrom(e, "Erro ao obter votações recentes");
      }
    },
  );

  // D3. senado_obter_votacao
  server.tool(
    "senado_obter_votacao",
    "Obtém detalhes de uma votação pelo `codigoVotacao` (que é o `codigoSessao` da sessão plenária), incluindo votos nominais. Retorna o objeto da votação (placar, `resultado`, `secreta`) com `votos[]` (`codigoSenador`, `nomeSenador`, `partido`, `uf`, `voto`); se a sessão tiver várias votações, retorna `{ codigoSessao, count, votacoes }`. Obtenha o `codigoSessao` via `senado_listar_votacoes`, `senado_votacoes_recentes` ou `senado_search_votacoes` antes de chamar.",
    {
      codigoVotacao: z.number().int().positive().describe("Código único da votação (codigoSessao da sessão plenária)"),
    },
    async (params) => {
      try {
        const qp = { codigoSessao: String(params.codigoVotacao) };
        const response = await cachedFetch(
          "senado_obter_votacao",
          { codigo: params.codigoVotacao },
          CACHE_ON_DEMAND,
          () => upstreamFetch("/votacao", qp, baseUrl),
        );
        const votacoes = ensureArray(response).map((v: any) => parseVotacaoItem(v, true));
        if (votacoes.length === 1) return toolResult(votacoes[0]);
        return toolResult({ codigoSessao: params.codigoVotacao, count: votacoes.length, votacoes });
      } catch (e) {
        return errorFrom(e, "Votação não encontrada");
      }
    },
  );

  // D4. senado_votos_materia (migrated to v3 /votacao?codigoMateria — legacy endpoint deprecated)
  server.tool(
    "senado_votos_materia",
    "Obtém as votações de uma matéria pelo `codigoMateria`. Retorna `{ codigoMateria, count, votacoes }`, cada item com `data`, `descricao`, `resultado` e placar (`totalSim`/`totalNao`/`totalAbstencao`); com `incluirVotos: true` (padrão false) acrescenta `votos[]` (nome, partido, uf e voto de cada senador). Obtenha o `codigoMateria` via `senado_buscar_materias` ou `senado_obter_materia`.",
    {
      codigoMateria: z.number().int().positive().describe("Código único da matéria"),
      incluirVotos: z.boolean().optional().default(false).describe("Incluir votos nominais de cada senador"),
    },
    async (params) => {
      try {
        const response = await cachedFetch(
          "senado_votos_materia",
          { codigo: params.codigoMateria },
          CACHE_ON_DEMAND,
          () => upstreamFetch("/votacao", { codigoMateria: String(params.codigoMateria) }, baseUrl),
        );
        const votacoes = ensureArray(response).map((v: any) =>
          parseVotacaoItem(v, params.incluirVotos ?? false),
        );
        return toolResult({ codigoMateria: params.codigoMateria, count: votacoes.length, votacoes });
      } catch (e) {
        return errorFrom(e, "Erro ao obter votações da matéria");
      }
    },
  );

  // D5. senado_search_votacoes (GET /votacao — flexible search)
  server.tool(
    "senado_search_votacoes",
    "Busca votações combinando critérios opcionais: período (`dataInicio`/`dataFim`, YYYYMMDD), `idProcesso`, `codigoMateria`, `sigla`/`numero`/`ano` da matéria, `codigoParlamentar` e `siglaVotoParlamentar`. Retorna `{ count, votacoes }` com `data`, `materia`, `resultado` e placar (sem votos nominais). Mais flexível que `senado_listar_votacoes`; use `senado_obter_votacao` para os votos nominais de uma votação encontrada.",
    {
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim (YYYYMMDD)"),
      idProcesso: z.number().int().optional().describe("ID do processo legislativo"),
      codigoMateria: z.number().int().optional().describe("Código da matéria"),
      sigla: z.string().optional().describe("Sigla do tipo de matéria"),
      numero: z.number().int().optional().describe("Número da matéria"),
      ano: z.number().int().optional().describe("Ano da matéria"),
      codigoParlamentar: z.number().int().optional().describe("Código do parlamentar"),
      siglaVotoParlamentar: z.string().optional().describe("Tipo de voto do parlamentar"),
    },
    async (params) => {
      try {
        const qp = buildParams({
          dataInicio: params.dataInicio ? toISODate(params.dataInicio) : undefined,
          dataFim: params.dataFim ? toISODate(params.dataFim) : undefined,
          idProcesso: params.idProcesso,
          codigoMateria: params.codigoMateria,
          sigla: params.sigla,
          numero: params.numero,
          ano: params.ano,
          codigoParlamentar: params.codigoParlamentar,
          siglaVotoParlamentar: params.siglaVotoParlamentar,
        });
        const response = await cachedFetch("senado_search_votacoes", qp, CACHE_ON_DEMAND, () =>
          upstreamFetch("/votacao", qp, baseUrl),
        );
        const votacoes = ensureArray(response).map((v: any) => parseVotacaoItem(v));
        return toolResult({ count: votacoes.length, votacoes });
      } catch (e) {
        return errorFrom(e, "Erro na busca de votações");
      }
    },
  );
}
