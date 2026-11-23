/**
 * Nomes omitidos a pedido do titular (LGPD, art. 7º, § 7º: tratamento posterior de dado de acesso
 * público com "preservação dos direitos do titular"). Decisão do dono de 22/11/2026: quem estiver
 * nomeado como autor de ideia e pedir pelo e-mail do projeto tem o nome omitido a partir da edição
 * seguinte do dataset; versões já publicadas no Zenodo não podem ser alteradas.
 *
 * Aplicada na montagem das tabelas publicadas (`gravar.ts`), antes do balde: a omissão chega sozinha à
 * cópia no D1 (projeção), ao pacote e ao release. `gravar.ts` e este arquivo não entram na versão do
 * leitor das observações: incluir um id NÃO dispara reprocessamento.
 *
 * Onde o nome aparece (medido em 22/11/2026 no pacote inteiro): `ideias.autorNome` e o acontecimento
 * "Ideia proposta por NOME (UF)" da linha do tempo. Nenhum outro campo.
 */

import type { LinhaAcontecimento, LinhaIdeia } from "./ideias.js";

/**
 * Id da ideia → data do pedido (AAAA-MM-DD). Só o id e a data: o nome nunca entra aqui (este arquivo
 * é público). Para atender um pedido: conferir que quem pede é o autor, acrescentar a linha, mesclar.
 */
export const NOMES_OMITIDOS: ReadonlyMap<string, string> = new Map<string, string>([]);

/** O que fica no lugar do nome no texto da linha do tempo. */
export const MARCA_DE_OMISSAO = "[nome omitido a pedido do titular]";

const PROPOSTA = /^(Ideia proposta por )(.*)$/;

/**
 * Omite autor e UF das ideias listadas e o nome no acontecimento de proposta delas. Puro; não altera
 * as entradas. Devolve também quantas ideias foram de fato omitidas (id listado e presente).
 */
export function omitirNomes(
  ideias: readonly LinhaIdeia[],
  linhaDoTempo: readonly LinhaAcontecimento[],
  omitidos: ReadonlyMap<string, string> = NOMES_OMITIDOS,
): { ideias: LinhaIdeia[]; linhaDoTempo: LinhaAcontecimento[]; omitidas: number } {
  if (omitidos.size === 0) return { ideias: [...ideias], linhaDoTempo: [...linhaDoTempo], omitidas: 0 };
  const nomes = new Map<string, string | null>();
  const saidaIdeias = ideias.map((l) => {
    if (!omitidos.has(l.id)) return l;
    nomes.set(l.id, l.autorNome);
    return { ...l, autorNome: null, autorUf: null };
  });
  const saidaLinha = linhaDoTempo.map((a) => {
    if (!omitidos.has(a.id)) return a;
    let texto = a.texto.replace(PROPOSTA, `$1${MARCA_DE_OMISSAO}`);
    // Defensivo: o nome em qualquer outro acontecimento da mesma ideia também sai.
    const nome = nomes.get(a.id);
    if (nome) texto = texto.split(nome).join(MARCA_DE_OMISSAO);
    return texto === a.texto ? a : { ...a, texto };
  });
  return { ideias: saidaIdeias, linhaDoTempo: saidaLinha, omitidas: nomes.size };
}
