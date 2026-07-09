/**
 * Normalização de nomes de órgãos para casamento entre fontes.
 *
 * O cadastro de servidores traz a lotação como `{ sigla, nome }` cujo `nome` é o mesmo texto
 * do portal institucional, mas pode divergir em acentuação, caixa, pontuação e nas preposições
 * ("da/de/do"). Para casar a lotação de um servidor com um nó da árvore organizacional, ambos os
 * lados passam por `normalizarNome`: sem acento, minúsculo, sem preposições/conjunções curtas e
 * com pontuação colapsada em espaço único. Casamento é feito sobre a string normalizada.
 */

/** Preposições/conjunções que não distinguem órgãos e atrapalham o casamento textual. */
const STOPWORDS = new Set(["da", "de", "do", "dos", "das", "e", "a", "o", "as", "os"]);

/**
 * Reduz um nome de órgão à sua forma canônica de casamento: NFD sem diacríticos, minúsculo,
 * pontuação → espaço, remoção de stopwords e colapso de espaços. Retorna "" para entrada vazia.
 */
export function normalizarNome(nome: string | null | undefined): string {
  if (!nome) return "";
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove diacríticos (marcas combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ") // pontuação/símbolos → espaço
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w))
    .join(" ")
    .trim();
}
