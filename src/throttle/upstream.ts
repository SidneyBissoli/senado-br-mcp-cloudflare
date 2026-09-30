/**
 * Upstream fetch wrapper — a ida à API do Senado com:
 * - Global rate limiting (token bucket) e concurrency limiting (max in-flight),
 *   ANTES da ida, fora do pacote (política deste servidor);
 * - Retry com backoff exponencial limitado + jitter em 429/503/5xx/rede, honrando
 *   `Retry-After` e desistindo cedo se a espera estoura o orçamento;
 * - Orçamento TOTAL de 10 s por ida (`UPSTREAM_TIMEOUT_MS`), esperas incluídas;
 * - Guarda de tamanho da resposta (5 MB; 20 MB para os datasets grandes da ADM);
 * - Contagem de idas, tentativas e anomalias para o bloco `retrieval` da
 *   proveniência (contrato v1.1).
 *
 * Desde a 3.11.0 (2026-09-27) a ida em si — timeout, retry, orçamento, contagem —
 * é feita pelo fetch comum do portfólio, `@sbissoli/mcp-upstream`, no modo
 * `response` (o corpo continua sendo lido AQUI: as guardas de tamanho, o
 * `rotaInexistente(corpo)` dos dois 404, o corpo vazio e o JSON inválido são
 * semântica deste servidor, medida contra a fonte). O pacote CLASSIFICA; este
 * módulo DECIDE. A classe `UpstreamError` local, as mensagens e o `transport`
 * continuam os mesmos: `errorFrom`, `ehReuniaoInexistente`, `classifyError` e o
 * disjuntor do contrato noturno (`scripts/contract/outage.ts`) leem todos eles.
 *
 * POLÍTICA (`UPSTREAM_POLICY`) — medida em 27/09/2026 com `curl` e o User-Agent
 * do portfólio: a API legislativa responde em 0,3–1 s (`/senador/lista/atual`
 * 0,7 s com 129 KB; `/plenario/lista/votacao` de um mês 0,9 s; a busca de matérias
 * por palavra-chave teve UMA cauda fria de 7,4 s e depois 0,4–1 s); a API
 * administrativa entrega 2,7 MB de contratos em 1,5 s e 9 MB de CEAPS em 1,9 s;
 * o texto integral de um discurso sai em 0,35 s. Nenhuma origem chegou perto
 * dos 10 s — o teto existe para a conexão pendurada, não para apressar a fonte.
 *  - teto de UMA tentativa = orçamento TOTAL da ida = 10 s (paridade com o
 *    desenho que este servidor já tinha: cada tentativa recebe o que sobra do
 *    orçamento, e uma primeira tentativa pendurada gasta tudo);
 *  - 2 retries (3 tentativas), backoff 1 s → 2 s → 4 s (teto) + jitter 0–500 ms.
 *
 * O QUE REPETE E O QUE NÃO (`retryUpstream`):
 *  - 429 e 503 repetem, honrando `Retry-After`, como antes;
 *  - **500/502 genéricos passam a repetir** (novo na 3.11.0): a classe já era
 *    marcada `retryable: true` para o agente e este servidor não a repetia por
 *    conta própria — o agente pagava a repetição. Paridade com os irmãos
 *    (bcb/ibge/ilo/uis/medical repetem 5xx);
 *  - **rede** (DNS/TCP/TLS) repete, como antes;
 *  - **timeout NÃO repete**: a tentativa que pendurou já gastou o orçamento
 *    inteiro (como antes: `AbortError` encerrava a ida);
 *  - 4xx (404 incluído) não repete: é resposta da fonte, não falha;
 *  - **corpo vazio e JSON inválido NÃO repetem** (como antes): são lidos aqui,
 *    depois da ida, e há pelo menos um caso em que o corpo vazio é
 *    determinístico (`/comissao/reuniao/{codigo}` inexistente — ver
 *    `ehReuniaoInexistente`), em que repetir só atrasaria a resposta certa.
 *
 * O COLETOR. `instrumentTool` (src/instrument.ts) abre UM coletor por chamada de
 * tool — aninhado ao ALS de cache que já existia — e toda ida feita aqui, a
 * qualquer profundidade, cai nele; `provenanceFor` lê `currentRetrieval()`. Fora
 * de uma chamada (cron do e-Cidadania, testes que chamam a função direto) a ida
 * ganha um coletor descartável: a política vale igual, e o bloco diz
 * `retrieval: null` ("não medido"), nunca quebra. Um servidor com UMA origem
 * (a API do Senado, nas duas bases) não precisa do coletor por origem do
 * medical — o `search` do Deep Research emite dois blocos da MESMA origem, e os
 * dois carregam a medição da chamada.
 */

