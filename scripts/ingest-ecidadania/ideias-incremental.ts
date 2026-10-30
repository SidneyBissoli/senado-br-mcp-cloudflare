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

/**
 * Situações relidas inteiras todo dia: as que ainda mudam de apoios ou de situação, mais a 99
 * ("arquivadas ao final da legislatura", 1 página): entra pela fase B2 (30/10/2026) para que a página
 * dessa categoria fique no arquivo bruto todo dia — é a única fonte que a publica.
 */
export const SITUACOES_VIVAS = [5, 6, 8, 9, 10, 99] as const;

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

/**
 * Página da s7 que falha sempre (30/10/2026: a p951 dá HTTP 500 porque UMA ideia dela, a 133378, derruba
 * a renderização do portal — o detalhe dela dá o mesmo 500). A fatia anda só em sequência, então essa
 * página prendia o cursor para sempre. Decisão do dono (30/10): falhou em 3 DIAS distintos seguidos (sem
 * leitura boa no meio) → pula, registra o pulo e segue; a próxima volta tenta de novo, porque recomeça
 * da página 1. Dias, não runs: um dispatch manual no mesmo dia não acelera o pulo.
 */
export const DIAS_FALHA_PARA_PULAR = 3;

/** Chave, em `ecidadania_detalhe_cursor`, da página que vem falhando (`last_entity_id` = página,
 *  `full_passes` = dias de falha, `updated_at` = instante da última falha). Página 0 = nenhuma. */
export const CURSOR_ARQUIVO_FALHA = "ideias-s7-falha";

/** Chave do registro de um pulo (uma linha por página pulada; `full_passes` = volta em que pulou). */
export function chavePuloArquivo(pagina: number): string {
  return `ideias-s7-pulo-p${pagina}`;
}

export interface FalhaArquivo {
  pagina: number;
  dias: number;
  /** Dia (AAAA-MM-DD, UTC) da última falha contada. */
  dia: string;
}

/**
 * Conta mais uma falha da `pagina` no dia `hoje`. Mesma página: soma 1 se o dia é outro, nada se é o
 * mesmo. Outra página (ou nenhuma antes): recomeça em 1. `pular` = chegou a DIAS_FALHA_PARA_PULAR.
 */
export function contarFalhaArquivo(
  anterior: FalhaArquivo | null,
  pagina: number,
  hoje: string,
): { falha: FalhaArquivo; pular: boolean } {
  let dias = 1;
  if (anterior && anterior.pagina === pagina) dias = anterior.dia === hoje ? anterior.dias : anterior.dias + 1;
  return { falha: { pagina, dias, dia: hoje }, pular: dias >= DIAS_FALHA_PARA_PULAR };
}
