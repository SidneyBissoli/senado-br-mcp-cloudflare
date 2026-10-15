/**
 * Group M — VotacaoComissao / Committee Voting (1 tool)
 * senado_votacao_comissao (enum `por`: comissao | senador | materia)
 */

import type { SenadoToolHost } from "../tool-host.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolError, errorFrom, buildParams, ensureArray, normalizeText } from "../utils/validation.js";
import { digArrayRoot } from "../utils/upstream-parse.js";
import { NOTA_DERIVACAO_PLACAR_COMISSAO, derivadoSe, provenanceFor, resultWithProvenance, type Provenance } from "../utils/provenance.js";
import { CACHE_DYNAMIC } from "../types.js";

const VOTACAO_COMISSAO_ROOT = [["VotacoesComissao", "Votacoes", "Votacao"]];

/** Parse a committee vote item (VotacoesComissao.Votacoes.Votacao[]). */
export function parseVotacaoComissao(v: any) {
  const votacao = v.Votacao || v;
  const votosRaw = ensureArray(votacao.Votos?.Voto ?? votacao.votos);
  let totalSim = 0, totalNao = 0, totalAbstencao = 0; // recontagem, usada só se a fonte não publicar
  const votos = votosRaw.map((vt: any) => {
    const q = normalizeText(vt.QualidadeVoto || vt.DescricaoVoto || vt.voto);
    if (q === "s" || q === "sim") totalSim++;
    else if (q === "n" || q === "nao") totalNao++;
    else if (q === "a" || q === "abstencao") totalAbstencao++;
    return {
      codigoSenador: vt.CodigoParlamentar || vt.codigoParlamentar || null,
      nome: vt.NomeParlamentar || vt.nomeParlamentar || null,
      partido: vt.SiglaPartidoParlamentar || vt.SiglaPartido || vt.siglaPartido || null,
      voto: vt.QualidadeVoto || vt.DescricaoVoto || vt.descricaoVoto || vt.Voto || null,
    };
  });
  return {
    codigo: votacao.CodigoVotacao || votacao.codigoVotacao || null,
    data: votacao.DataHoraInicioReuniao || votacao.DataVotacao || votacao.Data || null,
    comissao: votacao.SiglaColegiado || votacao.SiglaComissao || votacao.siglaComissao || null,
    reuniao: votacao.CodigoReuniao || null,
    materia: votacao.IdentificacaoMateria || votacao.DescricaoIdentificacaoMateria || null,
    descricao: votacao.DescricaoVotacao || votacao.descricaoVotacao || null,
    ...placarDaComissao(votacao, { sim: totalSim, nao: totalNao, abstencao: totalAbstencao }),
    votos,
  };
}

const totalPublicado = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Committee tally: the source's `TotalVotosSim/Nao/Abstencao` when it publishes them (it does on
 * every vote measured — 395 of 395 at the CCJ on 15/10/2026), the recount of the nominal votes
 * only when all three are missing, then flagged `placarComputado`. Until 3.18.5 the parser always
 * recounted, and 5 of those 395 came out different from the published tally: the source repeats
 * the nominal list in some votes (24/25 counted against 12/13 published) and counts an "A" vote
 * as no abstention in others. The published number is the source's own; the recount is not.
 */
export function placarDaComissao(
  votacao: any,
  recontagem: { sim: number; nao: number; abstencao: number },
): { totalSim: number; totalNao: number; totalAbstencao: number; placarComputado?: true } {
  const sim = totalPublicado(votacao?.TotalVotosSim);
  const nao = totalPublicado(votacao?.TotalVotosNao);
  const abstencao = totalPublicado(votacao?.TotalVotosAbstencao);
  if (sim !== null || nao !== null || abstencao !== null) {
    return { totalSim: sim ?? 0, totalNao: nao ?? 0, totalAbstencao: abstencao ?? 0 };
  }
  return { totalSim: recontagem.sim, totalNao: recontagem.nao, totalAbstencao: recontagem.abstencao, placarComputado: true };
}

/** `derived` (contract v1.3) only when some item's tally had to be counted from the votes. */
export const provenanceDaVotacaoComissao = (
  prov: Provenance,
  votacoes: ReadonlyArray<{ placarComputado?: boolean }>,
): Provenance => derivadoSe(prov, votacoes.some((v) => v.placarComputado === true), NOTA_DERIVACAO_PLACAR_COMISSAO);

/**
 * Filter parsed committee votes locally by reunion date. The upstream serves the full
 * history regardless of the date query params, so the window is enforced in-Worker.
 * `data` is an ISO datetime ("2015-10-21T10:25:00"); di/df are YYYYMMDD.
 */
export function filtrarPorData<T extends { data: string | null }>(itens: T[], di?: string, df?: string): T[] {
  if (!di && !df) return itens;
  return itens.filter((v) => {
    const d = (v.data || "").slice(0, 10).replace(/-/g, "");
    if (!d) return false;
    if (di && d < di) return false;
    if (df && d > df) return false;
    return true;
  });
}

