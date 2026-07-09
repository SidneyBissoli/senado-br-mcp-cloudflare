/**
 * Resolver da estrutura organizacional — funções puras sobre o snapshot bundlado.
 *
 * Reconstrói o índice da árvore (por código, por sigla, por nome normalizado e filhos por pai)
 * e oferece as operações que os tools consomem: resolver um órgão pela sigla ou pelo nome,
 * listar sua subárvore (todas as unidades subordinadas) e seus ancestrais, e — dado o conjunto
 * de nomes/siglas de uma subárvore — decidir se a lotação de um servidor cai sob aquela unidade.
 *
 * Sem I/O: opera sobre `ESTRUTURA_ORGANIZACIONAL` (congelado do portal institucional). Exportado
 * inteiro para teste unitário direto (padrão do repo: parsers/resolvers testados como funções).
 */

import { ESTRUTURA_ORGANIZACIONAL } from "../data/estrutura-organizacional.js";
import { normalizarNome } from "./normalizar.js";
import type { OrgaoNode } from "./tipos.js";

export interface IndiceEstrutura {
  orgaos: OrgaoNode[];
  porCod: Map<number, OrgaoNode>;
  filhosPorCod: Map<number, number[]>;
  porSigla: Map<string, OrgaoNode>;
  porNomeNormalizado: Map<string, OrgaoNode[]>;
}

/** Conjunto de casamento de uma subárvore: nomes normalizados + siglas (maiúsculas). */
export interface ConjuntoCasamento {
  nomes: Set<string>;
  siglas: Set<string>;
}

/** Constrói o índice a partir do snapshot (ou de uma lista de órgãos passada — para teste). */
export function construirIndice(orgaos: OrgaoNode[] = ESTRUTURA_ORGANIZACIONAL.orgaos): IndiceEstrutura {
  const porCod = new Map<number, OrgaoNode>();
  const filhosPorCod = new Map<number, number[]>();
  const porSigla = new Map<string, OrgaoNode>();
  const porNomeNormalizado = new Map<string, OrgaoNode[]>();
  for (const o of orgaos) {
    porCod.set(o.cod, o);
    if (o.sigla) porSigla.set(o.sigla.toUpperCase(), o);
    const nn = normalizarNome(o.nome);
    if (nn) {
      const arr = porNomeNormalizado.get(nn) ?? [];
      arr.push(o);
      porNomeNormalizado.set(nn, arr);
    }
  }
  for (const o of orgaos) {
    if (o.codSuperior != null && porCod.has(o.codSuperior)) {
      const arr = filhosPorCod.get(o.codSuperior) ?? [];
      arr.push(o.cod);
      filhosPorCod.set(o.codSuperior, arr);
    }
  }
  return { orgaos, porCod, filhosPorCod, porSigla, porNomeNormalizado };
}

/**
 * Resolve um órgão pela `consulta`: primeiro por sigla exata (case-insensitive), depois por nome
 * normalizado exato. Retorna `null` se não achar. (A busca parcial fica a cargo de `sugerir`.)
 */
export function resolverOrgao(indice: IndiceEstrutura, consulta: string): OrgaoNode | null {
  const q = (consulta ?? "").trim();
  if (!q) return null;
  const porSigla = indice.porSigla.get(q.toUpperCase());
  if (porSigla) return porSigla;
  const porNome = indice.porNomeNormalizado.get(normalizarNome(q));
  return porNome && porNome.length ? porNome[0] : null;
}

/** Sugere órgãos cuja sigla ou nome contém a consulta (para mensagem de erro amigável). */
export function sugerirOrgaos(indice: IndiceEstrutura, consulta: string, limite = 8): OrgaoNode[] {
  const q = normalizarNome(consulta);
  const qUpper = (consulta ?? "").trim().toUpperCase();
  if (!q && !qUpper) return [];
  const out: OrgaoNode[] = [];
  for (const o of indice.orgaos) {
    const bateSigla = o.sigla && o.sigla.toUpperCase().includes(qUpper);
    const bateNome = q && normalizarNome(o.nome).includes(q);
    if (bateSigla || bateNome) out.push(o);
    if (out.length >= limite) break;
  }
  return out;
}

/** Todos os órgãos da subárvore de `cod` (incluindo o próprio), em pré-ordem. */
export function subarvore(indice: IndiceEstrutura, cod: number): OrgaoNode[] {
  const out: OrgaoNode[] = [];
  const pilha = [cod];
  const visto = new Set<number>();
  while (pilha.length) {
    const c = pilha.pop()!;
    if (visto.has(c)) continue;
    visto.add(c);
    const node = indice.porCod.get(c);
    if (node) out.push(node);
    for (const f of indice.filhosPorCod.get(c) ?? []) pilha.push(f);
  }
  return out;
}

/** Ancestrais de `cod`, do superior imediato até a raiz (não inclui o próprio). */
export function ancestrais(indice: IndiceEstrutura, cod: number): OrgaoNode[] {
  const out: OrgaoNode[] = [];
  let atual = indice.porCod.get(cod);
  const visto = new Set<number>([cod]);
  while (atual && atual.codSuperior != null) {
    const pai = indice.porCod.get(atual.codSuperior);
    if (!pai || visto.has(pai.cod)) break;
    out.push(pai);
    visto.add(pai.cod);
    atual = pai;
  }
  return out;
}

/** Conjunto de casamento (nomes normalizados + siglas) da subárvore de `cod`. */
export function conjuntoCasamento(indice: IndiceEstrutura, cod: number): ConjuntoCasamento {
  const nomes = new Set<string>();
  const siglas = new Set<string>();
  for (const o of subarvore(indice, cod)) {
    const nn = normalizarNome(o.nome);
    if (nn) nomes.add(nn);
    if (o.sigla) siglas.add(o.sigla.toUpperCase());
  }
  return { nomes, siglas };
}

/** A lotação `{ sigla, nome }` de um servidor casa com o conjunto de uma subárvore? */
export function lotacaoNoConjunto(
  conjunto: ConjuntoCasamento,
  lotacao: { sigla?: string | null; nome?: string | null } | null | undefined,
): boolean {
  if (!lotacao) return false;
  const sigla = (lotacao.sigla ?? "").toUpperCase();
  if (sigla && conjunto.siglas.has(sigla)) return true;
  const nn = normalizarNome(lotacao.nome);
  return nn ? conjunto.nomes.has(nn) : false;
}

/** A lotação é reconhecida em ALGUM nó da árvore (usado p/ separar "não classificados")? */
export function lotacaoReconhecida(
  indice: IndiceEstrutura,
  lotacao: { sigla?: string | null; nome?: string | null } | null | undefined,
): boolean {
  if (!lotacao) return false;
  const sigla = (lotacao.sigla ?? "").toUpperCase();
  if (sigla && indice.porSigla.has(sigla)) return true;
  const nn = normalizarNome(lotacao.nome);
  return nn ? indice.porNomeNormalizado.has(nn) : false;
}

/** Heurística: a lotação é de estrutura PARLAMENTAR (gabinete/liderança/escritório/bloco)? */
export function ehLotacaoParlamentar(nome: string | null | undefined): boolean {
  return /gabinete|lideran|bloco|escrit[oó]rio|banca|suplente/i.test(nome ?? "");
}

/** Vintage do snapshot (ISO-8601 da extração no portal) — para proveniência/aviso. */
export const ESTRUTURA_VINTAGE = ESTRUTURA_ORGANIZACIONAL.extraidoEm;
export const ESTRUTURA_FONTE_URL = ESTRUTURA_ORGANIZACIONAL.fonteUrl;
