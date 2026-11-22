/**
 * Lê do D1 o que a camada 3 usa do corpus: a linha atual de cada entidade (`ecidadania_current`, só os
 * campos usados, extraídos no banco), o first-seen (MIN(scraped_at) do history), as versões de votos
 * das consultas (history) e os comentários dos eventos. Paginado por chave (`> último`), nunca OFFSET.
 * Todo SQL aqui é estático: só entram inteiros e nomes de entidade de uma lista fechada.
 */

import { queryD1 } from "../ingest-ecidadania/d1.js";
import type { ConsultaDoCorpus, VersaoDeVotos } from "./consultas.js";
import type { ComentarioDoCorpus, EventoDoCorpus } from "./eventos.js";
import type { IdeiaDoCorpus } from "./ideias.js";
import type { VotosUfDoCorpus } from "./votos-uf.js";

const PAGINA = 5_000;
const ENTIDADES = ["ideias", "consultas", "eventos", "consultas_votos"] as const;
type Entidade = (typeof ENTIDADES)[number];

function inteiro(n: number): number {
  if (!Number.isInteger(n)) throw new Error("página inválida");
  return n;
}
function entidade(e: Entidade): Entidade {
  if (!ENTIDADES.includes(e)) throw new Error(`entidade inválida: ${e}`);
  return e;
}

const ex = (campo: string, nome = campo) => `json_extract(payload_json, '$.${campo}') AS ${nome}`;

/** Campos extraídos por entidade (o payload inteiro seria bem maior). */
const CAMPOS: Record<Entidade, string[]> = {
  ideias: [ex("titulo"), ex("apoios"), "status", ex("dataPublicacao"), ex("autorUf"), ex("descricao"), ex("plConvertido"), ex("proposicoes")],
  consultas: [ex("materia"), ex("ementa"), ex("votosSim"), ex("votosNao"), ex("autoria"), ex("relator"), "status"],
  eventos: [
    ex("titulo"), ex("data"), ex("hora"), ex("comissao"), ex("comissaoNomeCompleto"), ex("local"), ex("descricao"),
    ex("pauta"), ex("convidados"), ex("videoUrl"), ex("comentarios"), "status",
  ],
  consultas_votos: [ex("materia"), ex("ementa"), ex("autoria"), "status", ex("referencePeriod"), ex("votosPorUf")],
};

export function sqlDoAtual(e: Entidade, depoisDe: number, pagina = PAGINA): string {
  return (
    `SELECT entity_id, scraped_at, ${CAMPOS[entidade(e)].join(", ")} FROM ecidadania_current ` +
    `WHERE entidade = '${e}' AND entity_id > ${inteiro(depoisDe)} ORDER BY entity_id LIMIT ${inteiro(pagina)}`
  );
}

export function sqlDoFirstSeen(e: Entidade, depoisDe: number, pagina = PAGINA * 4): string {
  return (
    "SELECT entity_id, MIN(scraped_at) AS fs FROM ecidadania_history " +
    `WHERE entidade = '${entidade(e)}' AND entity_id > ${inteiro(depoisDe)} GROUP BY entity_id ORDER BY entity_id LIMIT ${inteiro(pagina)}`
  );
}

type Linha = Record<string, unknown> & { entity_id: number; scraped_at: string };

function paginar<T extends { r?: number; entity_id?: number }>(sql: (depoisDe: number) => string, chave: (x: T) => number, pagina: number): T[] {
  const out: T[] = [];
  let depoisDe = 0;
  for (;;) {
    const rs = queryD1<T>(sql(depoisDe));
    out.push(...rs);
    if (rs.length < pagina) break;
    depoisDe = chave(rs[rs.length - 1]);
  }
  return out;
}

function lerAtual(e: Entidade): Linha[] {
  return paginar<Linha>((d) => sqlDoAtual(e, d), (x) => x.entity_id, PAGINA);
}

const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
/** json_extract devolve listas/objetos como texto JSON; um escalar vira texto também. */
const j = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v));

