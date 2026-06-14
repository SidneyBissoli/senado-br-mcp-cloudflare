/**
 * Group M — VotacaoComissao / Committee Voting (1 tool)
 * senado_votacao_comissao (enum `por`: comissao | senador | materia)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, toolError, errorFrom, buildParams, ensureArray } from "../utils/validation.js";
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
  // M1. senado_votacao_comissao (por: comissao | senador | materia)
  server.tool(
    "senado_votacao_comissao",
    "Lista votações em comissões. O parâmetro `por` (padrão `comissao`) define o eixo da consulta: " +
      "`por: comissao` → exige `siglaComissao`; lista as votações daquela comissão. " +
      "`por: senador` → exige `codigoSenador`; lista os votos do senador em comissões (filtro opcional `comissao`). " +
      "`por: materia` → exige `sigla`, `numero` e `ano` (ex.: PL 2630/2020); lista as votações da proposição em comissões (filtro opcional `comissao`). " +
      "Em todos os casos aceita período opcional `dataInicio`/`dataFim` (YYYYMMDD) e retorna `{ por, ...contexto, count, votacoes }`, cada votação com `codigo`, `data`, `comissao`, `materia`, `descricao`, `resultado`, totais (`totalSim`/`totalNao`/`totalAbstencao`) e `votos` (senador, partido, voto). Sem paginação. " +
      "Obtenha siglas via `senado_listar_comissoes`, `codigoSenador` via `senado_listar_senadores`; para votações no plenário use `senado_votos_materia`.",
    {
      por: z.enum(["comissao", "senador", "materia"]).optional().default("comissao").describe("Eixo da consulta: comissao, senador ou materia"),
      siglaComissao: z.string().min(2).optional().describe("Sigla da comissão (obrigatório quando por=comissao; ex: CCJ, CAE)"),
      codigoSenador: z.number().int().positive().optional().describe("Código do senador (obrigatório quando por=senador)"),
      sigla: z.string().min(2).optional().describe("Sigla do tipo da proposição (obrigatório quando por=materia; ex: PL, PEC)"),
      numero: z.number().int().positive().optional().describe("Número da proposição (obrigatório quando por=materia)"),
      ano: z.number().int().min(1900).max(2100).optional().describe("Ano da proposição (obrigatório quando por=materia)"),
      comissao: z.string().optional().describe("Sigla da comissão para filtrar (por=senador ou por=materia)"),
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim (YYYYMMDD)"),
    },
    async (params) => {
      try {
        const por = params.por ?? "comissao";

        if (por === "senador") {
          if (!params.codigoSenador) return toolError("Para por=senador, informe 'codigoSenador'.");
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
          return toolResult({ por, codigoSenador: params.codigoSenador, count: votacoes.length, votacoes });
        }

        if (por === "materia") {
          if (!params.sigla || !params.numero || !params.ano) {
            return toolError("Para por=materia, informe 'sigla', 'numero' e 'ano'.");
          }
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
          return toolResult({ por, materia: `${sigla} ${params.numero}/${params.ano}`, count: votacoes.length, votacoes });
        }

        // por === "comissao" (padrão)
        if (!params.siglaComissao) return toolError("Para por=comissao, informe 'siglaComissao'.");
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
        return toolResult({ por, siglaComissao: sigla, count: votacoes.length, votacoes });
      } catch (e) {
        return errorFrom(e, "Erro ao obter votações em comissões");
      }
    },
  );
}
