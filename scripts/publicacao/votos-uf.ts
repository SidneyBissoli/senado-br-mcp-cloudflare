/**
 * Fase D1 — acervo de votos por UF (CSV Arquimedes), em duas tabelas (decisão 4 do desenho da fase D):
 *   - `votos-uf`, LONGA: uma linha por matéria × UF × valor visto, com o intervalo de versões do CSV
 *     em que ele valeu (`desde`/`ate` = primeira e última leitura do CSV com aqueles votos; `leituras`
 *     = quantas versões);
 *   - `materias`, uma linha por matéria do acervo: identificação, ementa, autoria, situação no CSV e o
 *     carimbo "dados atualizados até" (`referencePeriod`) da versão mais recente. Fica à parte para a
 *     ementa não se repetir em cada UF.
 *
 * Arquivo primeiro (CSV guardado desde 20/11/2026); a matéria que o arquivo não tem vem do corpus
 * (vintage único, `desde = ate` = o scraped_at da linha), com `origem` = `corpus`.
 */

import type { Observacao } from "../observacoes/fundir.js";
import { agruparPorId, compararIds, json, naLeitura, ultimaLeitura } from "./comum.js";
import { URL_DA_CONSULTA } from "./consultas.js";

export interface VotosUfDoCorpus {
  entityId: string;
  scrapedAt: string;
  materia: string | null;
  ementa: string | null;
  autoria: string | null;
  status: string | null;
  referencePeriod: string | null;
  /** JSON `{ "UF": { "sim": n, "nao": n } }`, como gravado. */
  votosPorUf: string | null;
}

export interface LinhaMateriaDoAcervo {
  codigo: string;
  materia: string | null;
  ementa: string | null;
  autoria: string | null;
  status: string | null;
  referencePeriod: string | null;
  /** Calculados (decisão 5): soma sobre as UFs da versão mais recente. */
  votosSim: number | null;
  votosNao: number | null;
  totalVotos: number | null;
  url: string;
  origem: "csv" | "corpus";
  coletadoEm: string;
}

/** Soma SIM/NÃO sobre as UFs; null se alguma UF não traz o número (nunca 0 inventado). */
function totais(ufs: { sim: number | null; nao: number | null }[]): { votosSim: number | null; votosNao: number | null; totalVotos: number | null } {
  const soma = (k: "sim" | "nao") => (ufs.some((u) => u[k] === null) ? null : ufs.reduce((a, u) => a + (u[k] as number), 0));
  const votosSim = soma("sim");
  const votosNao = soma("nao");
  return { votosSim, votosNao, totalVotos: votosSim === null || votosNao === null ? null : votosSim + votosNao };
}

export interface LinhaVotosUf {
  codigo: string;
  uf: string;
  sim: number | null;
  nao: number | null;
  desde: string;
  ate: string;
  leituras: number;
  sha: string | null;
  origem: "csv" | "corpus";
}

export function tabelasDoAcervo(obs: readonly Observacao[], corpus: readonly VotosUfDoCorpus[]): { materias: LinhaMateriaDoAcervo[]; votosUf: LinhaVotosUf[] } {
  const porId = agruparPorId(obs, "consultas_votos");
  const materias: LinhaMateriaDoAcervo[] = [];
  const votosUf: LinhaVotosUf[] = [];
  for (const [codigo, os] of porId) {
    const u = ultimaLeitura(os, (f) => f === "csv", "materia");
    if (!u) continue;
    const na = naLeitura(os, "csv", u.r);
    const atuais = na.varios("votosUf").map((v) => json<{ sim: number | null; nao: number | null }>(v)!);
    materias.push({
      codigo, materia: na.v("materia"), ementa: na.v("ementa"), autoria: na.v("autoria"), status: na.v("status"),
      referencePeriod: na.v("referencePeriod"), ...totais(atuais), url: `${URL_DA_CONSULTA}${codigo}`, origem: "csv", coletadoEm: u.r,
    });
    for (const o of os) {
      if (o.campo !== "votosUf") continue;
      const v = json<{ uf: string; sim: number | null; nao: number | null }>(o.valor)!;
      votosUf.push({ codigo, uf: v.uf, sim: v.sim, nao: v.nao, desde: o.vistoPrimeiro, ate: o.vistoUltimo, leituras: o.leituras, sha: o.shaPrimeiro, origem: "csv" });
    }
  }
  for (const c of corpus) {
    if (porId.has(c.entityId)) continue;
    const ufs = json<Record<string, { sim: number | null; nao: number | null }>>(c.votosPorUf) ?? {};
    materias.push({
      codigo: c.entityId, materia: c.materia, ementa: c.ementa, autoria: c.autoria, status: c.status, referencePeriod: c.referencePeriod,
      ...totais(Object.values(ufs)), url: `${URL_DA_CONSULTA}${c.entityId}`, origem: "corpus", coletadoEm: c.scrapedAt,
    });
    for (const [uf, v] of Object.entries(ufs)) {
      votosUf.push({ codigo: c.entityId, uf, sim: v.sim, nao: v.nao, desde: c.scrapedAt, ate: c.scrapedAt, leituras: 1, sha: null, origem: "corpus" });
    }
  }
  materias.sort((a, b) => compararIds(a.codigo, b.codigo));
  votosUf.sort((a, b) => compararIds(a.codigo, b.codigo) || (a.uf < b.uf ? -1 : a.uf > b.uf ? 1 : 0) || (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0));
  return { materias, votosUf };
}