export function lerIdeiasAtuais(): IdeiaDoCorpus[] {
  return lerAtual("ideias").map((r) => ({
    entityId: String(r.entity_id), scrapedAt: r.scraped_at, titulo: s(r.titulo), apoios: n(r.apoios), status: s(r.status),
    dataPublicacao: s(r.dataPublicacao), autorUf: s(r.autorUf), descricao: s(r.descricao), plConvertido: s(r.plConvertido), proposicoes: j(r.proposicoes),
  }));
}

export function lerConsultasAtuais(): ConsultaDoCorpus[] {
  return lerAtual("consultas").map((r) => ({
    entityId: String(r.entity_id), scrapedAt: r.scraped_at, materia: s(r.materia), ementa: s(r.ementa), votosSim: n(r.votosSim),
    votosNao: n(r.votosNao), autoria: s(r.autoria), relator: s(r.relator), status: s(r.status),
  }));
}

export function lerEventosAtuais(): EventoDoCorpus[] {
  return lerAtual("eventos").map((r) => ({
    entityId: String(r.entity_id), scrapedAt: r.scraped_at, titulo: s(r.titulo), data: s(r.data), hora: s(r.hora), comissao: s(r.comissao),
    comissaoNomeCompleto: s(r.comissaoNomeCompleto), local: s(r.local), descricao: s(r.descricao), pauta: j(r.pauta), convidados: j(r.convidados),
    videoUrl: s(r.videoUrl), comentarios: n(r.comentarios), status: s(r.status),
  }));
}

export function lerVotosUfAtuais(): VotosUfDoCorpus[] {
  return lerAtual("consultas_votos").map((r) => ({
    entityId: String(r.entity_id), scrapedAt: r.scraped_at, materia: s(r.materia), ementa: s(r.ementa), autoria: s(r.autoria), status: s(r.status),
    referencePeriod: s(r.referencePeriod), votosPorUf: j(r.votosPorUf),
  }));
}

export function lerFirstSeen(e: Entidade): Map<string, string> {
  const pagina = PAGINA * 4;
  const rs = paginar<{ entity_id: number; fs: string }>((d) => sqlDoFirstSeen(e, d, pagina), (x) => x.entity_id, pagina);
  return new Map(rs.map((r) => [String(r.entity_id), r.fs]));
}

/** Versões de votos das consultas no history, pelo rowid (o history só acrescenta). */
export function sqlDosVotosNoHistorico(depoisDe: number, pagina = PAGINA * 10): string {
  return (
    `SELECT rowid AS r, entity_id, scraped_at, ${ex("votosSim")}, ${ex("votosNao")} FROM ecidadania_history ` +
    `WHERE entidade = 'consultas' AND rowid > ${inteiro(depoisDe)} ORDER BY rowid LIMIT ${inteiro(pagina)}`
  );
}

export function lerVotosNoHistorico(): VersaoDeVotos[] {
  const pagina = PAGINA * 10;
  const rs = paginar<{ r: number; entity_id: number; scraped_at: string; votosSim: unknown; votosNao: unknown }>((d) => sqlDosVotosNoHistorico(d, pagina), (x) => x.r, pagina);
  return rs.map((x) => ({ entityId: String(x.entity_id), scrapedAt: x.scraped_at, votosSim: n(x.votosSim), votosNao: n(x.votosNao) }));
}

export function sqlDosComentarios(depoisDe: number, pagina = PAGINA): string {
  return (
    "SELECT rowid AS r, evento_id, comentario_id, uf, data, hora, texto, momento_video_url, convidado_associado FROM ecidadania_comentarios " +
    `WHERE rowid > ${inteiro(depoisDe)} ORDER BY rowid LIMIT ${inteiro(pagina)}`
  );
}

export function lerComentarios(): ComentarioDoCorpus[] {
  const rs = paginar<Record<string, unknown> & { r: number }>((d) => sqlDosComentarios(d), (x) => x.r, PAGINA);
  return rs.map((x) => ({
    eventoId: String(x.evento_id), comentarioId: String(x.comentario_id), uf: s(x.uf), data: s(x.data), hora: s(x.hora), texto: s(x.texto),
    momentoVideoUrl: s(x.momento_video_url), convidadoAssociado: s(x.convidado_associado),
  }));
}
