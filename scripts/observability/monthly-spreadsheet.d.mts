/**
 * Tipos do que `monthly-spreadsheet.mjs` exporta para teste. O script segue em
 * JavaScript — é um utilitário de linha de comando, não parte do Worker —, mas
 * `escopos` é a regra que decide o que conta como adoção, e por isso é testada.
 */

/** Os dois recortes complementares da janela do mês: público e uso do dono. */
export declare function escopos(where: string): { publico: string; proprio: string };
