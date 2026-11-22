/**
 * Fase D1 — tabelas publicadas das consultas públicas (camada 3), no molde das ideias (decisão 4 do
 * desenho da fase D): uma linha por consulta com as colunas do esquema 2.0.0, e a série de votos
 * SIM/NÃO em formato longo (uma linha por consulta × voto × valor visto).
 *
 * Blocos (decisão 2): RESUMO = a listagem `pesquisamateria` (matéria, ementa, votos); DETALHE = a
 * página `visualizacaomateria` (autoria). Arquivo primeiro, corpus de reserva (decisão 1): as 540
 * consultas encerradas saíram da listagem e só existem no corpus. Colunas calculadas ficam, marcadas
 * (decisão 5): totalVotos, percentuais com UMA casa decimal (null sem votos), status, url, firstSeenAt.
 *
 * Série de votos: origem `listagem` (arquivo, desde 20/11/2026: valor visto de `desde` a `ate`, com o
 * número de leituras e a primeira página) e `corpus` (`ecidadania_history`, desde 14/06/2026: um ponto
 * por MUDANÇA, `desde = ate`). O 2 h do Worker emenda votos dos destaques no corpus sem arquivar a
 * página: por isso o corpus pode ter pontos que o arquivo não tem.
 */

import type { Observacao } from "../observacoes/fundir.js";
import { agruparPorId, compararIds, int, naLeitura, percentual, ultimaLeitura } from "./comum.js";

export const URL_DA_CONSULTA = "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=";

export interface ConsultaDoCorpus {
  entityId: string;
  scrapedAt: string;
  materia: string | null;
  ementa: string | null;
  votosSim: number | null;
  votosNao: number | null;
  autoria: string | null;
  relator: string | null;
  status: string | null;
}

export interface VersaoDeVotos {
  entityId: string;
  scrapedAt: string;
  votosSim: number | null;
  votosNao: number | null;
}

export interface LinhaConsulta {
  id: string;
  materia: string | null;
  ementa: string | null;
  votosSim: number | null;
  votosNao: number | null;
  totalVotos: number | null;
  percentualSim: number | null;
  percentualNao: number | null;
  autoria: string | null;
  relator: string | null;
  status: string | null;
  url: string;
  firstSeenAt: string | null;
  origemResumo: "arquivo" | "corpus" | null;
  coletadoEmResumo: string | null;
  origemDetalhe: "arquivo" | "corpus" | null;
  coletadoEmDetalhe: string | null;
}

export interface PontoDeVotos {
  id: string;
  voto: "SIM" | "NAO";
  votos: number | null;
  desde: string;
  ate: string;
  leituras: number;
  sha: string | null;
  origem: "listagem" | "corpus";
}

export function tabelasDasConsultas(
  obs: readonly Observacao[],
  corpus: readonly ConsultaDoCorpus[],
  historico: readonly VersaoDeVotos[],
  firstSeen: ReadonlyMap<string, string>,
): { consultas: LinhaConsulta[]; serieVotos: PontoDeVotos[] } {
  const porId = agruparPorId(obs, "consultas");
  const doCorpus = new Map(corpus.map((c) => [c.entityId, c]));
  const ids = [...new Set([...porId.keys(), ...doCorpus.keys()])].sort(compararIds);
  const consultas: LinhaConsulta[] = [];

  for (const id of ids) {
    const os = porId.get(id) ?? [];
    const c = doCorpus.get(id);
    const l: LinhaConsulta = {
      id, materia: null, ementa: null, votosSim: null, votosNao: null, totalVotos: null, percentualSim: null, percentualNao: null,
      autoria: null, relator: c?.relator ?? null, status: c?.status ?? null, url: `${URL_DA_CONSULTA}${id}`, firstSeenAt: firstSeen.get(id) ?? null,
      origemResumo: null, coletadoEmResumo: null, origemDetalhe: null, coletadoEmDetalhe: null,
    };
    const res = ultimaLeitura(os, (f) => f === "listagem", "identificacao");
    if (res) {
      const na = naLeitura(os, res.fonte, res.r);
      Object.assign(l, { materia: na.v("identificacao"), ementa: na.v("ementa"), votosSim: int(na.v("votosSim")), votosNao: int(na.v("votosNao")), origemResumo: "arquivo", coletadoEmResumo: res.r });
    } else if (c) {
      Object.assign(l, { materia: c.materia, ementa: c.ementa, votosSim: c.votosSim, votosNao: c.votosNao, origemResumo: "corpus", coletadoEmResumo: c.scrapedAt });
    }
    // Detalhe aberto emite `autoria` (mesmo null); a recusada só erroLeitura, o 404/410 só statusHttp.
    const det = ultimaLeitura(os, (f) => f === "detalhe", "autoria");
    if (det) Object.assign(l, { autoria: naLeitura(os, "detalhe", det.r).v("autoria"), origemDetalhe: "arquivo", coletadoEmDetalhe: det.r });
    else if (c) Object.assign(l, { autoria: c.autoria, origemDetalhe: "corpus", coletadoEmDetalhe: c.scrapedAt });

    l.totalVotos = l.votosSim === null || l.votosNao === null ? null : l.votosSim + l.votosNao;
    l.percentualSim = percentual(l.votosSim, l.totalVotos);
    l.percentualNao = percentual(l.votosNao, l.totalVotos);
    consultas.push(l);
  }

  const serieVotos: PontoDeVotos[] = [];
  for (const o of obs) {
    if (o.entidade !== "consultas" || o.fonte !== "listagem" || (o.campo !== "votosSim" && o.campo !== "votosNao")) continue;
    serieVotos.push({
      id: o.entityId, voto: o.campo === "votosSim" ? "SIM" : "NAO", votos: int(o.valor), desde: o.vistoPrimeiro, ate: o.vistoUltimo,
      leituras: o.leituras, sha: o.shaPrimeiro, origem: "listagem",
    });
  }
  serieVotos.push(...pontosDoCorpus(historico));
  serieVotos.sort((a, b) => compararIds(a.id, b.id) || (a.voto < b.voto ? -1 : a.voto > b.voto ? 1 : 0) || (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0) || (a.origem < b.origem ? -1 : a.origem > b.origem ? 1 : 0));
  return { consultas, serieVotos };
}

/** Pontos de MUDANÇA do corpus, por voto. */
export function pontosDoCorpus(historico: readonly VersaoDeVotos[]): PontoDeVotos[] {
  const ord = [...historico].sort((a, b) => compararIds(a.entityId, b.entityId) || (a.scrapedAt < b.scrapedAt ? -1 : a.scrapedAt > b.scrapedAt ? 1 : 0));
  const out: PontoDeVotos[] = [];
  let id = "";
  let ult: Record<"SIM" | "NAO", number | null | undefined> = { SIM: undefined, NAO: undefined };
  for (const v of ord) {
    if (v.entityId !== id) {
      id = v.entityId;
      ult = { SIM: undefined, NAO: undefined };
    }
    for (const [voto, votos] of [["SIM", v.votosSim], ["NAO", v.votosNao]] as const) {
      if (votos !== ult[voto]) out.push({ id, voto, votos, desde: v.scrapedAt, ate: v.scrapedAt, leituras: 1, sha: null, origem: "corpus" });
      ult[voto] = votos;
    }
  }
  return out;
}