import {
  createUpstream,
  UpstreamError as PkgUpstreamError,
  type RetryContext,
  type Upstream,
  type UpstreamCall,
} from "@sbissoli/mcp-upstream";
import { currentCall, withCall } from "@sbissoli/mcp-upstream/als";
import type { RetrievalInput } from "@sbissoli/mcp-provenance";
import { globalBucket } from "./token-bucket.js";
import { UPSTREAM_TIMEOUT_MS, MAX_RESPONSE_SIZE, SENADO_BASE_URL_DEFAULT } from "../types.js";
import { log, logger } from "../utils/logger.js";
import { incr } from "../metrics.js";
import { USER_AGENT } from "../version.js";
import type { ErrorClass } from "../call-shape.js";

const MAX_RETRIES = 2;
const MAX_CONCURRENT = 6;
let inFlight = 0;

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
    /**
     * True only when the upstream never produced a response: DNS, TCP, TLS,
     * an aborted request, or the time budget running out. A response that
     * arrived and was rejected — an HTTP status, a body over the size guard,
     * an empty body, a body that is not JSON — is NOT transport, even when
     * its status is 502.
     *
     * The distinction exists because "the Senado did not answer" and "the
     * Senado answered with a different shape" are opposite facts for the
     * nightly contract tier: the first means drift could not be measured
     * tonight, the second is the drift it exists to catch. Status alone
     * cannot carry it — 502 is used for both a real Bad Gateway and a body
     * that failed to parse.
     */
    public readonly transport: boolean = false,
    /**
     * Classe de telemetria pelo TIPO, não pela frase (ver `CLASSE_DO_ERRO` em
     * src/call-shape.ts). Medido em 30/09/2026: pela frase, "Erro de rede: ..."
     * e o 429 do nosso próprio balde ("Taxa de requisições excedida") caíam em
     * `outro`. Padrão: 404 é ausência respondida, o resto é a fonte falhando;
     * quem sabe mais passa explícito (rota inexistente é `defeito`, corpo vazio
     * é `nao_encontrado`).
     */
    classe?: ErrorClass,
  ) {
    super(message);
    this.name = "UpstreamError";
    this.classe = classe ?? (status === 404 ? "nao_encontrado" : "fonte");
  }

  readonly classe: ErrorClass;
}

/**
 * Frase-chave da mensagem de rota inexistente. Vive numa constante porque
 * `classifyError` casa contra ela para devolver `defeito`: se o texto mudar
 * num lugar só, a telemetria volta a mentir em silêncio.
 */
export const MSG_ROTA_INEXISTENTE = "Rota inexistente na fonte (defeito do servidor MCP)";

/**
 * A fonte respondeu, e respondeu que a CHAVE pedida não existe no acervo.
 *
 * Separada de `UpstreamError` porque não é falha da fonte: é resposta dela.
 * A mensagem é escrita para cair em `nao_encontrado` no `classifyError`.
 */
export class RecursoAusenteError extends UpstreamError {
  constructor(path: string) {
    super(
      `[${path}] A fonte não tem registro para esta chave: o recurso não existe no acervo publicado.`,
      404,
      false,
    );
    this.name = "RecursoAusenteError";
  }
}

/**
 * Distingue os DOIS 404 que as APIs do Senado emitem — medido em 24/09/2026
 * nas duas bases, legislativa e administrativa:
 *
 * | caso                          | corpo                                                |
 * |-------------------------------|------------------------------------------------------|
 * | rota não existe (erro NOSSO)  | problem+json com `detail: "No static resource ..."`  |
 * | chave sem registro            | corpo vazio, ou problem+json SEM `detail`            |
 *
 * `/servidores/xxxx` traz o `detail`; `/supridos/2005` vem com
 * `Content-Length: 0`; `/taquigrafia/notas/sessao/99999999` traz
 * `{instance,status,title}` sem `detail`. Só o primeiro é defeito nosso.
 */
