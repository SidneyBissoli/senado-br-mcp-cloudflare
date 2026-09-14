/**
 * pt-BR adapter over `@sbissoli/mcp-stats` — the statistics core that used to live
 * here was generalized into that package (Fase 0 of the portfolio; the package's
 * `ptBR` locale and its senado-compat test reproduce this module's response shape
 * byte-for-byte). This module keeps the senado's original pt-BR API (names, field
 * keys, union return) so the five statistics tools and their tests are untouched:
 *   - `valorDe`/`identificar`/`desempate`/`agruparPor` accessors → package options;
 *   - `Estatisticas`/`EstatisticasPorGrupo` with pt-BR field names (`soma`,
 *     `desvioPadrao`, `Entrada.valor`, `grupos`/`aviso`) mapped from the core's
 *     English-named output;
 *   - display helpers (`arredondarEstatisticas` & co.) shared by all five tools so
 *     the wording stays identical across the whole surface.
 *
 * Conventions (percentile type 7, population std, stable tie-break, groups by
 * descending sum with a capped count + aviso) are locked in the package — see its
 * README before proposing changes.
 */

import {
  computeGroupedStats,
  computeStats,
  formatBRL,
  labeledPercentiles,
  percentile,
  ptBR,
  type Percentiles,
  type StatEntry,
  type SummaryStats,
} from "@sbissoli/mcp-stats";

export type Percentis = Percentiles;

/**
 * One percentile, self-documenting for the reader: the numeric `valor` PLUS a
 * plain-language `rotulo`, so the model never parrots shorthand like "p99" into
 * its prose. See `rotularPercentis`.
 */
export interface PercentilRotulado {
  percentil: number;
  valor: number;
  rotulo: string;
}

/** An identified extreme/ranked record: the chosen identifier fields + its `valor`. */
export type Entrada = Record<string, unknown> & { valor: number };

export interface Estatisticas {
  /** Registros considerados. `0` é o único sinal que nunca mente. */
  n: number;
  /** Soma dos valores. Zero num conjunto vazio é a soma vazia, e é correto. */
  soma: number;
  /**
   * `null` quando `n === 0`. Mínimo, máximo, média, mediana e desvio de um
   * conjunto VAZIO são indefinidos, não zero — ver `arredondarEstatisticas`
   * para o porquê disso ter derrubado uma resposta em produção.
   */
  minimo: number | null;
  maximo: number | null;
  media: number | null;
  mediana: number | null;
  desvioPadrao: number | null;
  percentis: Percentis;
  argMax: Entrada | null;
  argMin: Entrada | null;
  top: Entrada[];
  bottom: Entrada[];
}

export interface GrupoEstatisticas extends Estatisticas {
  grupo: string;
}

export interface EstatisticasPorGrupo {
  totalGrupos: number;
  aviso?: string;
  grupos: GrupoEstatisticas[];
}

type Registro = Record<string, unknown>;

export interface OpcoesEstatisticas {
  /** Group key extractor. When set, returns EstatisticasPorGrupo instead of Estatisticas. */
  agruparPor?: (r: Registro) => string;
  /** Size of the `top`/`bottom` ranking arrays (default 0 = none). */
  topN?: number;
  /** Max groups returned when `agruparPor` is set (default 50); the rest are dropped with `aviso`. */
  maxGrupos?: number;
  /** Fields to carry into argMax/argMin/top/bottom (default: the whole record). */
  identificar?: (r: Registro) => Registro;
  /** Stable tie-break for argMax/argMin/ranking: smaller value wins ties (default: input order). */
  desempate?: (r: Registro) => number;
}

/** Percentile by linear interpolation (type 7 / numpy / Excel PERCENTILE.INC). `q` in [0,1]. */
export const percentil = percentile;

const entradaDe = ({ value, ...resto }: StatEntry): Entrada => ({ ...resto, valor: value });

/** Rename the core's English-named block into the senado's pt-BR response fields. */
function paraPtBR(s: SummaryStats): Estatisticas {
  return {
    n: s.n,
    soma: s.sum,
    minimo: s.min,
    maximo: s.max,
    media: s.mean,
    mediana: s.median,
    desvioPadrao: s.stdDev,
    percentis: s.percentiles,
    argMax: s.argMax ? entradaDe(s.argMax) : null,
    argMin: s.argMin ? entradaDe(s.argMin) : null,
    top: s.top.map(entradaDe),
    bottom: s.bottom.map(entradaDe),
  };
}

/**
 * Compute statistics over `registros`, reading each value via `valorDe`.
 * Without `agruparPor` returns a single `Estatisticas`; with it, one per group.
 */
