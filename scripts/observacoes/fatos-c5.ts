/**
 * Fase C5 do ROADMAP — fatos das páginas de consultas, eventos e do acervo de votos por UF (B4,
 * arquivados desde 20/11/2026). Mesma camada 2 das ideias (`fatos.ts`, `fundir.ts`): formato longo,
 * valor em texto, uma série por entidade × fonte. Puro, exceto `versaoDoLeitorC5` (lê os fontes).
 *
 *   consultas     listagem `pesquisamateria?p=N` → votosSim, votosNao, identificacao, ementa (a série
 *                 de votos SIM/NÃO); detalhe `visualizacaomateria?id=N` → statusHttp, autoria. O
 *                 `processo.json` da API legislativa NÃO é observação de consulta (só decide o universo
 *                 de status no coletor): fica fora do escopo.
 *   eventos       listagem `principalaudiencia?p=N` → titulo, data, hora, comissao, comentarios,
 *                 status; detalhe `visualizacaoaudiencia?id=N` → statusHttp e os campos do evento, um
 *                 fato por item da pauta e por convidado; `ajaxcolecaocomentarioaudiencia?audienciaId=N`
 *                 → um fato por comentário (id, UF, data, hora, texto, momento do vídeo; sem nome, como
 *                 o corpus: o nome é descartado na origem).
 *   consultas_votos  o CSV Arquimedes (windows-1252) → por matéria: materia, status e um fato `votosUf`
 *                 por UF ({uf, sim, nao}). Uma versão nova do CSV só muda as linhas das UFs que mudaram.
 *
 * Determinismo: a situação da listagem de eventos cai, sem a classe do bloco, na comparação da data
 * com "agora"; aqui "agora" é o INSTANTE DA LEITURA (o que o coletor viu), e o job roda em TZ=UTC.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseComentariosAudiencia, parseConsultaDetalheCorpus, parseEventoDetalhe } from "../../src/scraper/ecidadania.js";
import { parseVotosCsv } from "../ingest-ecidadania/csv.js";
import { parseEventoListingPage } from "../ingest-ecidadania/eventos-listing.js";
import { parseConsultaListingPage } from "../ingest-ecidadania/listing.js";
import type { Fato, Fonte } from "./fatos.js";
import type { Leitura } from "./fundir.js";

export type EntidadeC5 = "consultas" | "eventos" | "consultas_votos";
export const ENTIDADES_C5: readonly EntidadeC5[] = ["consultas", "eventos", "consultas_votos"];

/** Uma linha do índice (a mesma consulta de `linhas.ts`). */
export interface LinhaC5 {
  id: number;
  url: string;
  entity_id: string | null;
  instante: string;
  status_http: number;
  sha256: string;
}

const num = (n: number | null | undefined): string | null => (n === null || n === undefined ? null : String(n));
const txt = (s: string | null | undefined): string | null => (s === null || s === undefined || s === "" ? null : s);

/** Fonte da página; null = fora do escopo da C5 (ex.: `processo.json`). */
export function fonteC5(entidade: EntidadeC5, url: string): Fonte | null {
  if (entidade === "consultas") {
    if (/\/pesquisamateria(?:\?|$)/.test(url)) return "listagem";
    if (/\/visualizacaomateria\?/.test(url)) return "detalhe";
    return null;
  }
  if (entidade === "eventos") {
    if (/\/principalaudiencia(?:\?|$)/.test(url)) return "listagem";
    if (/\/visualizacaoaudiencia\?/.test(url)) return "detalhe";
    if (/\/ajaxcolecaocomentarioaudiencia\?/.test(url)) return "comentarios";
    return null;
  }
  return /\.csv(?:\?|$)/i.test(url) ? "csv" : null;
}

/** Status que observa alguma coisa (o detalhe removido é fato; 5xx não). */
export function statusObservavelC5(fonte: Fonte, statusHttp: number): boolean {
  return fonte === "detalhe" ? statusHttp === 200 || statusHttp === 404 || statusHttp === 410 : statusHttp === 200;
}

