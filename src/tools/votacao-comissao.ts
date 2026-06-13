/**
 * Group M — VotacaoComissao / Committee Voting (3 tools)
 * senado_votacao_comissao, senado_votacao_comissao_senador,
 * senado_votacao_comissao_materia
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, errorFrom, buildParams, ensureArray } from "../utils/validation.js";
import { CACHE_DYNAMIC } from "../types.js";

/** Parse a committee vote item. */
export function parseVotacaoComissao(v: any) {
  const votacao = v.Votacao || v;
  return {
    codigo: votacao.CodigoVotacao || votacao.codigoVotacao || votacao.Codigo || null,
    data: votacao.DataVotacao || votacao.dataVotacao || votacao.Data || null,
    comissao: votacao.SiglaComissao || votacao.siglaComissao || votacao.Comissao || null,
    materia: votacao.IdentificacaoMateria || votacao.identificacaoMateria ||
      votacao.DescricaoMateria || votacao.descricaoMateria || null,
    descricao: votacao.DescricaoVotacao || votacao.descricaoVotacao || null,
    resultado: votacao.Resultado || votacao.resultado || null,
    totalSim: votacao.TotalVotosSim ?? votacao.totalVotosSim ?? null,
    totalNao: votacao.TotalVotosNao ?? votacao.totalVotosNao ?? null,
    totalAbstencao: votacao.TotalVotosAbstencao ?? votacao.totalVotosAbstencao ?? null,
    votos: ensureArray(votacao.Votos?.Voto ?? votacao.votos).map((vt: any) => ({
      codigoSenador: vt.CodigoParlamentar || vt.codigoParlamentar || null,
      nome: vt.NomeParlamentar || vt.nomeParlamentar || null,
      partido: vt.SiglaPartido || vt.siglaPartido || null,
      voto: vt.DescricaoVoto || vt.descricaoVoto || vt.Voto || null,
    })),
  };
}

export function registerVotacaoComissaoTools(server: McpServer, baseUrl: string) {
  // M1. senado_votacao_comissao
  server.tool(
    "senado_votacao_comissao",
    "Lista votações realizadas numa comissão específica, com filtro por período.",
    {
      siglaComissao: z.string().min(2).describe("Sigla da comissão (ex: CCJ, CAE)"),
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim (YYYYMMDD)"),
    },
    async (params) => {
      try {
        const qp = buildParams({
          dataInicio: params.dataInicio,
          dataFim: params.dataFim,
        });
        const sigla = params.siglaComissao.toUpperCase();
        const response = await cachedFetch(
          "senado_votacao_comissao",
          { sigla, ...qp },
          CACHE_DYNAMIC,
          () => upstreamFetch(`/votacaoComissao/comissao/${sigla}`, qp, baseUrl),
        );
        const r = response as any;
        const votacoes = ensureArray(
          r?.VotacaoComissao?.Votacoes?.Votacao ??
          r?.Votacoes?.Votacao,
        ).map(parseVotacaoComissao);
        return toolResult({ siglaComissao: sigla, count: votacoes.length, votacoes });
      } catch (e) {
        return errorFrom(e, "Erro ao obter votações da comissão");
      }
    },
  );

  // M2. senado_votacao_comissao_senador
  server.tool(
    "senado_votacao_comissao_senador",
    "Lista os votos de um senador em comissões, com filtro por comissão e período.",
    {
      codigoSenador: z.number().int().positive().describe("Código único do senador"),
      comissao: z.string().optional().describe("Sigla da comissão para filtrar"),
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim (YYYYMMDD)"),
    },
    async (params) => {
      try {
        const qp = buildParams({
          comissao: params.comissao?.toUpperCase(),
          dataInicio: params.dataInicio,
          dataFim: params.dataFim,
        });
        const response = await cachedFetch(
          "senado_votacao_comissao_senador",
          { codigo: params.codigoSenador, ...qp },
          CACHE_DYNAMIC,
          () => upstreamFetch(`/votacaoComissao/parlamentar/${params.codigoSenador}`, qp, baseUrl),
        );
        const r = response as any;
        const votacoes = ensureArray(
          r?.VotacaoComissaoParlamentar?.Votacoes?.Votacao ??
          r?.Votacoes?.Votacao,
        ).map(parseVotacaoComissao);
        return toolResult({ codigoSenador: params.codigoSenador, count: votacoes.length, votacoes });
      } catch (e) {
        return errorFrom(e, "Erro ao obter votos do senador em comissões");
      }
    },
  );

  // M3. senado_votacao_comissao_materia
  server.tool(
    "senado_votacao_comissao_materia",
    "Lista votações de uma matéria específica nas comissões, identificada por sigla, número e ano (ex: PL 2630/2020).",
    {
      sigla: z.string().min(2).describe("Sigla do tipo da proposição (ex: PL, PEC)"),
      numero: z.number().int().positive().describe("Número da proposição"),
      ano: z.number().int().min(1900).max(2100).describe("Ano da proposição"),
      comissao: z.string().optional().describe("Sigla da comissão para filtrar"),
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim (YYYYMMDD)"),
    },
    async (params) => {
      try {
        const sigla = params.sigla.toUpperCase();
        const qp = buildParams({
          comissao: params.comissao?.toUpperCase(),
          dataInicio: params.dataInicio,
          dataFim: params.dataFim,
        });
        const response = await cachedFetch(
          "senado_votacao_comissao_materia",
          { sigla, numero: params.numero, ano: params.ano, ...qp },
          CACHE_DYNAMIC,
          () => upstreamFetch(`/votacaoComissao/materia/${sigla}/${params.numero}/${params.ano}`, qp, baseUrl),
        );
        const r = response as any;
        const votacoes = ensureArray(
          r?.VotacoesComissao?.Votacoes?.Votacao ??
          r?.VotacaoComissaoMateria?.Votacoes?.Votacao ??
          r?.Votacoes?.Votacao,
        ).map(parseVotacaoComissao);
        return toolResult({
          materia: `${sigla} ${params.numero}/${params.ano}`,
          count: votacoes.length,
          votacoes,
        });
      } catch (e) {
        return errorFrom(e, "Erro ao obter votações da matéria em comissões");
      }
    },
  );
}
