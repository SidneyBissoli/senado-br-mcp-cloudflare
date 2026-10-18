/**
 * Linha de andamento dos laços longos dos jobs (pedido do dono, 18/10/2026). O GitHub só entrega o log
 * pelo CLI quando o job termina, e o laço de detalhe das consultas imprimia uma linha só no fim: um run
 * de 2 h 23 passou inteiro sem dizer onde estava. A página web do job mostra o log AO VIVO, então uma
 * linha a cada lote basta para ver quantas faltam, o ritmo medido e quando termina.
 *
 * Puro (o relógio entra por argumento). Horário em UTC e em Brasília: o dono lê em Brasília.
 */

export interface Andamento {
  rotulo: string;
  feitos: number;
  total: number;
  inicioMs: number;
  agoraMs: number;
  /** Quantos já estão gravados no banco (pode ser < feitos, se o lote corrente ainda não gravou). */
  gravados?: number;
}

function hora(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(ms);
}

export function descreverAndamento(a: Andamento): string {
  const decorrido = Math.max(0, a.agoraMs - a.inicioMs);
  const partes = [`${a.rotulo}: ${a.feitos} de ${a.total}`];
  if (a.gravados !== undefined) partes.push(`${a.gravados} gravadas no banco`);
  if (a.feitos > 0) {
    const porItem = decorrido / a.feitos;
    partes.push(`${(porItem / 1000).toFixed(1).replace(".", ",")} s por item`);
    const fim = a.agoraMs + porItem * Math.max(0, a.total - a.feitos);
    partes.push(`término previsto ${hora(fim, "UTC")} UTC (${hora(fim, "America/Sao_Paulo")} em Brasília)`);
  }
  return partes.join(" · ");
}