/** Charset da página: o CSV Arquimedes é windows-1252; o resto, UTF-8. */
export function decodificarC5(fonte: Fonte, bytes: Uint8Array): string {
  return fonte === "csv"
    ? new TextDecoder("windows-1252").decode(bytes)
    : new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(bytes);
}

export function fatosDaListagemDeConsultas(html: string): Map<string, Fato[]> {
  const m = new Map<string, Fato[]>();
  for (const it of parseConsultaListingPage(html)) {
    const f = m.get(String(it.codigoMateria)) ?? [];
    f.push(
      { campo: "votosSim", valor: num(it.votosSim) }, { campo: "votosNao", valor: num(it.votosNao) },
      { campo: "identificacao", valor: txt(it.identificacao) }, { campo: "ementa", valor: txt(it.ementa) },
    );
    m.set(String(it.codigoMateria), f);
  }
  return m;
}

export function fatosDaListagemDeEventos(html: string, instante: string): Map<string, Fato[]> {
  const m = new Map<string, Fato[]>();
  for (const it of parseEventoListingPage(html, new Date(instante))) {
    const f = m.get(String(it.id)) ?? [];
    f.push(
      { campo: "titulo", valor: txt(it.titulo) }, { campo: "data", valor: txt(it.data) }, { campo: "hora", valor: txt(it.hora) },
      { campo: "comissao", valor: txt(it.comissao) }, { campo: "comentarios", valor: num(it.comentarios) }, { campo: "status", valor: txt(it.status) },
    );
    m.set(String(it.id), f);
  }
  return m;
}

export function fatosDoDetalheDeEvento(html: string): Fato[] {
  const d = parseEventoDetalhe(html);
  return [
    { campo: "statusHttp", valor: "200" },
    { campo: "titulo", valor: txt(d.titulo) }, { campo: "descricao", valor: txt(d.descricao) },
    { campo: "data", valor: txt(d.data) }, { campo: "hora", valor: txt(d.hora) },
    { campo: "comissao", valor: txt(d.comissao) }, { campo: "comissaoNomeCompleto", valor: txt(d.comissaoNomeCompleto) },
    { campo: "local", valor: txt(d.local) }, { campo: "status", valor: txt(d.status) }, { campo: "videoUrl", valor: txt(d.videoUrl) },
    // Posição na página (0 = o primeiro) dentro do valor: a fusão ordena os fatos por valor, e sem ela
    // a ordem da pauta e dos convidados se perderia (achado da D1, 22/11/2026).
    ...d.pauta.map((p, posicao) => ({ campo: "pauta", valor: JSON.stringify({ posicao, texto: p }) })),
    ...d.convidados.map((c, posicao) => ({ campo: "convidado", valor: JSON.stringify({ posicao, texto: c }) })),
  ];
}

export function fatosDosComentarios(html: string): Fato[] {
  const cs = parseComentariosAudiencia(html);
  return [
    { campo: "comentarios", valor: String(cs.length) },
    ...cs.map((c) => ({
      campo: "comentario",
      valor: JSON.stringify({ id: c.comentarioId, uf: c.uf, data: c.data, hora: c.hora, texto: c.texto, momentoVideoUrl: c.momentoVideoUrl, convidadoAssociado: c.convidadoAssociado }),
    })),
  ];
}

export function fatosDoCsv(texto: string): Map<string, Fato[]> {
  const { rows } = parseVotosCsv(texto);
  const m = new Map<string, Fato[]>();
  for (const r of rows) {
    const k = String(r.codigoMateria);
    let f = m.get(k);
    if (!f) {
      f = [{ campo: "materia", valor: txt(r.materia) }, { campo: "status", valor: txt(r.status) }];
      m.set(k, f);
    }
    f.push({ campo: "votosUf", valor: JSON.stringify({ uf: r.uf, sim: r.votosSim, nao: r.votosNao }) });
  }
  return m;
}

