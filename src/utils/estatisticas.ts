/**
 * Compute summary statistics + ranking over a numeric field of a record set.
 *
 * Sibling of `computarPlacar` (src/utils/placar.ts). The problem it solves: the
 * administrative datasets (payroll, CEAPS, contracts…) are fetched WHOLE into the
 * Worker, then filtered/paginated — so the model only ever sees a slice and cannot
 * answer analytic questions ("quem teve a MAIOR remuneração?", "qual a média?").
 * This helper crunches the full set ON THE SERVER, before truncation, and returns a
 * compact block (~15 numbers) plus the extreme records — deterministic (the Worker
 * computes, not the LLM) and cheap (data already hot in cache).
 *
 * Generic and reusable: it takes accessor functions, not field names, because the
 * canonical value is often computed (e.g. payroll `bruto` = sum of 7 columns) and
 * arrives as pt-BR strings that need parsing. The caller supplies:
 *   - `valorDe`      how to read the numeric value from a record;
 *   - `identificar`  which identifier fields to carry into argMax/top (nome, cargo…);
 *   - `desempate`    a stable tie-break key for argMax/argMin (e.g. sequencial);
 *   - `agruparPor`   optional group key → statistics per group.
 *
 * Conventions locked with the maintainer (2026-07-07):
 *   - percentis: linear interpolation, type 7 (== numpy.percentile / Excel INC);
 *   - desvioPadrao: POPULATION std (÷n) — the datasets are censuses, not samples;
 *   - argMax/argMin tie-break: smallest `desempate` value wins (stable, deterministic).
 *
 * Numbers are returned at full precision; rounding for display is the caller's job.
 */

export interface Percentis {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
}

/**
 * One percentile, self-documenting for the reader: the numeric `valor` PLUS a
 * plain-language `rotulo`. Percentile output used to be a bare `{p25..p99}` block,
 * and the model would parrot the shorthand key ("p99") straight into its prose —
 * meaningless to anyone who didn't help build the server. The `rotulo` spells the
 * meaning out so the reader never sees "p99". See `rotularPercentis`.
 */
export interface PercentilRotulado {
  percentil: number;
  valor: number;
  rotulo: string;
}

/** An identified extreme/ranked record: the chosen identifier fields + its `valor`. */
export type Entrada = Record<string, unknown> & { valor: number };