export function rotaInexistente(corpo: string): boolean {
  if (!corpo.trim()) return false;
  let detail: unknown;
  try {
    detail = (JSON.parse(corpo) as { detail?: unknown }).detail;
  } catch {
    return false;
  }
  return typeof detail === "string" && /^No static resource\b/i.test(detail.trim());
}

// ── Política de rede ──────────────────────────────────────────────────────────

/** A política de rede deste servidor (ver o cabeçalho: números medidos em 27/09/2026). */
export const UPSTREAM_POLICY = {
  /** Teto de UMA tentativa (cabeçalhos + corpo), em ms. */
  timeoutMs: UPSTREAM_TIMEOUT_MS,
  /** Orçamento TOTAL de uma ida, esperas incluídas — o mesmo teto (paridade). */
  budgetMs: UPSTREAM_TIMEOUT_MS,
  /** Retries além da primeira tentativa. */
  retries: MAX_RETRIES,
  /** Esperas: 1 s, 2 s, 4 s (teto), mais jitter uniforme de até 500 ms. */
  backoff: { baseMs: 1_000, maxMs: 4_000, jitterMs: 500 },
} as const;

/**
 * I/O da espera entre tentativas e do jitter, num objeto para os testes trocarem
 * (`vi.spyOn(upstreamIo, "sleep")`): um 503 permanente num dublê custaria 3 s de
 * backoff real por ida, e o jitter aleatório impediria contar o relógio.
 */
export const upstreamIo = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
  random: (): number => Math.random(),
};

/** A decisão de repetir uma tentativa que falhou (o pacote diz a classe). */
export function retryUpstream(ctx: RetryContext): boolean {
  switch (ctx.kind) {
    case "rate_limited":
    case "http_5xx":
    case "network": {
      logger.warn("upstream_retry", { url: ctx.url, attempt: ctx.attempt, kind: ctx.kind, status: ctx.status });
      return true;
    }
    // A tentativa que pendurou já gastou o orçamento inteiro; 4xx é resposta da
    // fonte; `malformed_body` não acontece no modo `response`.
    default:
      return false;
  }
}

/**
 * A política no formato do pacote, com ligação TARDIA ao `fetch` global — os
 * testes dublam `globalThis.fetch` depois de este módulo carregar.
 */
export const upstreamSenado: Upstream = createUpstream({
  userAgent: USER_AGENT,
  timeoutMs: UPSTREAM_POLICY.timeoutMs,
  retries: UPSTREAM_POLICY.retries,
  budgetMs: UPSTREAM_POLICY.budgetMs,
  backoff: UPSTREAM_POLICY.backoff,
  honorRetryAfter: true,
  retryOn: retryUpstream,
  sleep: (ms) => upstreamIo.sleep(ms),
  random: () => upstreamIo.random(),
  fetchImpl: (input, init) => globalThis.fetch(input, init),
});

/**
 * Abre o coletor de UMA chamada de tool e roda `fn` dentro dele — ou reusa o que
 * já está aberto, se `fn` é um passo de uma chamada maior (a tool de fora não
 * pode perder as idas de dentro). É chamado por `instrumentTool`.
 */
export function withUpstreamCall<T>(fn: () => Promise<T>): Promise<T> {
  return currentCall() ? fn() : withCall(upstreamSenado, () => fn());
}

/**
 * O coletor da chamada corrente; fora de uma chamada, um descartável (a ida
 * continua com a política, a contagem simplesmente não é lida).
 */
export function upstreamCall(): UpstreamCall {
  return currentCall() ?? upstreamSenado.call();
}

/**
 * O `retrieval` medido nesta chamada de tool — `null` fora de um coletor ou
 * quando a resposta veio inteira do cache (nenhuma ida). É o que
 * `provenanceFor` põe no bloco quando a tool não passa outro.
 */
