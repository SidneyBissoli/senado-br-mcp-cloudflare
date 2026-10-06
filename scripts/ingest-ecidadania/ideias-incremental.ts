/**
 * Decisões PURAS do crawl incremental de ideias (06/10/2026). Ficam fora de `index-ideias.ts` porque
 * aquele módulo roda `main()` ao ser importado — aqui elas são testáveis sem rede nem D1.
 *
 * Por que incremental. O crawl relia as ~1185 páginas da listagem todo dia, 1126 delas da situação 7
 * (encerradas sem apoio suficiente). Medido em 06/10/2026, IP residencial, 60 páginas frias da s7: média
 * 23,7 s por página, 23% acima de 30 s (média dessas 81,8 s, máx. 111,8 s); em julho a média era ~3,9 s.
 * A s7 sozinha passou a custar ~7,5 h — o job tem 200 min. Nenhum timeout resolve; reler 112 mil ideias
 * congeladas todo dia é que não sobrevive a um portal mais lento. O run passa a ter três partes:
 *
 *   1. VIVO — as situações que ainda mudam (5, 6, 8, 9, 10; ~60 páginas), lidas inteiras todo dia. O
 *      gate de completude e o piso valem sobre ELAS, como antes valiam sobre o acervo.
 *   2. TRANSIÇÕES — ideia que o D1 tem como `aberta` e que não apareceu em nenhuma lista viva hoje saiu
 *      das listas vivas (encerrou ou foi convertida). Lê a página de detalhe dela, que traz o total
 *      final de apoios e a situação. Se a leitura falhar, a condição se repete amanhã: se cura sozinha.
 *   3. ARQUIVO — a s7 por cursor persistido, N páginas por run, só upsert. É a conferência, não a
 *      fonte primária: pega o que as transições não veem (ideia que nunca esteve no D1 como aberta).
 */

/** Situações relidas inteiras todo dia: as que ainda mudam de apoios ou de situação. */
export const SITUACOES_VIVAS = [5, 6, 8, 9, 10] as const;

/** A situação de arquivo (encerradas sem apoio suficiente), varrida por cursor. */
export const SITUACAO_ARQUIVO = 7;

/** Chave do cursor da s7 em `ecidadania_detalhe_cursor` (a coluna `last_entity_id` guarda a PÁGINA). */
export const CURSOR_ARQUIVO = "ideias-s7";

/**
 * Piso do crawl vivo, derivado do próprio D1 (sem baseline guardado): as ideias `aberta` lidas hoje
 * têm de ser pelo menos `minPct`% das que o D1 já tem como `aberta`. Protege também as transições — uma
 * lista viva truncada faria milhares de abertas parecerem "saídas" e dispararia leituras de detalhe.
 * Sem abertas no D1 (primeiro run, banco vazio) não há base: passa.
 */
export function pisoVivoOk(abertasLidas: number, abertasNoD1: number, minPct: number): boolean {
  if (abertasNoD1 <= 0) return true;
  return abertasLidas * 100 >= abertasNoD1 * minPct;
}

/**
 * Ids que saíram das listas vivas desde o último run: `aberta` no D1 e ausentes de tudo o que o crawl
 * vivo leu hoje. Ordem crescente de id (determinística) e no máximo `limite` — o excedente fica para
 * o próximo run, que o encontrará na mesma condição.
 */
export function selecionarTransicoes(
  existentes: ReadonlyArray<{ id: number; status: string }>,
  vistosHoje: ReadonlySet<number>,
  limite: number,
): number[] {
  return existentes
    .filter((r) => r.status === "aberta" && !vistosHoje.has(r.id))
    .map((r) => r.id)
    .sort((a, b) => a - b)
    .slice(0, Math.max(0, limite));
}

/** Primeira página da fatia do arquivo: a seguinte ao cursor, ou a 1 quando o cursor chegou ao fim. */
export function inicioFatiaArquivo(cursorPagina: number): number {
  return Math.max(0, Math.trunc(cursorPagina)) + 1;
}

/**
 * Cursor depois da fatia. `ultimaLida` é a última página lida COM SUCESSO, em sequência, a partir do
 * início (0 se nem a primeira passou: o cursor não anda). Ao alcançar `ultimaPagina` a passada fecha:
 * cursor volta a 0 e `voltas` sobe — o próximo run recomeça da página 1.
 */
export function avancarCursorArquivo(
  cursor: { pagina: number; voltas: number },
  ultimaLida: number,
  ultimaPagina: number,
): { pagina: number; voltas: number } {
  if (ultimaLida <= 0) return cursor;
  if (ultimaPagina > 0 && ultimaLida >= ultimaPagina) return { pagina: 0, voltas: cursor.voltas + 1 };
  return { pagina: ultimaLida, voltas: cursor.voltas };
}
