/**
 * Autoria oficial das matérias — E1.b do ROADMAP (vínculos do e-Cidadania com códigos oficiais;
 * desenho decidido pelo dono em 24/11/2026). Parte PURA do coletor `index-autoria.ts`: monta a fila,
 * lê a lista de processos e escreve o SQL do estado. Nada aqui faz rede.
 *
 *   - Senado: a lista `/processo?codigoMateria=N` dá os processos da matéria; o detalhe `/processo/{id}`
 *     traz `autoriaIniciativa[]` e `documento.autoria[]` com `codigoParlamentar` (decisões 2 e 4).
 *   - Câmara: `/api/v2/proposicoes/{id}/autores` traz o id de cada deputado.
 *
 * Fila, em ordem de prioridade (decisão de 25/11/2026): (1) consultas do corpus (o id da consulta É o
 * código da matéria); (2) proposições das ideias, pelo código lido do link publicado; (3) matérias do
 * acervo histórico de votos por UF que não estão entre as consultas (~10 mil, por último: podem ser
 * cortadas sem perder as anteriores). Matéria já lida não volta (a autoria não muda depois de
 * apresentada; reler é decisão futura, registrada no ROADMAP).
 */

import { sqlValue } from "./sql.js";

export type Casa = "SF" | "CD";
export type SituacaoAutoria = "lida" | "sem-processo" | "nao-encontrada";

export interface Alvo {
  casa: Casa;
  codigo: number;
  /** De onde veio: só para o log e a contagem. */
  origem: "consulta" | "ideia" | "acervo";
}

export const chaveDoAlvo = (a: { casa: Casa; codigo: number }): string => `${a.casa}:${a.codigo}`;

/**
 * Código oficial lido do link da proposição publicado na linha do tempo da ideia. Senado:
 * `…/materia/<codigoMateria>`; Câmara: `fichadetramitacao?idProposicao=<id>`. Outro link → null
 * (fica fora da fila, sem adivinhar).
 */
export function alvoDoLinkDaProposicao(url: string | null | undefined): { casa: Casa; codigo: number } | null {
  if (!url) return null;
  const sf = /senado\.leg\.br\/.*\/materia\/(\d+)(?:[/?#]|$)/.exec(url);
  if (sf) return { casa: "SF", codigo: Number(sf[1]) };
  const cd = /camara\.leg\.br\/.*[?&]idProposicao=(\d+)/.exec(url);
  if (cd) return { casa: "CD", codigo: Number(cd[1]) };
  return null;
}

/** Fila sem repetição, na ordem de prioridade, sem as já lidas, com no máximo `limite` alvos. */
export function filaDaAutoria(
  fontes: { consultas: number[]; linksDasIdeias: (string | null)[]; acervo: number[] },
  feitas: ReadonlySet<string>,
  limite: number,
): { fila: Alvo[]; pendentes: number } {
  const vistos = new Set<string>();
  const todos: Alvo[] = [];
  const pôr = (a: Alvo) => {
    if (!Number.isSafeInteger(a.codigo) || a.codigo <= 0) return;
    const k = chaveDoAlvo(a);
    if (vistos.has(k) || feitas.has(k)) return;
    vistos.add(k);
    todos.push(a);
  };
  for (const c of fontes.consultas) pôr({ casa: "SF", codigo: c, origem: "consulta" });
  for (const u of fontes.linksDasIdeias) {
    const a = alvoDoLinkDaProposicao(u);
    if (a) pôr({ ...a, origem: "ideia" });
  }
  for (const c of fontes.acervo) pôr({ casa: "SF", codigo: c, origem: "acervo" });
  return { fila: todos.slice(0, Math.max(0, limite)), pendentes: todos.length };
}

/** Teto de processos por matéria: medido 1 em 30 (25/11/2026); acima disto é molde novo. */
export const MAX_PROCESSOS = 10;

export class AutoriaForaDoMoldeError extends Error {}

/**
 * Ids dos processos na resposta da lista. Lança se a resposta não é uma lista de objetos com `id`
 * inteiro e `codigoMateria` igual ao pedido — melhor não marcar a matéria do que marcar errado.
 */
export function idsDaListaDeProcessos(json: unknown, codigoMateria: number): number[] {
  if (!Array.isArray(json)) throw new AutoriaForaDoMoldeError(`lista de processos da matéria ${codigoMateria} não é um array`);
  const ids: number[] = [];
  for (const p of json) {
    const id = (p as { id?: unknown })?.id;
    const cm = (p as { codigoMateria?: unknown })?.codigoMateria;
    if (typeof id !== "number" || !Number.isSafeInteger(id)) {
      throw new AutoriaForaDoMoldeError(`processo sem id inteiro na lista da matéria ${codigoMateria}`);
    }
    if (cm !== undefined && cm !== codigoMateria) {
      throw new AutoriaForaDoMoldeError(`lista da matéria ${codigoMateria} trouxe o processo ${id} da matéria ${String(cm)}`);
    }
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > MAX_PROCESSOS) {
    throw new AutoriaForaDoMoldeError(`matéria ${codigoMateria} com ${ids.length} processos (teto ${MAX_PROCESSOS})`);
  }
  return ids;
}

/** Confere que o detalhe é do processo pedido e traz a autoria (pode vir vazia, nunca ausente). */
export function conferirDetalheDoProcesso(json: unknown, id: number): void {
  const o = json as { id?: unknown; autoriaIniciativa?: unknown } | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new AutoriaForaDoMoldeError(`detalhe do processo ${id} não é um objeto`);
  if (o.id !== id) throw new AutoriaForaDoMoldeError(`detalhe pedido ${id} respondeu o processo ${String(o.id)}`);
  if (!Array.isArray(o.autoriaIniciativa)) throw new AutoriaForaDoMoldeError(`detalhe do processo ${id} sem autoriaIniciativa[]`);
}

/** Confere a resposta dos autores na Câmara: `{ dados: [...] }`. */
export function conferirAutoresDaCamara(json: unknown, id: number): void {
  const dados = (json as { dados?: unknown } | null)?.dados;
  if (!Array.isArray(dados)) throw new AutoriaForaDoMoldeError(`autores da proposição ${id} (Câmara) sem dados[]`);
}

/** Upsert do estado de uma matéria (linha só depois de o índice do arquivo ter sido descarregado). */
export function estadoStmt(
  a: { casa: Casa; codigo: number },
  situacao: SituacaoAutoria,
  processos: number[] | null,
  lidaEm: string,
  leitor: string,
): string {
  return (
    "INSERT INTO ecidadania_autoria_estado (casa, codigo, situacao, processos, lida_em, leitor) VALUES (" +
    [sqlValue(a.casa), sqlValue(a.codigo), sqlValue(situacao), sqlValue(processos && processos.length ? processos.join(",") : null), sqlValue(lidaEm), sqlValue(leitor)].join(", ") +
    ") ON CONFLICT(casa, codigo) DO UPDATE SET situacao = excluded.situacao, processos = excluded.processos, " +
    "lida_em = excluded.lida_em, leitor = excluded.leitor;"
  );
}