export interface Estatisticas {
  n: number;
  soma: number;
  minimo: number;
  maximo: number;
  media: number;
  mediana: number;
  desvioPadrao: number;
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

/** Precomputed value/tie-break pair, so accessors run once per record, not per comparison. */
interface Par {
  r: Registro;
  v: number;
  d: number;
}

const DEFAULT_MAX_GRUPOS = 50;

/** Percentile by linear interpolation (type 7 / numpy / Excel PERCENTILE.INC). `q` in [0,1]. */
export function percentil(ascendente: number[], q: number): number {
  const n = ascendente.length;
  if (n === 0) return 0;
  if (n === 1) return ascendente[0];
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const frac = h - lo;
  if (lo + 1 >= n) return ascendente[n - 1];
  return ascendente[lo] + frac * (ascendente[lo + 1] - ascendente[lo]);
}

function entradaDe(par: Par, identificar?: (r: Registro) => Registro): Entrada {
  const base = identificar ? identificar(par.r) : par.r;
  return { ...base, valor: par.v };
}

const ESTATISTICAS_VAZIAS: Estatisticas = {
  n: 0, soma: 0, minimo: 0, maximo: 0, media: 0, mediana: 0, desvioPadrao: 0,
  percentis: { p25: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0 },
  argMax: null, argMin: null, top: [], bottom: [],
};

function calcular(
  pares: Par[],
  topN: number,
  identificar?: (r: Registro) => Registro,
): Estatisticas {
  const n = pares.length;
  if (n === 0) return { ...ESTATISTICAS_VAZIAS, percentis: { ...ESTATISTICAS_VAZIAS.percentis }, top: [], bottom: [] };

  let soma = 0;
  let argMax = pares[0];
  let argMin = pares[0];
  for (const p of pares) {
    soma += p.v;
    // Tie-break: on equal value, the smaller `d` wins (stable, deterministic).
    if (p.v > argMax.v || (p.v === argMax.v && p.d < argMax.d)) argMax = p;
    if (p.v < argMin.v || (p.v === argMin.v && p.d < argMin.d)) argMin = p;
  }
  const media = soma / n;

  let somaQuad = 0;
  for (const p of pares) {
    const dv = p.v - media;
    somaQuad += dv * dv;
  }
  const desvioPadrao = Math.sqrt(somaQuad / n); // population std (census, not sample)

  const asc = pares.map((p) => p.v).sort((a, b) => a - b);

  // Ranking: sort by value (desc for top, asc for bottom), tie-break by `d` asc for stability.
  let top: Entrada[] = [];
  let bottom: Entrada[] = [];
  if (topN > 0) {
    const porValorDesc = [...pares].sort((a, b) => b.v - a.v || a.d - b.d);
    const porValorAsc = [...pares].sort((a, b) => a.v - b.v || a.d - b.d);
    top = porValorDesc.slice(0, topN).map((p) => entradaDe(p, identificar));
    bottom = porValorAsc.slice(0, topN).map((p) => entradaDe(p, identificar));
  }

  return {
    n,
    soma,
    minimo: asc[0],
    maximo: asc[n - 1],
    media,
    mediana: percentil(asc, 0.5),
    desvioPadrao,
    percentis: {
      p25: percentil(asc, 0.25),
      p50: percentil(asc, 0.5),
      p75: percentil(asc, 0.75),
      p90: percentil(asc, 0.9),
      p95: percentil(asc, 0.95),
      p99: percentil(asc, 0.99),
    },
    argMax: entradaDe(argMax, identificar),
    argMin: entradaDe(argMin, identificar),
    top,
    bottom,
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
  const { agruparPor, topN = 0, maxGrupos = DEFAULT_MAX_GRUPOS, identificar, desempate } = opcoes;
  const pares: Par[] = registros.map((r) => ({ r, v: valorDe(r), d: desempate ? desempate(r) : 0 }));

  if (!agruparPor) return calcular(pares, topN, identificar);

  const porGrupo = new Map<string, Par[]>();
  for (const p of pares) {
    const k = agruparPor(p.r);
    const bucket = porGrupo.get(k);
    if (bucket) bucket.push(p);
    else porGrupo.set(k, [p]);
  }

  const todos: GrupoEstatisticas[] = Array.from(porGrupo.entries())
    .map(([grupo, ps]) => ({ grupo, ...calcular(ps, topN, identificar) }))
    .sort((a, b) => b.soma - a.soma); // most-total group first

  const grupos = todos.slice(0, maxGrupos);
  return {
    totalGrupos: todos.length,
    ...(todos.length > maxGrupos
      ? { aviso: `Exibindo ${maxGrupos} de ${todos.length} grupos (ordenados por soma decrescente). Refine o filtro ou reduza a granularidade.` }
      : {}),
    grupos,
  };
}

// ─── Display layer ───────────────────────────────────────────────────────────
// The generic helper above returns raw numbers (its job). These shared helpers
// shape the block for the tool RESPONSE: 2-decimal money rounding + a percentile
// list whose `rotulo` reads as plain Portuguese, so the model never surfaces
// internal shorthand ("p99") to the user. All five statistics tools go through
// them, so the wording stays identical across the whole surface.

/** 2-decimal money rounding (all statistics fields are monetary — BRL). */
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Format a number as pt-BR currency deterministically ("R$ 1.234,56") — no
 * `Intl` dependency, so tests are stable and it never depends on the runtime's
 * ICU locale data.
 */
export function formatarBRL(n: number): string {
  const negativo = n < 0;
  const [inteiro, decimais] = Math.abs(n).toFixed(2).split(".");
  const agrupado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}R$ ${agrupado},${decimais}`;
}

const ORDEM_PERCENTIS: ReadonlyArray<keyof Percentis> = ["p25", "p50", "p75", "p90", "p95", "p99"];

/**
 * Turn the raw `{p25..p99}` block into a self-documenting labeled list. The
 * `rotulo` states the meaning in plain language (percentile = the value at or
 * below which that share of the distribution falls, type-7). p50 is flagged as
 * the median. `formatarValor` defaults to BRL but is injectable for other units.
 */
export function rotularPercentis(
  p: Percentis,
  formatarValor: (n: number) => string = formatarBRL,
): PercentilRotulado[] {
  return ORDEM_PERCENTIS.map((chave) => {
    const percentil = Number(chave.slice(1));
    const valor = r2(p[chave]);
    const alvo = formatarValor(valor);
    const rotulo =
      percentil === 50
        ? `mediana — metade dos valores é igual ou inferior a ${alvo}`
        : `${percentil}% dos valores são iguais ou inferiores a ${alvo}`;
    return { percentil, valor, rotulo };
  });
}

/**
 * Round a statistics block to 2 decimals for display and emit `percentis` as the
 * self-documenting labeled list (not bare p25..p99 keys). Shared by all five
 * statistics tools — previously each duplicated this function byte-for-byte.
 */
export function arredondarEstatisticas(
  e: Estatisticas,
  formatarValor: (n: number) => string = formatarBRL,
) {
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
