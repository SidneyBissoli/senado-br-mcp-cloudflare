/**
 * Janelas de período pedidas pelo chamador: validar, carimbar e fatiar.
 *
 * Medido em 30/10/2026 (dez tools que montam o `data_vintage` a partir de `dataInicio`/`dataFim`):
 *  - janela invertida (fim antes do início) passava calada: lista vazia, e o selo repetia a janela
 *    invertida como se ela tivesse sido consultada;
 *  - fim no futuro (até 31/12/2027) fazia o selo afirmar 2027, com dados até a véspera;
 *  - a fonte tem limites de período que ela cumpre de dois jeitos: recusando (HTTP 400 genérico:
 *    discursos do plenário > 1 mês, `/votacao` e `/processo/emenda` > 1 ano) ou CORTANDO CALADA
 *    (`/comissao/agenda/{di}/{df}` entrega só ~30 dias a partir do início; `/senador/{cod}/discursos`
 *    só os últimos 12 meses), sempre com HTTP 200 e metadados sem aviso;
 *  - lista cortada pelo `limite` dizia o total da janela, mas o selo não dizia o que foi entregue.
 * Decisões do dono (30/10/2026), uma por vez: recusar janela invertida antes da fonte; selo em ISO
 * (`AAAA-MM-DD/AAAA-MM-DD`) e cortado em hoje, com o pedido entre parênteses; fatiar por dentro onde
 * a leitura é leve; aviso de corte com o período entregue só quando a lista está em ordem de data.
 */

import { toolError } from "./validation.js";
import { LimiteLocalError, upstreamIo } from "../throttle/upstream.js";

/** Relógio injetável (os testes fixam "hoje"). */
export const relogioJanela = { agora: (): Date => new Date() };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** `AAAAMMDD` ou `AAAA-MM-DD` → `AAAA-MM-DD`. */
export function paraISO(d: string): string {
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
}

/** `AAAA-MM-DD` → `AAAAMMDD` (os caminhos `/{di}/{df}` da fonte). */
export function paraCompacta(iso: string): string {
  return iso.replace(/-/g, "");
}

/** `AAAA-MM-DD` → `DD/MM/AAAA`, para texto lido por pessoas. */
export function dataBR(iso: string): string {
  return ISO.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso;
}

/** A data de hoje em Brasília, `AAAA-MM-DD`. */
export function hojeEmBrasilia(agora: Date = relogioJanela.agora()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

/**
 * Janela invertida = erro de contrato, sem ir à fonte (decisão 3). Aceita qualquer dos dois
 * formatos; com uma das pontas ausente não há o que comparar.
 */
export function recusarJanelaInvertida(dataInicio?: string, dataFim?: string) {
  if (!dataInicio || !dataFim) return null;
  const di = paraISO(dataInicio);
  const df = paraISO(dataFim);
  if (df >= di) return null;
  return toolError(
    `A data de fim (${dataBR(df)}) é anterior à de início (${dataBR(di)}); corrija o período.`,
    "contrato",
  );
}

/**
 * Selo de período de uma janela pedida (decisões 4 e 7): ISO, cortado em hoje. Tools de coisas já
 * acontecidas não têm registro depois de hoje, então o selo não afirma o que não existe; o pedido
 * vai entre parênteses para quem o compara com a pergunta.
 */
export function carimboDaJanela(dataInicio: string, dataFim: string, hoje = hojeEmBrasilia()): string {
  const di = paraISO(dataInicio);
  const df = paraISO(dataFim);
  if (df <= hoje) return `${di}/${df}`;
  if (di > hoje) return `nenhum período já ocorrido (pedido ${di}/${df}, todo depois de ${hoje})`;
  return `${di}/${hoje} (pedido até ${df})`;
}

/** Selo de uma data única, em ISO. */
export const carimboDoDia = (data: string): string => paraISO(data);

/** Selo do mês em que cai a data (`AAAA-MM`), para leituras de mês inteiro. */
export const carimboDoMes = (data: string): string => paraISO(data).slice(0, 7);

export interface Fatia {
  inicio: string;
  fim: string;
}

function somarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dias corridos entre as duas pontas (fim − início). */
export function diasEntre(inicio: string, fim: string): number {
  return Math.round((Date.parse(`${paraISO(fim)}T00:00:00Z`) - Date.parse(`${paraISO(inicio)}T00:00:00Z`)) / 86_400_000);
}

/**
 * Corta [inicio, fim] (ISO, fim ≥ início) em fatias contíguas e disjuntas que não cruzam a
 * unidade: um dia, um mês do calendário ou um ano do calendário. Mês e ano do calendário cabem
 * nos limites da fonte medidos em 30/10/2026 (plenário: fim ≤ início + 1 mês; `/votacao` e
 * discursos do senador: fim ≤ início + 1 ano).
 */
export function fatiar(inicio: string, fim: string, unidade: "dia" | "mes" | "ano"): Fatia[] {
  const fatias: Fatia[] = [];
  let cursor = paraISO(inicio);
  const ultimo = paraISO(fim);
  while (cursor <= ultimo) {
    let fimDaFatia: string;
    if (unidade === "dia") fimDaFatia = cursor;
    else if (unidade === "ano") fimDaFatia = `${cursor.slice(0, 4)}-12-31`;
    else {
      const [a, m] = [Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7))];
      const ultimoDia = new Date(Date.UTC(a, m, 0)).getUTCDate();
      fimDaFatia = `${cursor.slice(0, 7)}-${String(ultimoDia).padStart(2, "0")}`;
    }
    if (fimDaFatia > ultimo) fimDaFatia = ultimo;
    fatias.push({ inicio: cursor, fim: fimDaFatia });
    cursor = somarDias(fimDaFatia, 1);
  }
  return fatias;
}

