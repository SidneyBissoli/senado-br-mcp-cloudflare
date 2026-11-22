/**
 * Fase D1 — acervo de votos por UF (CSV Arquimedes) em formato LONGO (decisão 4 do desenho da fase D):
 * uma linha por matéria × UF × valor visto, com o intervalo de versões do CSV em que ele valeu
 * (`desde`/`ate` = primeira e última leitura do CSV com aqueles votos; `leituras` = quantas versões).
 * Matéria e situação são as da leitura mais recente da matéria.
 *
 * Arquivo primeiro (CSV guardado desde 20/11/2026); a matéria que o arquivo não tem vem do corpus
 * (vintage único, `desde = ate` = o scraped_at da linha), com `origem` = `corpus`.
 */

import type { Observacao } from "../observacoes/fundir.js";
import { agruparPorId, compararIds, json, naLeitura, ultimaLeitura } from "./comum.js";

export interface VotosUfDoCorpus {
  entityId: string;
  scrapedAt: string;
  materia: string | null;
  status: string | null;
  /** JSON `{ "UF": { "sim": n, "nao": n } }`, como gravado. */
  votosPorUf: string | null;
}

export interface LinhaVotosUf {
  codigo: string;
  materia: string | null;
  status: string | null;
  uf: string;
  sim: number | null;
  nao: number | null;
  desde: string;
  ate: string;
  leituras: number;
  sha: string | null;
  origem: "csv" | "corpus";
}

export function tabelaDeVotosUf(obs: readonly Observacao[], corpus: readonly VotosUfDoCorpus[]): LinhaVotosUf[] {
  const porId = agruparPorId(obs, "consultas_votos");
  const out: LinhaVotosUf[] = [];
  for (const [codigo, os] of porId) {
    const u = ultimaLeitura(os, (f) => f === "csv", "materia");
    if (!u) continue;
    const na = naLeitura(os, "csv", u.r);
    const materia = na.v("materia");
    const status = na.v("status");
    for (const o of os) {
      if (o.campo !== "votosUf") continue;
      const v = json<{ uf: string; sim: number | null; nao: number | null }>(o.valor)!;
      out.push({ codigo, materia, status, uf: v.uf, sim: v.sim, nao: v.nao, desde: o.vistoPrimeiro, ate: o.vistoUltimo, leituras: o.leituras, sha: o.shaPrimeiro, origem: "csv" });
    }
  }
  for (const c of corpus) {
    if (porId.has(c.entityId)) continue;
    const ufs = json<Record<string, { sim: number | null; nao: number | null }>>(c.votosPorUf) ?? {};
    for (const [uf, v] of Object.entries(ufs)) {
      out.push({ codigo: c.entityId, materia: c.materia, status: c.status, uf, sim: v.sim, nao: v.nao, desde: c.scrapedAt, ate: c.scrapedAt, leituras: 1, sha: null, origem: "corpus" });
    }
  }
  return out.sort((a, b) => compararIds(a.codigo, b.codigo) || (a.uf < b.uf ? -1 : a.uf > b.uf ? 1 : 0) || (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0));
}
