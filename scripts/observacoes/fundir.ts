/**
 * Fase C2 do ROADMAP — a fusão das leituras em observações. Puro: sem rede, sem banco.
 *
 * Regra (decisão 3 do desenho da fase C, 21/11/2026): uma linha por VALOR, não por leitura. Cada
 * SÉRIE é uma entidade lida por uma fonte (`ideias` × id × `detalhe`); a cada leitura da série, um
 * fato que já estava na leitura ANTERIOR da mesma série estende a sua linha (visto por último, número
 * de leituras, última página); um fato que não estava abre uma linha nova; o que sumiu fica fechado
 * onde estava. Valor que vai e volta (A → B → A) dá três linhas. "Quando foi lido" mora no índice da
 * fase B; aqui fica o que mudou e quando.
 *
 * Fato repetido NA MESMA leitura (dois acontecimentos idênticos, por exemplo) conta por ocorrência:
 * a 1ª continua a linha aberta mais antiga daquele valor, a 2ª a seguinte — nada se funde por engano.
 *
 * Incremental = completo. As linhas abertas de cada série são exatamente as que a última leitura
 * tocou (`indiceUltimo` = maior da série), então a cópia anterior basta para continuar; `fundir(
 * fundir([], a), b)` dá o mesmo que `fundir([], a ++ b)` (teste). A única condição é a ordem: cada
 * leitura nova de uma série precisa vir DEPOIS da última já fundida (id do índice maior); o contrário
 * lança `ForaDeOrdemError` e quem chama refaz do zero.
 */

import type { Fato, Fonte } from "./fatos.js";

/** Uma leitura de UMA série (a página de listagem gera uma por ideia que mostra). */
export interface Leitura {
  /** Id da linha no `ecidadania_arquivo_indice`. */
  indice: number;
  /** ISO UTC da resposta. */
  instante: string;
  sha256: string;
  entidade: string;
  entityId: string;
  fonte: Fonte;
  fatos: Fato[];
}

/** Uma linha da camada 2. */
export interface Observacao {
  entidade: string;
  entityId: string;
  fonte: Fonte;
  campo: string;
  valor: string | null;
  vistoPrimeiro: string;
  vistoUltimo: string;
  /** Quantas leituras seguidas da série mostraram este valor. */
  leituras: number;
  shaPrimeiro: string;
  shaUltimo: string;
  indicePrimeiro: number;
  indiceUltimo: number;
}

export class ForaDeOrdemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForaDeOrdemError";
  }
}

const SEP = "\u0000";
const chaveDaSerie = (o: { entidade: string; entityId: string; fonte: Fonte }) => `${o.entidade}${SEP}${o.entityId}${SEP}${o.fonte}`;
// `null` e a string "null" são valores diferentes: o prefixo separa os dois.
const chaveDoFato = (campo: string, valor: string | null) => `${campo}${SEP}${valor === null ? "0" : `1${valor}`}`;

interface Serie {
  ultimoIndice: number;
  /** Instante da última leitura fundida ("" = nenhuma). */
  ultimoInstante: string;
  /** Linhas abertas por fato, da mais antiga para a mais nova (uma por ocorrência). */
  abertas: Map<string, Observacao[]>;
}

/** Estado das séries a partir das observações já fundidas (a cópia anterior). */
function estadoDe(obs: Observacao[]): Map<string, Serie> {
  const ultimo = new Map<string, number>();
  for (const o of obs) {
    const k = chaveDaSerie(o);
    ultimo.set(k, Math.max(ultimo.get(k) ?? -1, o.indiceUltimo));
  }
  const series = new Map<string, Serie>();
  for (const [k, ultimoIndice] of ultimo) series.set(k, { ultimoIndice, ultimoInstante: "", abertas: new Map() });
  for (const o of obs) {
    const s = series.get(chaveDaSerie(o))!;
    if (o.indiceUltimo !== s.ultimoIndice) continue;
    s.ultimoInstante = o.vistoUltimo;
    const kf = chaveDoFato(o.campo, o.valor);
    const lista = s.abertas.get(kf) ?? [];
    lista.push(o);
    s.abertas.set(kf, lista);
  }
  for (const s of series.values()) for (const lista of s.abertas.values()) lista.sort((a, b) => a.indicePrimeiro - b.indicePrimeiro);
  return series;
}