/** `fim` passa de `início + 1 ano` (o limite de `/processo/emenda`; 365/366 dias passam). */
export function excedeUmAno(inicio: string, fim: string): boolean {
  const di = paraISO(inicio);
  const umAnoDepois = `${Number(di.slice(0, 4)) + 1}${di.slice(4)}`;
  return paraISO(fim) > umAnoDepois;
}

/** Espera entre tentativas quando o NOSSO limitador recusa a ida (o balde repõe 8 vagas/s). */
export const ESPERA_LIMITE_LOCAL_MS = 250;
export const TENTATIVAS_LIMITE_LOCAL = 8;

/**
 * Lê as fatias com no máximo `concorrencia` idas simultâneas. A falha de uma fatia não derruba
 * as outras: volta em `falhas`, para a resposta dizer o que ficou de fora. Recusa do nosso
 * próprio limitador (`LimiteLocalError`) não é falha da fonte: a fatia espera a vez e tenta de
 * novo — medido em 30/10/2026, sem isso 12 de 30 dias da agenda voltavam "Taxa de requisições
 * excedida" e saíam como não lidos.
 */
export async function lerFatias<T>(
  fatias: Fatia[],
  ler: (f: Fatia) => Promise<T>,
  concorrencia = 4,
): Promise<{ lidas: Array<{ fatia: Fatia; valor: T }>; falhas: Array<{ fatia: Fatia; erro: unknown }> }> {
  const resultados: Array<{ fatia: Fatia; valor?: T; erro?: unknown; ok: boolean }> = new Array(fatias.length);
  let proxima = 0;
  async function lerComVez(f: Fatia): Promise<T> {
    for (let tentativa = 1; ; tentativa++) {
      try {
        return await ler(f);
      } catch (erro) {
        if (!(erro instanceof LimiteLocalError) || tentativa >= TENTATIVAS_LIMITE_LOCAL) throw erro;
        await upstreamIo.sleep(ESPERA_LIMITE_LOCAL_MS * tentativa);
      }
    }
  }
  async function trabalhador() {
    while (proxima < fatias.length) {
      const i = proxima++;
      try {
        resultados[i] = { fatia: fatias[i], valor: await lerComVez(fatias[i]), ok: true };
      } catch (erro) {
        resultados[i] = { fatia: fatias[i], erro, ok: false };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concorrencia, fatias.length) }, trabalhador));
  return {
    lidas: resultados.filter((r) => r.ok).map((r) => ({ fatia: r.fatia, valor: r.valor as T })),
    falhas: resultados.filter((r) => !r.ok).map((r) => ({ fatia: r.fatia, erro: r.erro })),
  };
}

/**
 * Lê uma janela ano a ano quando as duas pontas existem (fontes com limite de 1 ano, que recusam
 * ou cortam calado acima disso); com uma ponta só ou nenhuma, é uma leitura única. Datas ISO.
 * Se TODAS as fatias falham, a falha sobe (a tool responde erro, não lista vazia).
 */
export async function lerPorAno<T extends { fetchedAt: string }>(
  di: string | undefined,
  df: string | undefined,
  ler: (janela: { dataInicio?: string; dataFim?: string }) => Promise<T>,
): Promise<{ leituras: T[]; falhas: Array<{ fatia: Fatia; erro: unknown }> }> {
  if (!di || !df) {
    return { leituras: [await ler({ ...(di ? { dataInicio: di } : {}), ...(df ? { dataFim: df } : {}) })], falhas: [] };
  }
  const { lidas, falhas } = await lerFatias(fatiar(di, df, "ano"), (f) => ler({ dataInicio: f.inicio, dataFim: f.fim }));
  if (lidas.length === 0 && falhas.length > 0) throw falhas[0].erro;
  return { leituras: lidas.map((l) => l.valor), falhas };
}

