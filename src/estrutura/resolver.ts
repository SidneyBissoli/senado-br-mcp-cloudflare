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
import { COMPLEMENTO_CONGRESSO } from "./complemento-cn.js";
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

/** Órgãos servidos por padrão: o snapshot do portal + o complemento curado do Congresso Nacional. */
const ORGAOS_PADRAO: OrgaoNode[] = [...ESTRUTURA_ORGANIZACIONAL.orgaos, ...COMPLEMENTO_CONGRESSO];

/** Constrói o índice a partir do snapshot+complemento (ou de uma lista passada — para teste). */
export function construirIndice(orgaos: OrgaoNode[] = ORGAOS_PADRAO): IndiceEstrutura {
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
  metodo: "sigla-extenso" | "prefixo" | "sufixo-ancestral";
  orgaos: OrgaoNode[];
}

/** Especificidade mínima (chars do nome normalizado) p/ casar por prefixo com abreviações. */
const MIN_CHARS_PREFIXO = 14;
/** Especificidade mínima quando a lotação é prefixo LITERAL do nome do nó (truncamento puro). */
const MIN_CHARS_TRUNCAMENTO = 10;

const ehNumero = (t: string) => /^\d+$/.test(t);

/**
 * Um token da lotação casa com um token do nó? Igual, prefixo (abreviação/truncamento) ou
 * plural; números casam pelo VALOR ("1" ↔ "01" — e "1" nunca casa "02"), pois o dígito é o que
 * distingue "Escritório de Apoio Nº 01" do "Nº 02" do mesmo senador.
 */
function tokenCasa(lot: string, no: string): boolean {
  if (ehNumero(lot) || ehNumero(no)) return ehNumero(lot) && ehNumero(no) && Number(lot) === Number(no);
  return lot === no || no.startsWith(lot) || lot === no + "s";
}

/** Resultado do alinhamento token a token (null = não casa). */
export interface AlinhamentoTokens {
  /** Soma de caracteres da lotação casados — a matéria-prima da pontuação. */
  chars: number;
  /** Tokens do NÓ saltados no alinhamento (o cadastro omite palavras: "em", "sobre", "Controle"…). */
  skips: number;
  /** A lotação cobriu todos os tokens do nó sem salto (casamento pleno). */
  cobreTudo: boolean;
}

/**
 * Alinha tokens da lotação contra tokens do nó, em ordem: cada token útil da lotação deve ser
 * igual, prefixo (≥2 chars) ou plural de UM token do nó, podendo SALTAR tokens do nó no meio
 * (o cadastro omite preposições fora da lista de stopwords e até palavras inteiras: "Serv. de
 * C. de Qual…" ↔ "Serviço de Controle de Qualidade…"). O primeiro token é ÂNCORA — não salta —
 * e tokens de 1 caractere da lotação ("p/", "C.") são ignorados (não carregam sinal). A
 * lotação pode terminar antes do nó (nome truncado). Saltos são penalizados na pontuação de
 * `melhoresPorPrefixo`, então um casamento posicional sempre vence um casamento com salto.
 */
export function casamentoPorTokens(lot: string[], no: string[]): AlinhamentoTokens | null {
  // Tokens de 1 char não carregam sinal ("p/", "C.") — EXCETO dígitos ("Escritório de Apoio 2").
  const uteis = lot.filter((t) => t.length >= 2 || ehNumero(t));
  if (!uteis.length || uteis.length > no.length) return null;
  let j = 0;
  let chars = 0;
  let skips = 0;
  for (let i = 0; i < uteis.length; i++) {
    // Reserva 1 token do nó para cada token restante da lotação; o 1º token não salta.
    const limite = i === 0 ? 1 : no.length - (uteis.length - i - 1);
    let achou = -1;
    for (let k = j; k < limite; k++) {
      if (tokenCasa(uteis[i], no[k])) { achou = k; break; }
    }
    if (achou < 0) return null;
    skips += achou - j;
    chars += uteis[i].length;
    j = achou + 1;
  }
  return { chars, skips, cobreTudo: skips === 0 && uteis.length === no.length };
}

/**
 * Melhores candidatos por prefixo de token (empatados na maior pontuação), com as guardas.
 * `apenas` restringe a busca a um subconjunto de códigos (ex.: a subárvore de um ancestral) —
 * a restrição precisa acontecer ANTES da pontuação, senão um candidato de fora "rouba" o topo.
 */