/**
 * Funde `novas` sobre `anteriores` e devolve TODAS as observações, em ordem determinística. Não muda
 * os objetos recebidos.
 */
export function fundir(anteriores: readonly Observacao[], novas: readonly Leitura[]): Observacao[] {
  const todas = anteriores.map((o) => ({ ...o }));
  const series = estadoDe(todas);
  const ordenadas = [...novas].sort((a, b) => a.indice - b.indice);
  for (const l of ordenadas) {
    const ks = chaveDaSerie(l);
    const s = series.get(ks) ?? { ultimoIndice: -1, ultimoInstante: "", abertas: new Map() };
    if (l.indice <= s.ultimoIndice) {
      throw new ForaDeOrdemError(
        `leitura ${l.indice} de ${l.entidade}/${l.entityId}/${l.fonte} não vem depois da última já fundida (${s.ultimoIndice})`,
      );
    }
    // Instantes ISO UTC do mesmo formato: comparar como texto = comparar no tempo.
    if (l.instante < s.ultimoInstante) {
      throw new ForaDeOrdemError(
        `leitura ${l.indice} de ${l.entidade}/${l.entityId}/${l.fonte} (${l.instante}) é anterior à leitura ${s.ultimoIndice} (${s.ultimoInstante})`,
      );
    }
    const novasAbertas = new Map<string, Observacao[]>();
    const ocorrencia = new Map<string, number>();
    for (const f of l.fatos) {
      const kf = chaveDoFato(f.campo, f.valor);
      const n = ocorrencia.get(kf) ?? 0;
      ocorrencia.set(kf, n + 1);
      const anterior = s.abertas.get(kf)?.[n];
      let o: Observacao;
      if (anterior) {
        o = anterior;
        o.vistoUltimo = l.instante;
        o.shaUltimo = l.sha256;
        o.indiceUltimo = l.indice;
        o.leituras++;
      } else {
        o = {
          entidade: l.entidade, entityId: l.entityId, fonte: l.fonte, campo: f.campo, valor: f.valor,
          vistoPrimeiro: l.instante, vistoUltimo: l.instante, leituras: 1,
          shaPrimeiro: l.sha256, shaUltimo: l.sha256, indicePrimeiro: l.indice, indiceUltimo: l.indice,
        };
        todas.push(o);
      }
      const lista = novasAbertas.get(kf) ?? [];
      lista.push(o);
      novasAbertas.set(kf, lista);
    }
    series.set(ks, { ultimoIndice: l.indice, ultimoInstante: l.instante, abertas: novasAbertas });
  }
  return todas.sort(compararObservacoes);
}

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

/** Id numérico em ordem numérica (ideia 99 antes de 100); outro id em ordem de texto. */
function compararIds(a: string, b: string): number {
  const na = /^\d+$/.test(a);
  const nb = /^\d+$/.test(b);
  if (na && nb) return cmp(a.length, b.length) || cmp(a, b);
  return cmp(a, b);
}

/** entidade → id → fonte → campo → início → valor → fim. */
export function compararObservacoes(a: Observacao, b: Observacao): number {
  return (
    cmp(a.entidade, b.entidade) ||
    compararIds(a.entityId, b.entityId) ||
    cmp(a.fonte, b.fonte) ||
    cmp(a.campo, b.campo) ||
    a.indicePrimeiro - b.indicePrimeiro ||
    cmp(a.valor ?? "", b.valor ?? "") ||
    cmp(a.valor === null ? 0 : 1, b.valor === null ? 0 : 1) ||
    a.indiceUltimo - b.indiceUltimo
  );
}
