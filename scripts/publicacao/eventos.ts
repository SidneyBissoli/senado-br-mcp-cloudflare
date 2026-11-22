/**
 * Fase D1 — tabelas publicadas dos eventos interativos (camada 3), no molde das ideias (decisão 4 do
 * desenho da fase D): uma linha por evento com as colunas do esquema 2.0.0, e tabelas tidy para a
 * pauta e os convidados (uma linha por item, na ordem da página) e os comentários (um por linha).
 *
 * Três blocos de página (decisão 2, com a página de comentários que só os eventos têm):
 *   RESUMO      — a leitura mais recente que traz título, comissão e situação (listagem ou detalhe);
 *   DETALHE     — `visualizacaoaudiencia`: data e hora canônicas (estudo A3), descrição, comissão por
 *                 extenso, local, vídeo, pauta e convidados;
 *   COMENTÁRIOS — o fragmento AJAX: a contagem canônica e os comentários um a um.
 * Arquivo primeiro, corpus de reserva (decisão 1). Comentaristas seguem SEM nome (só UF e texto).
 */

import type { Observacao } from "../observacoes/fundir.js";
import { agruparPorId, compararIds, int, json, naLeitura, ultimaLeitura } from "./comum.js";

export const URL_DO_EVENTO = "https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id=";

type Origem = "arquivo" | "corpus";

export interface EventoDoCorpus {
  entityId: string;
  scrapedAt: string;
  titulo: string | null;
  data: string | null;
  hora: string | null;
  comissao: string | null;
  comissaoNomeCompleto: string | null;
  local: string | null;
  descricao: string | null;
  /** JSON das listas, como gravadas. */
  pauta: string | null;
  convidados: string | null;
  videoUrl: string | null;
  comentarios: number | null;
  status: string | null;
}

export interface ComentarioDoCorpus {
  eventoId: string;
  comentarioId: string;
  uf: string | null;
  data: string | null;
  hora: string | null;
  texto: string | null;
  momentoVideoUrl: string | null;
  convidadoAssociado: string | null;
}

export interface LinhaEvento {
  id: string;
  titulo: string | null;
  data: string | null;
  hora: string | null;
  comissao: string | null;
  comissaoNomeCompleto: string | null;
  local: string | null;
  descricao: string | null;
  videoUrl: string | null;
  comentarios: number | null;
  status: string | null;
  url: string;
  firstSeenAt: string | null;
  origemResumo: "listagem" | "detalhe" | "corpus" | null;
  coletadoEmResumo: string | null;
  origemDetalhe: Origem | null;
  coletadoEmDetalhe: string | null;
  origemComentarios: Origem | null;
  coletadoEmComentarios: string | null;
}

export interface LinhaItemDoEvento {
  id: string;
  ordem: number;
  texto: string;
  origem: Origem;
}

export interface LinhaComentario extends ComentarioDoCorpus {
  origem: Origem;
}

export interface TabelasDosEventos {
  eventos: LinhaEvento[];
  pauta: LinhaItemDoEvento[];
  convidados: LinhaItemDoEvento[];
  comentarios: LinhaComentario[];
}

const lista = (s: string | null): string[] => (json<unknown[]>(s) ?? []).map(String);

/** Itens com posição (`{posicao, texto}`), na ordem da página. */
function itensComPosicao(valores: string[]): { ordem: number; texto: string }[] {
  return valores
    .map((v) => json<{ posicao: number; texto: string }>(v)!)
    .sort((a, b) => a.posicao - b.posicao)
    .map((i) => ({ ordem: i.posicao, texto: i.texto }));
}

