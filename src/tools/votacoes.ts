/**
 * Group D — Votes (5 tools)
 * senado_listar_votacoes, senado_votacoes_recentes, senado_obter_votacao,
 * senado_votos_materia, senado_search_votacoes
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, toolError, buildParams, ensureArray } from "../utils/validation.js";
import { CACHE_DYNAMIC, CACHE_ON_DEMAND } from "../types.js";

function formatDateYMD(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function parseVotacaoResumo(v: any) {
  const sessao = v.SessaoPlenaria || v;
  const mat = v.IdentificacaoMateria || {};
  return {
    codigo: parseInt(v.CodigoSessaoVotacao || v.CodigoVotacao || sessao.CodigoSessao || "0"),
    data: sessao.DataSessao || v.DataSessao || v.Data || "",
    hora: sessao.HoraInicioSessao || v.Hora || null,
    materia:
      mat.DescricaoIdentificacaoMateria ||
      `${mat.SiglaSubtipoMateria || ""} ${mat.NumeroMateria || ""}/${mat.AnoMateria || ""}`.trim() || null,
    descricao: v.DescricaoVotacao || sessao.DescricaoTipoSessao || null,
    resultado: v.DescricaoResultado || v.Resultado || null,
    totalSim: v.TotalVotosSim ? parseInt(v.TotalVotosSim) : null,
    totalNao: v.TotalVotosNao ? parseInt(v.TotalVotosNao) : null,
    totalAbstencao: v.TotalVotosAbstencao ? parseInt(v.TotalVotosAbstencao) : null,
  };
}

function parseVotoNominal(voto: any) {
  const id = voto.IdentificacaoParlamentar || voto;
  return {
    codigoSenador: parseInt(id.CodigoParlamentar || voto.CodigoParlamentar || "0"),
    nomeSenador: id.NomeParlamentar || voto.NomeParlamentar || "",
    partido: id.SiglaPartidoParlamentar || voto.SiglaPartido || null,
    uf: id.UfParlamentar || voto.SiglaUf || null,
    voto: voto.SiglaDescricaoVoto || voto.DescricaoVoto || voto.Voto || "",
  };
}

function parseVotacaoDetalhe(dados: any) {
  const v = dados.Votacao || dados;
  const sessao = v.SessaoPlenaria || v;
  const mat = v.IdentificacaoMateria || v.Materia || {};
  const votos = ensureArray(v.Votos?.VotoParlamentar).map(parseVotoNominal);
  return {
    codigo: parseInt(v.CodigoSessaoVotacao || v.CodigoVotacao || sessao.CodigoSessao || "0"),
    data: sessao.DataSessao || v.DataSessao || v.Data || "",
    hora: sessao.HoraInicioSessao || v.Hora || null,
    materia: mat.CodigoMateria
      ? {
          codigo: parseInt(mat.CodigoMateria) || null,
          sigla: mat.SiglaSubtipoMateria || mat.SiglaMateria || null,
          numero: mat.NumeroMateria ? parseInt(mat.NumeroMateria) : null,
          ano: mat.AnoMateria ? parseInt(mat.AnoMateria) : null,
          ementa: mat.EmentaMateria || mat.Ementa || null,
        }
      : null,
    descricao: v.DescricaoVotacao || sessao.DescricaoTipoSessao || null,
    resultado: v.DescricaoResultado || v.Resultado || null,
    totalSim: v.TotalVotosSim ? parseInt(v.TotalVotosSim) : null,
    totalNao: v.TotalVotosNao ? parseInt(v.TotalVotosNao) : null,
    totalAbstencao: v.TotalVotosAbstencao ? parseInt(v.TotalVotosAbstencao) : null,
    totalPresente: v.TotalVotosPresente ? parseInt(v.TotalVotosPresente) : null,
    votos: votos.length > 0 ? votos : undefined,
  };
}

export function registerVotacoesTools(server: McpServer, baseUrl: string) {
  // D1. senado_listar_votacoes
  server.tool(
    "senado_listar_votacoes",
    "Lista votações do plenário do Senado por ano, podendo filtrar por mês ou período específico.",
    {
      ano: z.number().int().min(1900).max(2100).describe("Ano das votações (obrigatório)"),
      mes: z.number().int().min(1).max(12).optional().describe("Mês (1-12)"),
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim (YYYYMMDD)"),
    },
    async (params) => {
      try {
        const qp = buildParams({ mes: params.mes, dataInicio: params.dataInicio, dataFim: params.dataFim });
        const response = await cachedFetch(
          "senado_listar_votacoes",
          { ano: params.ano, ...qp },
          CACHE_DYNAMIC,
          () => upstreamFetch(`/plenario/lista/votacao/${params.ano}`, qp, baseUrl),
        );
        const r = response as any;
        const votacoes = ensureArray(
          r?.ListaVotacoes?.Votacoes?.Votacao ?? r?.VotacoesPlenario?.Votacoes?.Votacao,
        ).map(parseVotacaoResumo);
        return toolResult({ ano: params.ano, count: votacoes.length, votacoes });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Erro ao listar votações");
      }
    },
  );

  // D2. senado_votacoes_recentes
  server.tool(
    "senado_votacoes_recentes",
    "Obtém as votações mais recentes do plenário (últimos N dias). Útil para acompanhar atividade legislativa recente.",
    {
      dias: z.number().int().min(1).max(365).optional().default(7).describe("Quantidade de dias (padrão: 7)"),
    },
    async (params) => {
      try {
        const hoje = new Date();
        const inicio = new Date(hoje);
        inicio.setDate(inicio.getDate() - (params.dias ?? 7));
        const qp = { dataInicio: formatDateYMD(inicio), dataFim: formatDateYMD(hoje) };
        const response = await cachedFetch(
          "senado_votacoes_recentes",
          { dias: params.dias, ...qp },
          CACHE_DYNAMIC,
          () => upstreamFetch(`/plenario/lista/votacao/${hoje.getFullYear()}`, qp, baseUrl),
        );
        const r = response as any;
        const votacoes = ensureArray(
          r?.ListaVotacoes?.Votacoes?.Votacao ?? r?.VotacoesPlenario?.Votacoes?.Votacao,
        )
          .map(parseVotacaoResumo)
          .sort((a, b) => b.data.localeCompare(a.data));
        return toolResult({ periodo: { dias: params.dias ?? 7, ...qp }, count: votacoes.length, votacoes });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Erro ao obter votações recentes");
      }
    },
  );

  // D3. senado_obter_votacao
  server.tool(
    "senado_obter_votacao",
    "Obtém detalhes de uma votação específica, incluindo votos nominais de cada senador.",
    {
      codigoVotacao: z.number().int().positive().describe("Código único da votação"),
    },
    async (params) => {
      try {
        const response = await cachedFetch(
          "senado_obter_votacao",
          { codigo: params.codigoVotacao },
          CACHE_ON_DEMAND,
          () => upstreamFetch(`/plenario/votacao/${params.codigoVotacao}`, {}, baseUrl),
        );
        const dados = (response as any).VotacaoPlenario || response;
        return toolResult(parseVotacaoDetalhe(dados));
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Votação não encontrada");
      }
    },
  );

  // D4. senado_votos_materia
  server.tool(
    "senado_votos_materia",
    "Obtém resultado de votações de uma matéria, incluindo placar e votos nominais quando disponíveis.",
    {
      codigoMateria: z.number().int().positive().describe("Código único da matéria"),
    },
    async (params) => {
      try {
        const response = await cachedFetch(
          "senado_votos_materia",
          { codigo: params.codigoMateria },
          CACHE_ON_DEMAND,
          () => upstreamFetch(`/materia/${params.codigoMateria}/votacoes`, {}, baseUrl),
        );
        const r = response as any;
        const votacoes = ensureArray(
          r?.VotacaoMateria?.Materia?.Votacoes?.Votacao ?? r?.Votacoes?.Votacao,
        ).map((v: any) => ({
          codigoVotacao: parseInt(v.CodigoSessaoVotacao || v.CodigoVotacao || "0"),
          data: v.DataSessao || v.Data || "",
          descricao: v.DescricaoVotacao || v.Descricao || null,
          resultado: v.DescricaoResultado || v.Resultado || null,
          totalSim: v.TotalVotosSim ? parseInt(v.TotalVotosSim) : null,
          totalNao: v.TotalVotosNao ? parseInt(v.TotalVotosNao) : null,
          totalAbstencao: v.TotalVotosAbstencao ? parseInt(v.TotalVotosAbstencao) : null,
        }));
        return toolResult({ codigoMateria: params.codigoMateria, count: votacoes.length, votacoes });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Erro ao obter votações da matéria");
      }
    },
  );

  // D5. senado_search_votacoes (NEW — confirmed in OpenAPI as GET /votacao)
  server.tool(
    "senado_search_votacoes",
    "Busca votações por múltiplos critérios combinados: período, processo, matéria, parlamentar e tipo de voto. Mais flexível que senado_listar_votacoes.",
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
          dataInicio: params.dataInicio,
          dataFim: params.dataFim,
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
        const r = response as any;
        // Response structure from /votacao endpoint
        const votacoes = ensureArray(r?.votacoes ?? r?.Votacoes?.Votacao ?? r).map((v: any) => ({
          codigoVotacao: parseInt(v.codigoVotacao || v.CodigoVotacao || "0"),
          data: v.dataSessao || v.DataSessao || v.data || "",
          descricao: v.descricaoVotacao || v.DescricaoVotacao || null,
          resultado: v.descricaoResultado || v.DescricaoResultado || null,
          materia: v.siglaMateria || v.SiglaMateria
            ? `${v.siglaMateria || v.SiglaMateria || ""} ${v.numeroMateria || v.NumeroMateria || ""}/${v.anoMateria || v.AnoMateria || ""}`
            : null,
          totalSim: v.totalVotosSim != null ? parseInt(v.totalVotosSim) : null,
          totalNao: v.totalVotosNao != null ? parseInt(v.totalVotosNao) : null,
        }));
        return toolResult({ count: votacoes.length, votacoes });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Erro na busca de votações");
      }
    },
  );
}