/** O instante mais antigo de várias leituras (o topo do bloco, contrato §3). */
export function maisAntigo(instantes: ReadonlyArray<string>): string | undefined {
  return instantes.reduce<string | undefined>((velho, i) => (!velho || Date.parse(i) < Date.parse(velho) ? i : velho), undefined);
}

/** Rótulo de uma fatia para texto ("12/11/2025" ou "01/01/2024 a 31/12/2024"). */
export const rotuloDaFatia = (f: Fatia): string =>
  f.inicio === f.fim ? dataBR(f.inicio) : `${dataBR(f.inicio)} a ${dataBR(f.fim)}`;

/** Aviso das fatias que a fonte não entregou (nunca some calada). */
export function avisoDeFatiasNaoLidas(falhas: ReadonlyArray<{ fatia: Fatia }>, unidade: "dias" | "períodos"): string {
  const um = falhas.length === 1;
  const oQue = um ? (unidade === "dias" ? "este dia, que ficou" : "este período, que ficou") : `estes ${unidade}, que ficaram`;
  return (
    `A fonte falhou ao entregar ${oQue} FORA da lista: ${falhas.map((f) => rotuloDaFatia(f.fatia)).join("; ")}. ` +
    `Repita a consulta mais tarde para ${um ? "cobri-lo" : "cobri-los"}.`
  );
}

/** Campos do payload para fatias de período que a fonte não entregou (vazio quando todas vieram). */
export function camposDePeriodosNaoLidos(falhas: ReadonlyArray<{ fatia: Fatia }>) {
  return falhas.length
    ? { periodosNaoLidos: falhas.map((f) => `${f.fatia.inicio}/${f.fatia.fim}`), aviso: avisoDeFatiasNaoLidas(falhas, "períodos") }
    : {};
}

/** Mantém os itens cuja data (início `AAAA-MM-DD…`) cai em [inicio, fim]; pontas ausentes não filtram. */
export function filtrarPeriodo<T>(itens: T[], dataDe: (x: T) => string | null | undefined, inicio?: string, fim?: string): T[] {
  if (!inicio && !fim) return itens;
  const di = inicio ? paraISO(inicio) : undefined;
  const df = fim ? paraISO(fim) : undefined;
  return itens.filter((x) => {
    const d = String(dataDe(x) ?? "").slice(0, 10);
    if (!ISO.test(d)) return false;
    if (di && d < di) return false;
    if (df && d > df) return false;
    return true;
  });
}

/**
 * Aviso de lista cortada pelo `limite` (decisão 5). O selo continua a janela consultada (é dela
 * o total); o aviso diz o que foi entregue. O período entregue só é afirmado quando a lista
 * INTEIRA está em ordem de data — aí o corte é um trecho contínuo; fora de ordem, as entregues
 * podem estar espalhadas e "de X a Y" afirmaria o que não veio. A ordem é medida na lista, não
 * presumida da fonte.
 */
export function avisoDeCorte<T>(
  todos: T[],
  limite: number,
  dataDe: (x: T) => string | null | undefined,
  rotulo: string,
): string | undefined {
  if (todos.length <= limite) return undefined;
  const cabeca = `Exibindo ${limite} de ${todos.length} ${rotulo}`;
  const datas = todos.map((x) => String(dataDe(x) ?? "").slice(0, 10));
  const todasValidas = datas.every((d) => ISO.test(d));
  const desc = todasValidas && datas.every((d, i) => i === 0 || datas[i - 1] >= d);
  const asc = todasValidas && datas.every((d, i) => i === 0 || datas[i - 1] <= d);
  if (!desc && !asc) {
    return `${cabeca}, fora de ordem de data: as entregues não cobrem um trecho contínuo do período. Reduza o período ou aumente o limite.`;
  }
  const primeira = datas[0];
  const ultima = datas[limite - 1];
  const [de, ate] = desc ? [ultima, primeira] : [primeira, ultima];
  const parcial = datas[limite] === ultima ? ` (o dia ${dataBR(ultima)} só em parte)` : "";
  return (
    `${cabeca}: ${desc ? "os mais recentes" : "os mais antigos"}, de ${dataBR(de)} a ${dataBR(ate)}${parcial}. ` +
    `Os demais ficaram de fora: reduza o período ou aumente o limite.`
  );
}
