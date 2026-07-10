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
import { normalizarNome, tokenizarNome } from "./normalizar.js";
import type { OrgaoNode } from "./tipos.js";

/** Nó preparado para o casamento aproximado (tokens e nome normalizado pré-computados). */
export interface NoCasamento {
  orgao: OrgaoNode;
  tokens: string[];
  nomeNormalizado: string;
}

export interface IndiceEstrutura {
  orgaos: OrgaoNode[];
  porCod: Map<number, OrgaoNode>;
  filhosPorCod: Map<number, number[]>;
  porSigla: Map<string, OrgaoNode>;
  porNomeNormalizado: Map<string, OrgaoNode[]>;
  nosCasamento: NoCasamento[];
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
  const nosCasamento: NoCasamento[] = [];
  for (const o of orgaos) {
    porCod.set(o.cod, o);
    if (o.sigla) porSigla.set(o.sigla.toUpperCase(), o);
    const tokens = tokenizarNome(o.nome);
    const nn = tokens.join(" ");
    if (nn) {
      const arr = porNomeNormalizado.get(nn) ?? [];
      arr.push(o);
      porNomeNormalizado.set(nn, arr);
      nosCasamento.push({ orgao: o, tokens, nomeNormalizado: nn });
    }
  }
  for (const o of orgaos) {
    if (o.codSuperior != null && porCod.has(o.codSuperior)) {
      const arr = filhosPorCod.get(o.codSuperior) ?? [];
      arr.push(o.cod);
      filhosPorCod.set(o.codSuperior, arr);
    }
  }
  return { orgaos, porCod, filhosPorCod, porSigla, porNomeNormalizado, nosCasamento };
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

/**
 * Casamento APROXIMADO de lotação — camadas para além do exato (sigla/nome), na ordem:
 *
 * 1. **sigla→extenso**: o cadastro às vezes embute uma sigla no nome ("Gabinete da DGER");
 *    tokens em CAIXA-ALTA no nome cru que sejam sigla conhecida são substituídos pelo nome
 *    por extenso do órgão e o resultado é casado EXATO ("gabinete diretoria geral").
 * 2. **prefixo por token**: o cadastro trunca (largura fixa) e abreia o nome da lotação
 *    ("Coord. de Projetos e Obras de Infraestrutura", "Núcleo de Quali. e Padron. de Proc.…");
 *    cada token da lotação deve ser igual ou prefixo (≥2 chars) do token correspondente do nó,
 *    podendo a lotação terminar antes (truncamento). Guardas de especificidade evitam casar
 *    nomes genéricos; empate de pontuação devolve TODOS os candidatos (o chamador decide se a
 *    ambiguidade importa — ex.: todos dentro da mesma subárvore ainda é resposta inequívoca).
 *
 * Camada nova e separada dos casadores exatos (`lotacaoNoConjunto`/`lotacaoReconhecida`), que
 * mantêm a semântica já validada em produção — use esta APENAS como fallback quando eles falham.
 */
export interface CasamentoAproximado {
  metodo: "sigla-extenso" | "prefixo";
  orgaos: OrgaoNode[];
}

/** Especificidade mínima (chars do nome normalizado) p/ casar por prefixo com abreviações. */
const MIN_CHARS_PREFIXO = 14;
/** Especificidade mínima quando a lotação é prefixo LITERAL do nome do nó (truncamento puro). */
const MIN_CHARS_TRUNCAMENTO = 10;

/**
 * Casa tokens da lotação contra tokens do nó, posição a posição: cada token deve ser igual ou
 * prefixo (≥2 chars) do correspondente; a lotação pode ter menos tokens (nome truncado).
 * Retorna a soma de caracteres casados (0 = não casa) — a pontuação do candidato.
 */
export function casamentoPorTokens(lot: string[], no: string[]): number {
  if (!lot.length || lot.length > no.length) return 0;
  let chars = 0;
  for (let i = 0; i < lot.length; i++) {
    if (lot[i] !== no[i] && !(lot[i].length >= 2 && no[i].startsWith(lot[i]))) return 0;
    chars += lot[i].length;
  }
  return chars;
}

/** Melhores candidatos por prefixo de token (empatados na maior pontuação), com as guardas. */
function melhoresPorPrefixo(indice: IndiceEstrutura, lotTokens: string[]): OrgaoNode[] {
  if (lotTokens.length < 2) return [];
  const juntado = lotTokens.join(" ");
  if (juntado.length < MIN_CHARS_TRUNCAMENTO) return [];
  let melhorPontuacao = 0;
  let melhores: OrgaoNode[] = [];
  for (const { orgao, tokens, nomeNormalizado } of indice.nosCasamento) {
    const chars = casamentoPorTokens(lotTokens, tokens);
    if (!chars) continue;
    // Nomes curtos só casam como truncamento literal (prefixo de string do nome do nó).
    if (juntado.length < MIN_CHARS_PREFIXO && !nomeNormalizado.startsWith(juntado)) continue;
    // Cobrir todos os tokens do nó desempata sobre casar só o começo de um nome mais longo.
    const pontuacao = chars * 2 + (lotTokens.length === tokens.length ? 1 : 0);
    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhores = [orgao];
    } else if (pontuacao === melhorPontuacao) {
      melhores.push(orgao);
    }
  }
  return melhores;
}

