/**
 * E1.c do ROADMAP — tabelas de vínculos (decisões do dono de 24/11/2026):
 *
 *   vinculos/materias  DERIVADA: item do e-Cidadania × matéria oficial (Casa, código), com o MÉTODO do
 *                      vínculo e quando a matéria foi conferida na fonte oficial. Consultas e acervo:
 *                      o id/código JÁ É o código da matéria; ideias: o código lido do link publicado.
 *   vinculos/autores   CÓPIA da fonte oficial: matéria × autor na ordem publicada, com o PAPEL
 *                      (`iniciativa` | `texto` no Senado, decisão 4; `camara` na Câmara), código do
 *                      parlamentar / id do deputado, e a página de onde veio (instante e sha).
 *
 * Vigia (decisão 4): nas consultas, `resumoAutoria` do processo tem de ser o texto que o portal mostra —
 * igual, ou começando por ele seguido de ", " (o portal mostra só o 1º autor e esconde os demais atrás
 * de "e outros >"; o corte é na 1ª vírgula, até no nome de comissão: medido em 120 consultas em
 * 25/11/2026, 109 iguais e 11 neste caso, nenhuma outra diferença). Vínculo que não confere fica FORA
 * da tabela e é contado/avisado no log.
 */

import { alvoDoLinkDaProposicao, type Casa } from "../ingest-ecidadania/autoria.js";
import type { Observacao } from "../observacoes/fundir.js";
import { compararIds, json, naLeitura, ultimaLeitura } from "./comum.js";

export type Metodo = "id-da-consulta" | "link-publicado" | "codigo-do-acervo";
export type SituacaoDoVinculo = "lida" | "sem-processo" | "nao-encontrada" | "pendente";

export interface ItensDoECidadania {
  consultas: readonly { id: string; autoria: string | null }[];
  proposicoes: readonly { id: string; url: string | null }[];
  acervo: readonly { codigo: string }[];
}

export interface LinhaVinculoMateria {
  entidade: "consultas" | "ideias" | "consultas_votos";
  itemId: string;
  casa: Casa;
  codigo: string;
  metodo: Metodo;
  linkPublicado: string | null;
  situacao: SituacaoDoVinculo;
  processos: string | null;
  identificacao: string | null;
  resumoAutoria: string | null;
  autoriaNoPortal: string | null;
  confereComPortal: "sim" | null;
  conferidoEm: string | null;
}

export interface LinhaAutor {
  casa: Casa;
  codigo: string;
  processo: string | null;
  papel: "iniciativa" | "texto" | "camara";
  posicao: number;
  ordem: number | null;
  autor: string | null;
  tipo: string | null;
  codigoParlamentar: number | null;
  idDeputado: number | null;
  uf: string | null;
  siglaPartido: string | null;
  cargo: string | null;
  ente: string | null;
  outrosAutoresNaoInformados: string | null;
  proponente: number | null;
  url: string;
  coletadoEm: string;
  sha: string;
}

const SENADO = "https://legis.senado.leg.br/dadosabertos";
const CAMARA = "https://dadosabertos.camara.leg.br/api/v2";

/** A vigia da decisão 4. null = nada a comparar (sem texto do portal ou sem resumo). */
export function confereComPortal(resumo: string | null, portal: string | null): "sim" | "nao" | null {
  if (resumo === null || portal === null) return null;
  const n = (s: string) => s.replace(/\s+/g, " ").trim();
  const r = n(resumo);
  const p = n(portal);
  if (!p) return null;
  return r === p || r.startsWith(`${p}, `) ? "sim" : "nao";
}

interface Leitura {
  r: string;
  v: (campo: string) => string | null;
  varios: (campo: string) => string[];
  sha: string;
}

/** A última leitura de uma série (fonte × id), ou null se nunca foi lida. */
function ultima(series: Map<string, Observacao[]>, fonte: string, id: string): Leitura | null {
  const os = series.get(`${fonte}\u0000${id}`) ?? [];
  const u = ultimaLeitura(os, (f) => f === fonte, "statusHttp");
  if (!u) return null;
  const na = naLeitura(os, fonte, u.r);
  const marcador = na.todas.find((o) => o.campo === "statusHttp")!;
  return { r: u.r, v: na.v, varios: na.varios, sha: marcador.shaUltimo };
}

interface Materia {
  situacao: SituacaoDoVinculo;
  processos: string[];
  identificacao: string | null;
  resumoAutoria: string | null;
  conferidoEm: string | null;
  autores: LinhaAutor[];
}

const ordenarAutores = (xs: string[]) => xs.map((x) => json<Record<string, unknown>>(x)!).sort((a, b) => (a.papel as string).localeCompare(b.papel as string) || (a.posicao as number) - (b.posicao as number));