export function computarEstatisticas(
  registros: Registro[],
  valorDe: (r: Registro) => number,
  opcoes: OpcoesEstatisticas = {},
): Estatisticas | EstatisticasPorGrupo {
  const { agruparPor, topN = 0, maxGrupos, identificar, desempate } = opcoes;
  const base = { topN, identify: identificar, tieBreak: desempate };

  if (!agruparPor) return paraPtBR(computeStats(registros, valorDe, base));

  const g = computeGroupedStats(registros, valorDe, agruparPor, { ...base, maxGroups: maxGrupos });
  return {
    totalGrupos: g.totalGroups,
    ...(g.totalGroups > g.groups.length
      ? { aviso: ptBR.truncationNotice(g.groups.length, g.totalGroups) }
      : {}),
    grupos: g.groups.map(({ group, ...s }) => ({ grupo: group, ...paraPtBR(s) })),
  };
}

// ─── Display layer ───────────────────────────────────────────────────────────
// Shared by all five statistics tools so the wording stays identical across the
// whole surface: 2-decimal money rounding + the package's labeled percentile list
// (pt-BR locale), so the model never surfaces internal shorthand ("p99").

/**
 * 2-decimal money rounding (all statistics fields are monetary — BRL).
 *
 * NULL-SAFE de propósito: `Math.round(null * 100) / 100` é **0**, e sem esta
 * guarda o arredondamento desfazia, no último passo, todo o conserto que o
 * motor comum faz no primeiro — o `null` do conjunto vazio voltaria a ser zero
 * a caminho da resposta.
 *
 * Sobrecarregada porque os dois usos são diferentes e ambos devem continuar
 * exatos: campo de DISTRIBUIÇÃO pode ser nulo (não houve o que resumir), mas o
 * `valor` de um registro extremo nunca é — um extremo só existe quando há
 * registro. Sem a sobrecarga, `arredondarEntradas` passaria a anunciar
 * `number | null` e espalharia um nulo impossível pela superfície.
 */
function r2(n: number): number;
function r2(n: number | null): number | null;
function r2(n: number | null): number | null {
  return n === null ? null : Math.round(n * 100) / 100;
}

/**
 * Format a number as pt-BR currency deterministically ("R$ 1.234,56") — no
 * `Intl` dependency, so tests are stable and it never depends on the runtime's
 * ICU locale data.
 */
export const formatarBRL = formatBRL;

/**
 * Turn the raw `{p25..p99}` block into a self-documenting labeled list (p50 is
 * flagged as the median). `formatarValor` defaults to BRL but is injectable for
 * other units.
 */
export function rotularPercentis(
  p: Percentis,
  formatarValor: (n: number) => string = formatarBRL,
): PercentilRotulado[] {
  return labeledPercentiles(p, { formatValue: formatarValor }) as unknown as PercentilRotulado[];
}

/**
 * Round a statistics block to 2 decimals for display and emit `percentis` as the
 * self-documenting labeled list (not bare p25..p99 keys).
 */
export function arredondarEstatisticas(
  e: Estatisticas,
  formatarValor: (n: number) => string = formatarBRL,
) {
  // SEM REGISTRO NENHUM não existe distribuição, e o bloco não é emitido.
  //
  // Defeito medido em produção em 14/09/2026:
  // `senado_ceaps({ano: 2024, estatisticas: true, nomeSenador: "ZZQX
  // INEXISTENTE"})` — ano válido, filtro que não casa nada — respondia a
  // distribuição inteira em zero e, pior, NARRADA por extenso pela lista de
  // percentis: "mediana — metade dos valores é igual ou inferior a R$ 0,00",
  // "99% dos valores são iguais ou inferiores a R$ 0,00", com bloco de
  // proveniência completo. Um modelo que lê isso afirma ao leitor que a
  // despesa mediana foi R$ 0,00 — afirmação sobre o mundo, saída de uma
  // consulta vazia, com aparência de dado oficial.
  //
  // Trocar a FORMA, e não só zerar os campos, é deliberado: uma fileira de
  // nulos ainda convida quem lê a tratá-los como dado, e o aviso NEGA a
  // leitura errada ("não significa que os valores sejam zero"). Mesma decisão
  // do `formatStats` do motor comum, repetida aqui porque este módulo mantém a
  // própria camada de exibição.
  if (e.n === 0) {
    return { n: 0, aviso: ptBR.noRecordsNotice() };
  }

  return {
    n: e.n,
    soma: r2(e.soma),
    minimo: r2(e.minimo),
    maximo: r2(e.maximo),
    media: r2(e.media),
    mediana: r2(e.mediana),
    desvioPadrao: r2(e.desvioPadrao),
    percentis: rotularPercentis(e.percentis, formatarValor),
  };
}

/** Round the `valor` of each ranked/extreme entry for display. */
export const arredondarEntradas = (entradas: Entrada[]): Entrada[] =>
  entradas.map((x) => ({ ...x, valor: r2(x.valor) }));