/**
 * Substitui tokens que aparecem em CAIXA-ALTA no nome cru e são sigla conhecida pelo nome por
 * extenso do órgão correspondente. Retorna `null` se nada foi substituído (evita re-casamentos
 * idênticos). A exigência de caixa-alta no texto original evita expandir palavras comuns que
 * coincidam com alguma sigla.
 */
function expandirSiglasNoNome(indice: IndiceEstrutura, nomeCru: string, tokens: string[]): string[] | null {
  const palavrasCaixaAlta = new Set(
    (nomeCru.match(/\b[A-ZÀ-Ü][A-ZÀ-Ü0-9]{1,}\b/g) ?? []).map((p) => p.toUpperCase()),
  );
  let mudou = false;
  const out: string[] = [];
  for (const t of tokens) {
    const maiuscula = t.toUpperCase();
    const orgao = palavrasCaixaAlta.has(maiuscula) ? indice.porSigla.get(maiuscula) : undefined;
    if (orgao) {
      out.push(...tokenizarNome(orgao.nome));
      mudou = true;
    } else {
      out.push(t);
    }
  }
  return mudou ? out : null;
}

/**
 * Tenta casar uma lotação NÃO reconhecida pelos casadores exatos: sigla→extenso exato, depois
 * prefixo por token (nome original e, se houve expansão de sigla, o expandido). Retorna os
 * candidatos empatados (`orgaos.length === 1` = casamento inequívoco) ou `null`.
 */
export function casarLotacaoAproximado(
  indice: IndiceEstrutura,
  lotacao: { sigla?: string | null; nome?: string | null } | null | undefined,
): CasamentoAproximado | null {
  const nomeCru = lotacao?.nome ?? "";
  const tokens = tokenizarNome(nomeCru);
  if (!tokens.length) return null;
  const expandidos = expandirSiglasNoNome(indice, nomeCru, tokens);
  if (expandidos) {
    const exatos = indice.porNomeNormalizado.get(expandidos.join(" "));
    if (exatos?.length) return { metodo: "sigla-extenso", orgaos: exatos };
  }
  for (const candidato of expandidos ? [tokens, expandidos] : [tokens]) {
    const orgaos = melhoresPorPrefixo(indice, candidato);
    if (orgaos.length) return { metodo: "prefixo", orgaos };
  }
  return null;
}

/** Heurística: a lotação é de estrutura PARLAMENTAR (gabinete/liderança/escritório/bloco)? */
export function ehLotacaoParlamentar(nome: string | null | undefined): boolean {
  return /gabinete|lideran|bloco|escrit[oó]rio|banca|suplente/i.test(nome ?? "");
}

/** Vintage do snapshot (ISO-8601 da extração no portal) — para proveniência/aviso. */
export const ESTRUTURA_VINTAGE = ESTRUTURA_ORGANIZACIONAL.extraidoEm;
export const ESTRUTURA_FONTE_URL = ESTRUTURA_ORGANIZACIONAL.fonteUrl;