export function registerVotacaoComissaoTools(server: SenadoToolHost, baseUrl: string) {
  // M1. senado_votacao_comissao (por: comissao | senador | materia)
  server.tool(
    "senado_votacao_comissao",
    "Lista votações em comissões. O parâmetro `por` (padrão `comissao`) define o eixo da consulta: " +
      "`por: comissao` → exige `siglaComissao`; lista as votações daquela comissão. " +
      "`por: senador` → exige `codigoSenador`; lista os votos do senador em comissões (filtro opcional `comissao`). " +
      "`por: materia` → exige `sigla`, `numero` e `ano` (ex.: PL 2630/2020); lista as votações da proposição em comissões (filtro opcional `comissao`). " +
      "Em todos os casos aceita período opcional `dataInicio`/`dataFim` (YYYYMMDD, filtrado pela data da reunião) e retorna `{ por, ...contexto, count, votacoes }`, cada votação com `codigo`, `data`, `comissao`, `reuniao`, `materia`, `descricao`, totais publicados pela fonte (`totalSim`/`totalNao`/`totalAbstencao`; contados dos votos, com `placarComputado: true`, só quando a fonte não os traz) e `votos` (senador, partido, voto). Sem paginação. Períodos amplos podem estourar o tempo-limite da consulta (erro de timeout): prefira janelas de até 3 meses e divida períodos maiores em chamadas sucessivas. " +
      "Obtenha siglas via `senado_listar_comissoes`, `codigoSenador` via `senado_listar_senadores`; para votações no plenário use `senado_votos_materia`. Atenção: o `codigo` de cada votação de comissão pertence a um espaço de numeração próprio e NÃO é válido em `senado_obter_votacao` (que é exclusivo de plenário) — podem coincidir numericamente, mas apontam para votações diferentes.",
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
          if (!params.codigoSenador) return toolError("Para por=senador, informe 'codigoSenador'.", "contrato");
          const qp = buildParams({
            comissao: params.comissao?.toUpperCase(),
            dataInicio: params.dataInicio,
            dataFim: params.dataFim,
          });
          const path = `/votacaoComissao/parlamentar/${params.codigoSenador}`;
          const { value: response, fetchedAt } = await cachedFetchWithMeta(
            "senado_votacao_comissao_senador",
            { codigo: params.codigoSenador, ...qp },
            CACHE_DYNAMIC,
            () => upstreamFetch(path, qp, baseUrl),
          );
          const votacoes = filtrarPorData(
            digArrayRoot(response, VOTACAO_COMISSAO_ROOT, "senado_votacao_comissao:senador").map(parseVotacaoComissao),
            params.dataInicio,
            params.dataFim,
          );
          const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
            dataset_id: `codigoParlamentar=${params.codigoSenador}`,
            reference_period: params.dataInicio && params.dataFim
              ? `${params.dataInicio}/${params.dataFim}` : undefined,
            retrieved_at: fetchedAt,
          });
          return resultWithProvenance(
            { por, codigoSenador: params.codigoSenador, count: votacoes.length, votacoes },
            provenanceDaVotacaoComissao(prov, votacoes),
          );
        }

        if (por === "materia") {
          if (!params.sigla || !params.numero || !params.ano) {
            return toolError("Para por=materia, informe 'sigla', 'numero' e 'ano'.", "contrato");
          }
          const sigla = params.sigla.toUpperCase();
          const qp = buildParams({
            comissao: params.comissao?.toUpperCase(),
            dataInicio: params.dataInicio,
            dataFim: params.dataFim,
          });
          const path = `/votacaoComissao/materia/${sigla}/${params.numero}/${params.ano}`;
          const { value: response, fetchedAt } = await cachedFetchWithMeta(
            "senado_votacao_comissao_materia",
            { sigla, numero: params.numero, ano: params.ano, ...qp },
            CACHE_DYNAMIC,
            () => upstreamFetch(path, qp, baseUrl),
          );
          const votacoes = filtrarPorData(
            digArrayRoot(response, VOTACAO_COMISSAO_ROOT, "senado_votacao_comissao:materia").map(parseVotacaoComissao),
            params.dataInicio,
            params.dataFim,
          );
          const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
            dataset_id: `materia=${sigla} ${params.numero}/${params.ano}`,
            reference_period: String(params.ano),
            retrieved_at: fetchedAt,
          });
          return resultWithProvenance(
            { por, materia: `${sigla} ${params.numero}/${params.ano}`, count: votacoes.length, votacoes },
            provenanceDaVotacaoComissao(prov, votacoes),
          );
        }

        // por === "comissao" (padrão)
        if (!params.siglaComissao) return toolError("Para por=comissao, informe 'siglaComissao'.", "contrato");
        const qp = buildParams({
          dataInicio: params.dataInicio,
          dataFim: params.dataFim,
        });
        const sigla = params.siglaComissao.toUpperCase();
        const path = `/votacaoComissao/comissao/${sigla}`;
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_votacao_comissao",
          { sigla, ...qp },
          CACHE_DYNAMIC,
          () => upstreamFetch(path, qp, baseUrl),
        );
        const votacoes = filtrarPorData(
          digArrayRoot(response, VOTACAO_COMISSAO_ROOT, "senado_votacao_comissao:comissao").map(parseVotacaoComissao),
          params.dataInicio,
          params.dataFim,
        );
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          dataset_id: `comissao=${sigla}`,
          reference_period: params.dataInicio && params.dataFim
            ? `${params.dataInicio}/${params.dataFim}` : undefined,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({ por, siglaComissao: sigla, count: votacoes.length, votacoes }, provenanceDaVotacaoComissao(prov, votacoes));
      } catch (e) {
        return errorFrom(e, "Erro ao obter votações em comissões");
      }
    },
  );
}