/** Estado de uma matéria a partir das observações da autoria. `incoerentes` conta detalhe de outra matéria. */
function materia(series: Map<string, Observacao[]>, casa: Casa, codigo: string, c: { incoerentes: number }): Materia {
  const vazia: Materia = { situacao: "pendente", processos: [], identificacao: null, resumoAutoria: null, conferidoEm: null, autores: [] };
  if (casa === "CD") {
    const l = ultima(series, "camara", codigo);
    if (!l) return vazia;
    if (l.v("statusHttp") === "404") return { ...vazia, situacao: "nao-encontrada", conferidoEm: l.r };
    if (l.v("erroLeitura") !== null) return vazia;
    const url = `${CAMARA}/proposicoes/${codigo}/autores`;
    const autores = ordenarAutores(l.varios("autor")).map((a) => linhaAutor(a, casa, codigo, null, url, l));
    return { ...vazia, situacao: "lida", conferidoEm: l.r, autores };
  }
  const lista = ultima(series, "processos", codigo);
  if (!lista) return vazia;
  if (lista.v("statusHttp") === "404") return { ...vazia, situacao: "nao-encontrada", conferidoEm: lista.r };
  if (lista.v("erroLeitura") !== null) return vazia;
  const processos = lista.varios("processo").sort(compararIds);
  if (processos.length === 0) return { ...vazia, situacao: "sem-processo", conferidoEm: lista.r };
  const out: Materia = { ...vazia, situacao: "lida", processos, conferidoEm: lista.r };
  for (const p of processos) {
    const d = ultima(series, "processo", p);
    if (!d || d.v("statusHttp") !== "200" || d.v("erroLeitura") !== null) return { ...vazia, processos };
    if (d.v("codigoMateria") !== codigo) {
      c.incoerentes++;
      return { ...vazia, processos };
    }
    out.identificacao ??= d.v("identificacao");
    out.resumoAutoria ??= d.v("resumoAutoria");
    const url = `${SENADO}/processo/${p}`;
    out.autores.push(...ordenarAutores(d.varios("autor")).map((a) => linhaAutor(a, casa, codigo, p, url, d)));
  }
  return out;
}

function linhaAutor(a: Record<string, unknown>, casa: Casa, codigo: string, processo: string | null, url: string, l: Leitura): LinhaAutor {
  const n = (k: string) => (typeof a[k] === "number" ? (a[k] as number) : null);
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : null);
  return {
    casa, codigo, processo, papel: a.papel as LinhaAutor["papel"], posicao: (a.posicao as number) + 1, ordem: n("ordem"), autor: s("autor"), tipo: s("tipo"),
    codigoParlamentar: n("codigoParlamentar"), idDeputado: n("idDeputado"), uf: s("uf"), siglaPartido: s("siglaPartido"), cargo: s("cargo"), ente: s("ente"),
    outrosAutoresNaoInformados: s("outrosAutoresNaoInformados"), proponente: n("proponente"), url, coletadoEm: l.r, sha: l.sha,
  };
}

export interface ResultadoDosVinculos {
  materias: LinhaVinculoMateria[];
  autores: LinhaAutor[];
  /** Consultas cuja autoria no portal não confere com o resumo oficial (fora da tabela). */
  naoConferem: string[];
  incoerentes: number;
}

export function tabelasDosVinculos(obs: readonly Observacao[], itens: ItensDoECidadania): ResultadoDosVinculos {
  const series = new Map<string, Observacao[]>();
  for (const o of obs) {
    if (o.entidade !== "autoria") continue;
    const k = `${o.fonte}\u0000${o.entityId}`;
    const l = series.get(k);
    if (l) l.push(o);
    else series.set(k, [o]);
  }
  const c = { incoerentes: 0 };
  const cache = new Map<string, Materia>();
  const da = (casa: Casa, codigo: string) => {
    const k = `${casa}:${codigo}`;
    let m = cache.get(k);
    if (!m) cache.set(k, (m = materia(series, casa, codigo, c)));
    return m;
  };

  const materias: LinhaVinculoMateria[] = [];
  const naoConferem: string[] = [];
  const vistos = new Set<string>();
  const pôr = (l: Omit<LinhaVinculoMateria, "situacao" | "processos" | "identificacao" | "resumoAutoria" | "confereComPortal" | "conferidoEm">) => {
    const k = `${l.entidade}:${l.itemId}:${l.casa}:${l.codigo}`;
    if (vistos.has(k)) return;
    vistos.add(k);
    const m = da(l.casa, l.codigo);
    const confere = confereComPortal(m.resumoAutoria, l.autoriaNoPortal);
    if (confere === "nao") {
      naoConferem.push(l.itemId);
      return;
    }
    materias.push({
      ...l, situacao: m.situacao, processos: m.processos.length ? m.processos.join(",") : null, identificacao: m.identificacao,
      resumoAutoria: m.resumoAutoria, confereComPortal: confere, conferidoEm: m.conferidoEm,
    });
  };

  for (const x of itens.consultas) pôr({ entidade: "consultas", itemId: x.id, casa: "SF", codigo: x.id, metodo: "id-da-consulta", linkPublicado: null, autoriaNoPortal: x.autoria });
  for (const x of itens.proposicoes) {
    const a = alvoDoLinkDaProposicao(x.url);
    if (a) pôr({ entidade: "ideias", itemId: x.id, casa: a.casa, codigo: String(a.codigo), metodo: "link-publicado", linkPublicado: x.url, autoriaNoPortal: null });
  }
  for (const x of itens.acervo) pôr({ entidade: "consultas_votos", itemId: x.codigo, casa: "SF", codigo: x.codigo, metodo: "codigo-do-acervo", linkPublicado: null, autoriaNoPortal: null });

  const ordemEntidade = { consultas: 0, ideias: 1, consultas_votos: 2 } as const;
  materias.sort((a, b) => ordemEntidade[a.entidade] - ordemEntidade[b.entidade] || compararIds(a.itemId, b.itemId) || a.casa.localeCompare(b.casa) || compararIds(a.codigo, b.codigo));

  // Autores: de toda matéria lida que entrou em algum vínculo (a mesma matéria uma vez só).
  const autores: LinhaAutor[] = [];
  const emVinculo = new Set(materias.map((m) => `${m.casa}:${m.codigo}`));
  for (const k of [...emVinculo].sort()) autores.push(...cache.get(k)!.autores);
  autores.sort((a, b) => a.casa.localeCompare(b.casa) || compararIds(a.codigo, b.codigo) || compararIds(a.processo ?? "", b.processo ?? "") || a.papel.localeCompare(b.papel) || a.posicao - b.posicao);
  return { materias, autores, naoConferem, incoerentes: c.incoerentes };
}