const idDoParametro = (url: string, nome: string) => new RegExp(`[?&]${nome}=(\\d+)`).exec(url)?.[1] ?? null;

export interface ContagemC5 {
  foraDoMolde: number;
}

/**
 * Leituras de série de UMA linha do índice. Página que o leitor recusa: o detalhe vira `erroLeitura`
 * (como nas ideias); listagem, fragmento ou CSV fora do molde são contados e avisados, sem fatos.
 */
export function leiturasC5(entidade: EntidadeC5, l: LinhaC5, texto: string, c: ContagemC5): Leitura[] {
  const fonte = fonteC5(entidade, l.url)!;
  const base = { indice: l.id, instante: l.instante, sha256: l.sha256, entidade, fonte };
  const porId = (m: Map<string, Fato[]>) => [...m].map(([entityId, fatos]) => ({ ...base, entityId, fatos }));
  const umaSo = (entityId: string | null, fatos: Fato[]) => (entityId ? [{ ...base, entityId, fatos }] : []);
  try {
    if (fonte === "detalhe") {
      const id = l.entity_id ?? idDoParametro(l.url, "id");
      if (l.status_http !== 200) return umaSo(id, [{ campo: "statusHttp", valor: String(l.status_http) }]);
      try {
        if (entidade === "consultas") {
          return umaSo(id, [{ campo: "statusHttp", valor: "200" }, { campo: "autoria", valor: txt(parseConsultaDetalheCorpus(texto).autoria) }]);
        }
        return umaSo(id, fatosDoDetalheDeEvento(texto));
      } catch (e) {
        c.foraDoMolde++;
        return umaSo(id, [{ campo: "statusHttp", valor: "200" }, { campo: "erroLeitura", valor: e instanceof Error ? e.message : String(e) }]);
      }
    }
    if (fonte === "listagem") return porId(entidade === "consultas" ? fatosDaListagemDeConsultas(texto) : fatosDaListagemDeEventos(texto, l.instante));
    if (fonte === "comentarios") return umaSo(idDoParametro(l.url, "audienciaId"), fatosDosComentarios(texto));
    return porId(fatosDoCsv(texto));
  } catch (e) {
    c.foraDoMolde++;
    console.warn(`[observacoes][${entidade}] ${fonte} fora do molde (índice ${l.id}): ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/** SQL de um lote do índice de uma entidade da C5 (só inteiros e constantes). */
export function sqlDoLoteC5(entidade: EntidadeC5, cursor: number, lote: number): string {
  if (!ENTIDADES_C5.includes(entidade) || !Number.isInteger(cursor) || !Number.isInteger(lote)) throw new Error("lote inválido");
  return (
    "SELECT i.id, i.url, i.entity_id, i.instante, i.status_http, i.sha256, p.formato, p.referencia " +
    "FROM ecidadania_arquivo_indice i LEFT JOIN ecidadania_arquivo_pagina p ON p.sha256 = i.sha256 " +
    `WHERE i.entidade = '${entidade}' AND i.id > ${cursor} ORDER BY i.id LIMIT ${lote}`
  );
}

/** Versão do leitor de uma entidade da C5: sha dos fontes que decidem os fatos DELA. */
export function versaoDoLeitorC5(entidade: EntidadeC5): string {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const comuns = ["fatos-c5.ts", "fundir.ts"];
  const proprios: Record<EntidadeC5, string[]> = {
    consultas: ["../ingest-ecidadania/listing.ts", "../../src/scraper/ecidadania.ts"],
    eventos: ["../ingest-ecidadania/eventos-listing.ts", "../../src/scraper/ecidadania.ts"],
    consultas_votos: ["../ingest-ecidadania/csv.ts"],
  };
  const h = createHash("sha256").update(entidade);
  for (const rel of [...comuns, ...proprios[entidade]]) h.update(readFileSync(join(aqui, rel), "utf8").replace(/\r\n/g, "\n"));
  return `observacoes-${entidade}@${h.digest("hex").slice(0, 12)}`;
}