export function tabelasDosEventos(
  obs: readonly Observacao[],
  corpus: readonly EventoDoCorpus[],
  comentariosDoCorpus: readonly ComentarioDoCorpus[],
  firstSeen: ReadonlyMap<string, string>,
): TabelasDosEventos {
  const porId = agruparPorId(obs, "eventos");
  const doCorpus = new Map(corpus.map((c) => [c.entityId, c]));
  const comentCorpus = new Map<string, ComentarioDoCorpus[]>();
  for (const c of comentariosDoCorpus) {
    const l = comentCorpus.get(c.eventoId);
    if (l) l.push(c);
    else comentCorpus.set(c.eventoId, [c]);
  }
  const ids = [...new Set([...porId.keys(), ...doCorpus.keys()])].sort(compararIds);
  const t: TabelasDosEventos = { eventos: [], pauta: [], convidados: [], comentarios: [] };

  for (const id of ids) {
    const os = porId.get(id) ?? [];
    const c = doCorpus.get(id);
    const e: LinhaEvento = {
      id, titulo: null, data: null, hora: null, comissao: null, comissaoNomeCompleto: null, local: null, descricao: null, videoUrl: null,
      comentarios: null, status: null, url: `${URL_DO_EVENTO}${id}`, firstSeenAt: firstSeen.get(id) ?? null,
      origemResumo: null, coletadoEmResumo: null, origemDetalhe: null, coletadoEmDetalhe: null, origemComentarios: null, coletadoEmComentarios: null,
    };

    // Resumo: título, comissão (sigla) e situação, da leitura mais recente (listagem ou detalhe aberto).
    const res = ultimaLeitura(os, (f) => f === "listagem" || f === "detalhe", "titulo");
    if (res) {
      const na = naLeitura(os, res.fonte, res.r);
      Object.assign(e, { titulo: na.v("titulo"), comissao: na.v("comissao"), status: na.v("status"), origemResumo: res.fonte === "detalhe" ? "detalhe" : "listagem", coletadoEmResumo: res.r });
    } else if (c) {
      Object.assign(e, { titulo: c.titulo, comissao: c.comissao, status: c.status, origemResumo: "corpus", coletadoEmResumo: c.scrapedAt });
    }

    // Detalhe aberto emite `titulo`; a recusada só erroLeitura, o 404/410 só statusHttp.
    const det = ultimaLeitura(os, (f) => f === "detalhe", "titulo");
    if (det) {
      const na = naLeitura(os, "detalhe", det.r);
      Object.assign(e, {
        data: na.v("data"), hora: na.v("hora"), comissaoNomeCompleto: na.v("comissaoNomeCompleto"), local: na.v("local"),
        descricao: na.v("descricao"), videoUrl: na.v("videoUrl"), origemDetalhe: "arquivo", coletadoEmDetalhe: det.r,
      });
      for (const i of itensComPosicao(na.varios("pauta"))) t.pauta.push({ id, ...i, origem: "arquivo" });
      for (const i of itensComPosicao(na.varios("convidado"))) t.convidados.push({ id, ...i, origem: "arquivo" });
    } else if (c) {
      Object.assign(e, {
        data: c.data, hora: c.hora, comissaoNomeCompleto: c.comissaoNomeCompleto, local: c.local, descricao: c.descricao, videoUrl: c.videoUrl,
        origemDetalhe: "corpus", coletadoEmDetalhe: c.scrapedAt,
      });
      lista(c.pauta).forEach((texto, ordem) => t.pauta.push({ id, ordem, texto, origem: "corpus" }));
      lista(c.convidados).forEach((texto, ordem) => t.convidados.push({ id, ordem, texto, origem: "corpus" }));
    }

    // Comentários: o fragmento emite sempre a contagem (mesmo 0).
    const com = ultimaLeitura(os, (f) => f === "comentarios", "comentarios");
    if (com) {
      const na = naLeitura(os, "comentarios", com.r);
      Object.assign(e, { comentarios: int(na.v("comentarios")), origemComentarios: "arquivo", coletadoEmComentarios: com.r });
      for (const v of na.varios("comentario")) {
        const x = json<{ id: number | string; uf: string | null; data: string | null; hora: string | null; texto: string | null; momentoVideoUrl: string | null; convidadoAssociado: string | null }>(v)!;
        t.comentarios.push({
          eventoId: id, comentarioId: String(x.id), uf: x.uf, data: x.data, hora: x.hora, texto: x.texto,
          momentoVideoUrl: x.momentoVideoUrl, convidadoAssociado: x.convidadoAssociado, origem: "arquivo",
        });
      }
    } else if (c) {
      Object.assign(e, { comentarios: c.comentarios, origemComentarios: "corpus", coletadoEmComentarios: c.scrapedAt });
      for (const x of comentCorpus.get(id) ?? []) t.comentarios.push({ ...x, origem: "corpus" });
    }
    t.eventos.push(e);
  }
  t.comentarios.sort((a, b) => compararIds(a.eventoId, b.eventoId) || compararIds(a.comentarioId, b.comentarioId));
  return t;
}
