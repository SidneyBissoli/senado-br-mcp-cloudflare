/**
 * Disjuntor: para o crawl quando o PORTAL caiu, em vez de moer item a item.
 *
 * MEDIDO em 20-21/09/2026. O e-Cidadania ficou fora por ~17 h e quatro runs de
 * ingestão morreram no teto de 200 min do job, com o rótulo `cancelled` — que é
 * o pior possível, porque parece decisão humana e não defeito.
 *
 * A aritmética do desperdício: `getText` gasta o orçamento inteiro de retry em
 * CADA item (5 tentativas x 30 s + backoff ~= 158 s). Com o portal fora, um item
 * custa 2,6 min em vez de ~1,9 s. O lote de `ideias-detalhe` tem 2000 itens:
 * ~87 HORAS contra um job de 200 minutos. No run de 17:42 saíram 75 gaps e
 * ZERO acertos em 3h18 — o crawl tratou 75 quedas consecutivas do portal como
 * 75 itens individualmente problemáticos, e nunca desconfiou.
 *
 * O que ele NÃO faz, de propósito:
 *   - não conta gap ISOLADO. Um id que sumiu do portal é gap legítimo e a
 *     contagem zera no acerto seguinte; só falha SEGUIDA, sem nenhum acerto
 *     entre elas, é sintoma de portal fora.
 *   - não conta recusa da fonte. 404 e afins vêm com `retryable = false` e não
 *     entram: isso é o portal respondendo, não o portal calado.
 *
 * Calibragem: no dia saudável foram ZERO gaps em 2000 itens; no dia ruim, 75
 * seguidas sem um acerto. Qualquer corte entre 5 e 20 separa os dois sem
 * ambiguidade — o default é 10, e `INGEST_BREAKER_SEGUIDAS` ajusta.
 *
 * O desfecho é falha RÁPIDA e explícita: o run sai com erro em minutos, dizendo
 * que o portal está fora, em vez de ocupar a caixa dedicada por 200 min e sair
 * mudo. Quem publica isso no painel é o monitor de fontes, pelo item de CI.
 */

import { HttpError } from "./http.js";

const LIMITE_PADRAO = Number(process.env.INGEST_BREAKER_SEGUIDAS) || 10;

export class PortalForaError extends Error {
  constructor(
    readonly seguidas: number,
    readonly onde: string,
    readonly ultimoMotivo: string,
  ) {
    super(
      `portal fora: ${seguidas} falhas de transporte SEGUIDAS, sem nenhum acerto entre elas ` +
        `(última em ${onde}: ${ultimoMotivo}). Abortando em vez de moer o lote inteiro — ` +
        `cada item custa o orçamento de retry, e com o portal calado o job estouraria o teto de tempo.`,
    );
    this.name = "PortalForaError";
  }
}

/**
 * Falha de TRANSPORTE — o portal não respondeu (timeout, conexão recusada,
 * reset, 429/5xx). É a classe que o disjuntor conta.
 *
 * `HttpError.retryable` já carrega essa distinção: `http.ts` marca `true` para
 * falha de curl e para 429/5xx, e `false` para 4xx, que é resposta da fonte.
 * O casamento por mensagem cobre erro que não veio embrulhado em HttpError.
 */
export function ehFalhaDeTransporte(e: unknown): boolean {
  if (e instanceof HttpError) return e.retryable;
  const m = e instanceof Error ? e.message : String(e);
  return /curl failed|curl: \(\d+\)|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|fetch failed|network/i.test(
    m,
  );
}

export interface Disjuntor {
  /** Chamar a cada item obtido com sucesso: zera a contagem. */
  sucesso(): void;
  /** Chamar a cada item que falhou. Lança PortalForaError quando o corte é atingido. */
  falha(e: unknown, onde: string): void;
  /** Falhas de transporte seguidas até agora (para log/teste). */
  readonly seguidas: number;
}

export function criarDisjuntor(limite: number = LIMITE_PADRAO): Disjuntor {
  let seguidas = 0;
  return {
    sucesso() {
      seguidas = 0;
    },
    falha(e: unknown, onde: string) {
      if (!ehFalhaDeTransporte(e)) {
        // Recusa da fonte não é portal fora; e um gap legítimo no meio de
        // acertos não deve empurrar a contagem para o corte.
        seguidas = 0;
        return;
      }
      seguidas++;
      if (seguidas >= limite) {
        throw new PortalForaError(seguidas, onde, e instanceof Error ? e.message : String(e));
      }
    },
    get seguidas() {
      return seguidas;
    },
  };
}
