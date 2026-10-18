/**
 * Regra da classe dos escritores do corpus e-Cidadania: LEITURA VAZIA NUNCA APAGA VALOR GUARDADO.
 *
 * Origem (17/10/2026): o portal redesenhou a página de detalhe da ideia em 12/10 e o leitor antigo
 * passou a devolver `autorUf`/`dataPublicacao` null em páginas lidas com sucesso. O backfill de
 * detalhe gravava `detail ? detail.x : prev.x` — leitura bem-sucedida com campo vazio substituía o
 * guardado — e apagou 21.265 UFs e 21.535 datas em cinco dias, com o workflow VERDE. Medido no
 * `ecidadania_history`: de 01/09 a 12/10, zero campos preenchidos viraram null; de 13/10 a 17/10,
 * 98–99% dos preenchidos de cada rodada.
 *
 * Duas defesas, as duas aqui:
 *   1. `mesclarCampo` — todo escritor passa cada campo por ela: vazio lido mantém o guardado; apagar
 *      exige `apagarComMotivo(motivo)`, explícito e com motivo que o chamador registra.
 *   2. `vigiarCampos` — a mesclagem esconde a deriva (o valor velho fica), então cada rodada mede, por
 *      campo, quantos valores guardados a leitura desta rodada ainda enxerga. Queda brusca reprova.
 *
 * Puro e sem dependência de Workers: roda no Cron de 2 h (src/) e nos jobs off-Worker (scripts/).
 */

/** Pedido explícito de apagar um campo guardado. Sem motivo não existe. */
export class Apagado {
  readonly motivo: string;
  constructor(motivo: string) {
    if (!motivo.trim()) throw new Error("apagar campo guardado exige motivo");
    this.motivo = motivo;
  }
}

export function apagarComMotivo(motivo: string): Apagado {
  return new Apagado(motivo);
}

/**
 * Vazio = o leitor não achou o campo: null, undefined, string só de espaço, lista vazia, NaN.
 * `0` NÃO é vazio — é contagem lida (apoios, votos, comentários). Quem não leu a contagem devolve null,
 * nunca 0 (ver `lerBrNum`).
 */
export function ehVazio(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "number") return Number.isNaN(v);
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * Valor a gravar para UM campo: o lido, se a leitura trouxe algo; senão o guardado; `null` só quando
 * os dois são vazios ou quando o chamador pede `apagarComMotivo`.
 */
export function mesclarCampo<T>(lido: T | null | undefined | Apagado, guardado: T | null | undefined): T | null {
  if (lido instanceof Apagado) return null;
  if (!ehVazio(lido)) return lido as T;
  if (!ehVazio(guardado)) return guardado as T;
  return null;
}

/**
 * Número no formato brasileiro ("1.234.567") ou null quando não há número para ler. Par do
 * `parseBrNum` (que devolve 0 para ausente/lixo e por isso não serve a escritor do corpus: ausência
 * vira medida, e o 0 inventado sobrescreve a contagem guardada).
 */
export function lerBrNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\./g, "");
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

// ── vigia de taxa de leitura por campo ─────────────────────────────────────────

/**
 * Limiar do vigia, escolhido pela medição de 17/10/2026 no `ecidadania_history` (ideias): no regime
 * são, a retenção foi 100% (0 perdas em ~13 mil versões de 01/09 a 12/10); na quebra, 1–2%
 * (UF 1.984 de 2.017 perdidas no 1º dia). 90% fica longe dos dois; abaixo disso é deriva de forma,
 * não ruído.
 */
export const RETENCAO_MINIMA = 0.9;
/**
 * Com poucos guardados a taxa não diz nada (o splice de 2 h lê ~5 ideias; um id esquisito seria 20%).
 * 50 mantém o vigia mudo ali e ativo nos jobs diários, que leem centenas a milhares.
 */
export const N_MINIMO = 50;

export interface RetencaoCampo {
  campo: string;
  /** Leituras desta rodada cujo valor GUARDADO do campo está preenchido. */
  guardados: number;
  /** Dessas, quantas a leitura também trouxe preenchidas. */
  lidos: number;
  /** lidos / guardados (1 quando não há guardados). */
  retencao: number;
}

export interface VereditoVigia {
  ok: boolean;
  campos: RetencaoCampo[];
  /** Campos reprovados (retenção abaixo do mínimo com n suficiente). */
  quedas: RetencaoCampo[];
}

/**
 * Para cada campo: entre os ids lidos nesta rodada que já tinham o campo preenchido no corpus, que
 * fração a leitura desta rodada ainda trouxe preenchida. Compara a leitura com os MESMOS ids guardados
 * — não com a taxa do acervo inteiro, que muda com a fatia lida.
 *
 * `pares` recebe a LEITURA CRUA (antes da mesclagem): é ela que deriva; o mesclado nunca cairia.
 */
export function vigiarCampos(
  pares: Iterable<{ lido: Record<string, unknown>; guardado: Record<string, unknown> | undefined }>,
  campos: readonly string[],
  opts: { retencaoMinima?: number; nMinimo?: number } = {},
): VereditoVigia {
  const minimo = opts.retencaoMinima ?? RETENCAO_MINIMA;
  const nMin = opts.nMinimo ?? N_MINIMO;
  const cont = new Map(campos.map((c) => [c, { guardados: 0, lidos: 0 }]));
  for (const { lido, guardado } of pares) {
    if (!guardado) continue;
    for (const c of campos) {
      if (ehVazio(guardado[c])) continue;
      const k = cont.get(c)!;
      k.guardados++;
      if (!ehVazio(lido[c])) k.lidos++;
    }
  }
  const resultado = campos.map((campo) => {
    const { guardados, lidos } = cont.get(campo)!;
    return { campo, guardados, lidos, retencao: guardados > 0 ? lidos / guardados : 1 };
  });
  const quedas = resultado.filter((r) => r.guardados >= nMin && r.retencao < minimo);
  return { ok: quedas.length === 0, campos: resultado, quedas };
}

/** Linha de log do veredito: `autorUf 12/2017 (0.6%)`. */
export function descreverVigia(v: VereditoVigia): string {
  return v.campos
    .map((c) => `${c.campo} ${c.lidos}/${c.guardados} (${(c.retencao * 100).toFixed(1)}%)`)
    .join(" · ");
}
