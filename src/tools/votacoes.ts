/**
 * Group D — Votes (3 tools)
 * senado_obter_votacao, senado_votos_materia, senado_search_votacoes
 *
 * Todos usam o endpoint /votacao (API nova, camelCase, datas ISO), exceto votos_materia
 * que faz a ponte por codigoMateria. search_votacoes absorve o que eram listar_votacoes
 * (janela por ano/mês via dataInicio/dataFim) e votacoes_recentes (parâmetro `dias`).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { errorFrom, buildParams, ensureArray } from "../utils/validation.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
import { CACHE_ON_DEMAND } from "../types.js";

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
  // D3. senado_obter_votacao
  server.tool(
    "senado_obter_votacao",
    "Obtém detalhes de uma votação pelo `codigoVotacao` (que é o `codigoSessao` da sessão plenária), incluindo votos nominais. Retorna o objeto da votação (placar, `resultado`, `secreta`) com `votos[]` (`codigoSenador`, `nomeSenador`, `partido`, `uf`, `voto`); se a sessão tiver várias votações, retorna `{ codigoSessao, count, votacoes }`. Obtenha o `codigoSessao` via `senado_search_votacoes` antes de chamar.",
    {
      codigoVotacao: z.number().int().positive().describe("Código único da votação (codigoSessao da sessão plenária)"),
    },
    async (params) => {
      try {
        const qp = { codigoSessao: String(params.codigoVotacao) };
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_obter_votacao",
          { codigo: params.codigoVotacao },
          CACHE_ON_DEMAND,
          () => upstreamFetch("/votacao", qp, baseUrl),
        );
        const votacoes = ensureArray(response).map((v: any) => parseVotacaoItem(v, true));
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/votacao", {
          dataset_id: `codigoSessao=${params.codigoVotacao}`,
          reference_period: votacoes[0]?.data || undefined,
          retrieved_at: fetchedAt,
        });
        if (votacoes.length === 1) return resultWithProvenance(votacoes[0], prov);
        return resultWithProvenance(
          { codigoSessao: params.codigoVotacao, count: votacoes.length, votacoes },
          prov,
        );
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
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_votos_materia",
          { codigo: params.codigoMateria },
          CACHE_ON_DEMAND,
          () => upstreamFetch("/votacao", { codigoMateria: String(params.codigoMateria) }, baseUrl),
        );
        const votacoes = ensureArray(response).map((v: any) =>
          parseVotacaoItem(v, params.incluirVotos ?? false),
        );
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/votacao", {
          dataset_id: `codigoMateria=${params.codigoMateria}`,
          reference_period: votacoes[0]?.data || undefined,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance(
          { codigoMateria: params.codigoMateria, count: votacoes.length, votacoes },
          prov,
        );
      } catch (e) {
        return errorFrom(e, "Erro ao obter votações da matéria");
      }
    },
  );

  // D5. senado_search_votacoes (GET /votacao — busca/listagem flexível do plenário)
  server.tool(
    "senado_search_votacoes",
    "Busca e lista votações do plenário combinando critérios opcionais. Janela temporal: informe `dias` (últimos N dias, 1-365) para atividade recente, OU `dataInicio`/`dataFim` (YYYYMMDD) para um período arbitrário — para um ano inteiro use `dataInicio: \"AAAA0101\"` e `dataFim: \"AAAA1231\"`. Demais filtros: `idProcesso`, `codigoMateria`, `sigla`/`numero`/`ano` da matéria, `codigoParlamentar` e `siglaVotoParlamentar`. Retorna `{ count, votacoes }` ordenadas da mais recente para a mais antiga; cada item traz `codigoSessao`, `data`, `materia`, `codigoMateria`, `resultado` e placar (`totalSim`/`totalNao`/`totalAbstencao`), sem votos nominais. Use `senado_obter_votacao` com o `codigoSessao` para os votos de cada senador.",
    {
      dias: z.number().int().min(1).max(365).optional().describe("Janela: votações dos últimos N dias (ignorado se dataInicio/dataFim forem informados)"),
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
        let di = params.dataInicio ? toISODate(params.dataInicio) : undefined;
        let df = params.dataFim ? toISODate(params.dataFim) : undefined;
        if (params.dias && !di && !df) {
          const hoje = new Date();
          const inicio = new Date(hoje);
          inicio.setDate(inicio.getDate() - params.dias);
          di = formatISO(inicio);
          df = formatISO(hoje);
        }
        const qp = buildParams({
          dataInicio: di,
          dataFim: df,
          idProcesso: params.idProcesso,
          codigoMateria: params.codigoMateria,
          sigla: params.sigla,
          numero: params.numero,
          ano: params.ano,
          codigoParlamentar: params.codigoParlamentar,
          siglaVotoParlamentar: params.siglaVotoParlamentar,
        });
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_search_votacoes",
          qp,
          CACHE_ON_DEMAND,
          () => upstreamFetch("/votacao", qp, baseUrl),
        );
        const votacoes = ensureArray(response)
          .map((v: any) => parseVotacaoItem(v))
          .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/votacao", {
          reference_period: di && df ? `${di}/${df}` : di || df || undefined,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({ count: votacoes.length, votacoes }, prov);
      } catch (e) {
        return errorFrom(e, "Erro na busca de votações");
      }
    },
  );
}
