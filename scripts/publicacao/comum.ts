/**
 * Peças comuns das tabelas publicadas (camada 3): como ler "o valor atual" na camada 2.
 *
 * Leitura = instante. Uma observação vale na leitura R quando `vistoPrimeiro ≤ R ≤ vistoUltimo`: a
 * fusão da camada 2 só junta leituras SEGUIDAS com o mesmo valor, e a ausência fecha a linha, então
 * o intervalo nunca cobre uma leitura em que o valor faltou.
 *
 * Última leitura ABERTA de uma série: o maior `vistoUltimo` de um campo-marcador que toda leitura
 * aberta emite e a recusada (erroLeitura) ou o 404/410 não emitem.
 */

import type { Observacao } from "../observacoes/fundir.js";

export const contem = (o: Observacao, r: string): boolean => o.vistoPrimeiro <= r && r <= o.vistoUltimo;

export const json = <T>(s: string | null): T | null => (s === null ? null : (JSON.parse(s) as T));

export const int = (s: string | number | null | undefined): number | null => {
  if (s === null || s === undefined || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export const txt = (x: unknown): string | null => (x === null || x === undefined || x === "" ? null : String(x));

export function compararIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

export function agruparPorId(obs: readonly Observacao[], entidade: string): Map<string, Observacao[]> {
  const m = new Map<string, Observacao[]>();
  for (const o of obs) {
    if (o.entidade !== entidade) continue;
    const l = m.get(o.entityId);
    if (l) l.push(o);
    else m.set(o.entityId, [o]);
  }
  return m;
}

/** Instante da última leitura aberta das séries aceitas por `fonte`, pelo campo-marcador; e a série. */
export function ultimaLeitura(os: readonly Observacao[], fonte: (f: string) => boolean, marcador: string): { r: string; fonte: string } | null {
  let melhor: Observacao | null = null;
  for (const o of os) {
    if (o.campo !== marcador || !fonte(o.fonte)) continue;
    if (!melhor || o.vistoUltimo > melhor.vistoUltimo || (o.vistoUltimo === melhor.vistoUltimo && o.indiceUltimo > melhor.indiceUltimo)) melhor = o;
  }
  return melhor ? { r: melhor.vistoUltimo, fonte: melhor.fonte } : null;
}

/** As observações de UMA série (fonte exata) que valem na leitura R, com acesso por campo. */
export function naLeitura(os: readonly Observacao[], fonte: string, r: string): { todas: Observacao[]; v: (campo: string) => string | null; varios: (campo: string) => string[] } {
  const todas = os.filter((o) => o.fonte === fonte && contem(o, r));
  return {
    todas,
    v: (campo) => todas.find((o) => o.campo === campo)?.valor ?? null,
    varios: (campo) => todas.filter((o) => o.campo === campo).flatMap((o) => (o.valor === null ? [] : [o.valor])),
  };
}

/** Percentual com uma casa decimal (decisão 5 da fase D); null sem votos (0/0 não é 0%). */
export function percentual(parte: number | null, total: number | null): number | null {
  if (parte === null || total === null || total === 0) return null;
  return Math.round((parte / total) * 1000) / 10;
}