export function currentRetrieval(): RetrievalInput | null {
  return currentCall()?.retrieval() ?? null;
}

// ── A ida ─────────────────────────────────────────────────────────────────────

export interface UpstreamOptions {
  /** Skip the automatic `.json` suffix (the adm API does not use it). */
  noJsonSuffix?: boolean;
  /** Override the response size guard (bytes). Use for known-large datasets. */
  maxSize?: number;
  /**
   * O que fazer com um HTTP 404 cujo CORPO está vazio — isto é, a rota existe
   * e é a CHAVE pedida que não tem registro.
   *
   * - `"absent"`: lança `RecursoAusenteError` (classe `nao_encontrado`). É o
   *   certo para coleção chaveada (ano, ano/mês, situação): a fonte devolve
   *   `200 []` quando a chave é válida e ainda não há dado, então o 404 só
   *   sobra para chave FORA da cobertura. Medido em 24/09/2026:
   *   `/servidores/horas-extras/2026/10` (mês futuro, chave válida) responde
   *   `200 []`, enquanto `/supridos/2005` (fora da cobertura) responde 404.
   * - `"empty"`: devolve `[]`. Só para rota em que o 404 é mesmo ambíguo e
   *   quem chama resolve a ambiguidade por outro caminho — hoje só
   *   `senado_contratacao_detalhe`, que confere o pai na lista já cacheada.
   *
   * Omitir mantém o 404 como erro de upstream, que é o padrão da casa.
   */
  on404?: "absent" | "empty";
  /**
   * Cabeçalho `Accept` a enviar (default `application/json`). O texto integral
   * de um discurso só sai com `text/plain` — com `Accept: application/json` a
   * fonte responde 406.
   */
  accept?: string;
  /**
   * Devolver o corpo como TEXTO, sem parse de JSON (as guardas de tamanho e de
   * corpo vazio continuam valendo). Para o único endpoint que não fala JSON,
   * `/discurso/texto-integral/{codigo}`.
   */
  text?: boolean;
}

/**
 * Fetch from the Senado API upstream.
 * @param path - Relative path (e.g., "/senador/lista/atual")
 * @param params - Query parameters
 * @param baseUrl - Override base URL (from env)
 * @param options - Per-call behavior overrides
 */