function melhoresPorPrefixo(indice: IndiceEstrutura, lotTokens: string[], apenas?: Set<number>): OrgaoNode[] {
  if (lotTokens.length < 2) return [];
  const juntado = lotTokens.join(" ");
  if (juntado.length < MIN_CHARS_TRUNCAMENTO) return [];
  let melhorPontuacao = -Infinity;
  let melhores: OrgaoNode[] = [];
  for (const { orgao, tokens, nomeNormalizado } of indice.nosCasamento) {
    if (apenas && !apenas.has(orgao.cod)) continue;
    const m = casamentoPorTokens(lotTokens, tokens);
    if (!m) continue;
    // Nomes curtos só casam como truncamento literal (prefixo de string do nome do nó).
    if (juntado.length < MIN_CHARS_PREFIXO && !nomeNormalizado.startsWith(juntado)) continue;
    // Cobrir todos os tokens do nó desempata sobre casar só o começo de um nome mais longo;
    // saltos penalizam: um alinhamento posicional SEMPRE vence um com salto (chars é igual
    // entre candidatos — é a soma dos tokens da lotação —, então o desempate é salto/cobertura).
    const pontuacao = m.chars * 4 + (m.cobreTudo ? 2 : 0) - Math.min(m.skips, 3);
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
 * Abreviações INSTITUCIONAIS que o cadastro usa mas não são sigla de órgão da árvore —
 * "Coordenação de Sessões e Colegiados do CN" ↔ "…do Congresso Nacional".
 */
const EXPANSOES_INSTITUCIONAIS = new Map<string, string[]>([
  ["CN", ["congresso", "nacional"]],
  ["SF", ["senado", "federal"]],
  // Sigla de CONCEITO (não de órgão): a árvore escreve por extenso, o cadastro abrevia.
  ["TI", ["tecnologia", "informacao"]],
]);

/**
 * Grafias irregulares do cadastro — contrações que NÃO são prefixo da palavra plena (exceção
 * à regra geral do P1: toda abreviação real é prefixo) e erros de digitação conhecidos.
 * Aplicadas só do lado da lotação, antes do alinhamento.
 */
const GRAFIAS_IRREGULARES_CADASTRO = new Map<string, string>([
  ["prc", "processo"],
  ["admnistrativo", "administrativo"], // typo do cadastro ("Núcleo Admnistrativo da SECOM")
]);

/**
 * Substitui tokens que aparecem em CAIXA-ALTA no nome cru e são sigla conhecida pelo nome por
 * extenso do órgão correspondente (ou abreviação institucional pela sua expansão). Retorna
 * `null` se nada foi substituído (evita re-casamentos idênticos). A exigência de caixa-alta no
 * texto original evita expandir palavras comuns que coincidam com alguma sigla.
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
    const institucional = palavrasCaixaAlta.has(maiuscula) ? EXPANSOES_INSTITUCIONAIS.get(maiuscula) : undefined;
    if (orgao) {
      out.push(...tokenizarNome(orgao.nome));
      mudou = true;
    } else if (institucional) {
      out.push(...institucional);
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
  const tokens = tokenizarNome(nomeCru).map((t) => GRAFIAS_IRREGULARES_CADASTRO.get(t) ?? t);
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

/**
 * Aliases sigla→órgão derivados do PRÓPRIO cadastro de servidores. O portal não publica sigla
 * para vários nós (Diretorias-Executivas, coordenações profundas, nós sintéticos), mas o cadastro
 * expõe o par `{ sigla, nome }` na lotação de quem trabalha DIRETAMENTE na unidade — ex.: alguém
 * lotado em "Diretoria-Executiva de Gestão" carrega a sigla DIREG. Casa o nome com a árvore
 * (exato; senão aproximado inequívoco) e associa a sigla ao nó. Siglas já conhecidas pela árvore
 * e associações conflitantes (mesma sigla → nós diferentes) são descartadas — nunca chuta.
 */
export function aliasesDeSiglasDoCadastro(
  indice: IndiceEstrutura,
  lotacoes: Iterable<{ sigla?: string | null; nome?: string | null } | null | undefined>,
): Map<string, OrgaoNode> {
  const out = new Map<string, OrgaoNode>();
  const conflitantes = new Set<string>();
  const vistas = new Set<string>();
  for (const lot of lotacoes) {
    const sigla = (lot?.sigla ?? "").trim().toUpperCase();
    const nome = (lot?.nome ?? "").trim();
    if (!sigla || !nome || indice.porSigla.has(sigla)) continue;
    const chave = `${sigla}|${nome}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    let orgao: OrgaoNode | null = null;
    const exatos = indice.porNomeNormalizado.get(normalizarNome(nome));
    if (exatos?.length === 1) {
      orgao = exatos[0];
    } else if (!exatos?.length) {
      const c = casarLotacaoAproximado(indice, lot);
      if (c?.orgaos.length === 1) orgao = c.orgaos[0];
    }
    if (!orgao) continue;
    const previo = out.get(sigla);
    if (previo && previo.cod !== orgao.cod) conflitantes.add(sigla);
    else out.set(sigla, orgao);
  }
  for (const s of conflitantes) out.delete(s);
  return out;
}

/** Sufixo "d[a/e/o] SIGLA" no fim do nome CRU da lotação (sigla em caixa-alta, ≥2 chars). */
const RE_SUFIXO_SIGLA = /\s+d[aeo]s?\s+([A-ZÀ-Ü][A-ZÀ-Ü0-9]+\.?)\s*$/;

/**
 * Camada sufixo-ancestral: o cadastro qualifica unidades de nome genérico com a sigla do órgão
 * a que pertencem — "Assessoria Técnica da DIREG", "Coordenação-Geral da SCOM" — enquanto a
 * árvore tem o nó batizado só com o nome genérico ("Assessoria Técnica", filho da
 * Diretoria-Executiva de Gestão). O casamento por prefixo NÃO cobre isso por desenho (a lotação
 * tem MAIS tokens que o nó). Aqui: destaca a sigla final, resolve-a num órgão (árvore ou
 * `aliases` do cadastro), remove o sufixo e casa o resto — exato, senão por prefixo — APENAS
 * dentro da subárvore desse órgão (é a desambiguação: há 10 "Assessoria Técnica" na árvore).
 */
export function casarLotacaoPorSufixoAncestral(
  indice: IndiceEstrutura,
  lotacao: { sigla?: string | null; nome?: string | null } | null | undefined,
  aliases?: Map<string, OrgaoNode>,
): CasamentoAproximado | null {
  const nomeCru = (lotacao?.nome ?? "").trim();
  const m = nomeCru.match(RE_SUFIXO_SIGLA);
  if (!m) return null;
  const sigla = m[1].replace(/\.$/, "").toUpperCase();
  const ancestral = indice.porSigla.get(sigla) ?? aliases?.get(sigla);
  if (!ancestral) return null;
  const restoTokens = tokenizarNome(nomeCru.slice(0, m.index));
  if (restoTokens.length < 2) return null; // nomes de 1 token são genéricos demais p/ esta camada
  const dentro = new Set(subarvore(indice, ancestral.cod).map((o) => o.cod));
  dentro.delete(ancestral.cod); // o alvo é uma unidade SOB o ancestral, não ele próprio
  const exatos = (indice.porNomeNormalizado.get(restoTokens.join(" ")) ?? []).filter((o) => dentro.has(o.cod));
  const orgaos = exatos.length ? exatos : melhoresPorPrefixo(indice, restoTokens, dentro);
  return orgaos.length ? { metodo: "sufixo-ancestral", orgaos } : null;
}

/**
 * Lotações de REGISTRO do cadastro, que não são órgãos do organograma: "Servidores em
 * Trânsito - SF" é unidade de passagem (quem está momentaneamente sem exercício em unidade,
 * aguardando lotação); "Servidores Afastados - SF" é o registro de quem está fora do exercício
 * no Senado (cedido a outro órgão, licenciado etc.) — coisas distintas, nenhuma é "passagem"
 * no caso dos afastados. A lotação do servidor é essa mesma; o que não existe é um nó
 * correspondente na árvore publicada, então ficam fora de qualquer casamento e ganham rótulo
 * próprio na resposta.
 */
export function ehPseudoUnidadeSituacional(nome: string | null | undefined): boolean {
  return /^servidores\s+(afastados|em\s+tr[aâ]nsito)\b/i.test((nome ?? "").trim());
}

/** Heurística: a lotação é de estrutura PARLAMENTAR (gabinete/liderança/escritório/bloco)? */
export function ehLotacaoParlamentar(nome: string | null | undefined): boolean {
  return /gabinete|lideran|bloco|escrit[oó]rio|banca|suplente/i.test(nome ?? "");
}

/** Vintage do snapshot (ISO-8601 da extração no portal) — para proveniência/aviso. */
export const ESTRUTURA_VINTAGE = ESTRUTURA_ORGANIZACIONAL.extraidoEm;
export const ESTRUTURA_FONTE_URL = ESTRUTURA_ORGANIZACIONAL.fonteUrl;