export async function upstreamFetch(
  path: string,
  params: Record<string, string> = {},
  baseUrl?: string,
  options: UpstreamOptions = {},
): Promise<unknown> {
  const base = baseUrl || SENADO_BASE_URL_DEFAULT;
  const maxSize = options.maxSize ?? MAX_RESPONSE_SIZE;

  // Build URL with sorted query params
  const url = new URL(`${base}${path}${options.noJsonSuffix ? "" : ".json"}`);
  const sortedKeys = Object.keys(params).sort();
  for (const key of sortedKeys) {
    if (params[key] !== undefined && params[key] !== "") {
      url.searchParams.set(key, params[key]);
    }
  }

  // Check global rate limit — uma vez por IDA (as repetições de uma ida já
  // estão limitadas em número e em orçamento; o balde protege a fonte da rajada
  // de chamadas, não de uma tentativa a mais).
  if (!globalBucket.tryConsume()) {
    incr("upstreamErrors");
    logger.warn("upstream_rate_limited", { path });
    throw new UpstreamError(
      `[${path}] Taxa de requisições excedida. Tente novamente em alguns segundos.`,
      429,
      true,
    );
  }

  // Check concurrency limit
  if (inFlight >= MAX_CONCURRENT) {
    incr("upstreamErrors");
    logger.warn("upstream_concurrency_limited", { path });
    throw new UpstreamError(
      `[${path}] Muitas requisições simultâneas ao upstream. Tente novamente em breve.`,
      503,
      true,
    );
  }

  const startTime = Date.now();
  const call = upstreamCall();
  const attemptsBefore = call.attempts;
  const retriesFeitos = (attempts: number): void => {
    for (let i = 1; i < attempts; i++) incr("upstreamRetries");
  };

  let response: Response;
  inFlight++;
  try {
    response = await call.response(url.toString(), {
      method: "GET",
      headers: {
        Accept: options.accept ?? "application/json",
        "User-Agent": USER_AGENT,
      },
    });
  } catch (err) {
    if (!(err instanceof PkgUpstreamError)) throw err;
    retriesFeitos(err.attempts);

    if (err.kind === "not_found" && options.on404 && err.response) {
      incr("upstreamCalls");
      log("upstream", path, 404, Date.now() - startTime, err.attempts - 1);
      const corpo404 = await err.response.text();
      if (rotaInexistente(corpo404)) {
        throw new UpstreamError(
          `[${path}] ${MSG_ROTA_INEXISTENTE} — o caminho montado não existe na API do Senado.`,
          404,
          false,
          false,
          "defeito",
        );
      }
      if (options.on404 === "empty") return [];
      throw new RecursoAusenteError(path);
    }

    const traduzido = traduzirErro(err, path);
    if (traduzido.retryable) {
      // O que hoje termina a ida por esgotamento (429/503/5xx/rede/timeout) é o
      // que sempre contou como erro de upstream; 4xx e 404 são resposta da fonte.
      incr("upstreamErrors");
      logger.error("upstream_error", { path, status: traduzido.status, message: traduzido.message });
    }
    throw traduzido;
  } finally {
    inFlight--;
  }
  retriesFeitos(call.attempts - attemptsBefore);

  // Check response size via Content-Length header
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > maxSize) {
    throw new UpstreamError(
      `[${path}] Resposta upstream excede o limite de ${Math.round(maxSize / 1024 / 1024)} MB`,
      413,
      false,
    );
  }

  const text = await response.text();
  if (text.length > maxSize) {
    throw new UpstreamError(
      `[${path}] Resposta upstream excede o limite de ${Math.round(maxSize / 1024 / 1024)} MB`,
      413,
      false,
    );
  }

  const latency = Date.now() - startTime;
  incr("upstreamCalls");
  log("upstream", path, response.status, latency, call.attempts - attemptsBefore - 1);

  if (!text.trim()) {
    // `nao_encontrado`, como a frase já dava ("vazi"): um corpo vazio é como o
    // `/comissao/reuniao/{codigo}` responde a código inexistente.
    throw new UpstreamError(
      `[${path}] Resposta upstream vazia`,
      502,
      true,
      false,
      "nao_encontrado",
    );
  }

  if (options.text) return text;

  try {
    return JSON.parse(text);
  } catch {
    throw new UpstreamError(
      `[${path}] Resposta upstream não é JSON válido`,
      502,
      false,
    );
  }
}

/**
 * Do erro do pacote (classe + contagem) para o `UpstreamError` LOCAL que o resto
 * do servidor lê — com as MESMAS mensagens de antes da 3.11.0: `errorFrom` mostra
 * a mensagem ao agente, `classifyError` casa "upstream"/"timeout"/"5xx" nela, e
 * `transport` alimenta o disjuntor do contrato noturno.
 */
export function traduzirErro(err: PkgUpstreamError, path: string): UpstreamError {
  switch (err.kind) {
    case "timeout":
    case "aborted":
      return new UpstreamError(
        `[${path}] Timeout na requisição upstream (${UPSTREAM_TIMEOUT_MS / 1000}s)`,
        504,
        true,
        true,
      );
    case "network": {
      const cause = err.cause;
      const detalhe = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
      return new UpstreamError(`[${path}] Erro de rede: ${detalhe || "desconhecido"}`, 502, true, true);
    }
    case "rate_limited":
      return new UpstreamError(`[${path}] Upstream retornou 429`, 429, true);
    case "http_5xx": {
      const status = err.status ?? 502;
      return status === 503
        ? new UpstreamError(`[${path}] Upstream retornou 503`, 503, true)
        : new UpstreamError(`[${path}] Upstream retornou HTTP ${status}`, status, true);
    }
    case "http_4xx":
    case "not_found":
      return new UpstreamError(`[${path}] Upstream retornou HTTP ${err.status ?? 404}`, err.status ?? 404, false);
    case "malformed_body":
      // Não acontece no modo `response` (o corpo é lido por `upstreamFetch`).
      return new UpstreamError(`[${path}] Resposta upstream não é JSON válido`, 502, false);
  }
}
