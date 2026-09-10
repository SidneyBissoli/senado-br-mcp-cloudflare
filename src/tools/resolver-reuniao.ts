/**
 * Resolve o `codigoReuniao` a partir do que uma PESSOA tem na mão.
 *
 * Por quê. Em 10/09/2026 o painel apontou `senado_reuniao_comissao` com **74
 * erros em 74 chamadas** — nunca funcionou para ninguém. A telemetria de forma
 * (blob7/blob8) mostrou o motivo: `classe=nao_encontrado`,
 * `parametros=codigoReuniao`. Ou seja, o agente chama com o parâmetro CERTO e
 * um valor que não existe. Não é erro de seleção de ferramenta, que era a
 * primeira hipótese — erro de validação de esquema nem chega à instrumentação,
 * o SDK o responde antes do callback.
 *
 * A causa é de contrato: o único jeito de entrar na ferramenta era um inteiro
 * interno que ninguém tem sem antes chamar OUTRA ferramenta. Quem pergunta
 * "o que a CAE decidiu na reunião do dia 1º?" tem uma sigla e uma data.
 *
 * Este módulo não substitui `senado_reunioes_comissao`: essa continua sendo a
 * ferramenta de LISTAR, e a pergunta "quais reuniões houve" é legítima por si.
 * Aqui a listagem é só o caminho interno para achar UM código.
 */

/** Uma reunião da agenda, no mínimo que o resolvedor precisa. */
export interface ReuniaoResumo {
  codigo: number;
  descricao: string;
  data: string;
  hora: string | null;
}

export type Resolucao =
  | { tipo: "codigo"; codigo: number }
  | { tipo: "nenhuma"; mensagem: string }
  | { tipo: "ambigua"; mensagem: string };

/**
 * Escolhe UMA reunião da lista. Devolve erro com as candidatas quando há mais
 * de uma, em vez de devolver a lista no lugar do detalhe: a ferramenta de
 * detalhe tem uma forma de resposta só, e trocá-la pela forma de lista quando
 * a busca é ambígua é o tipo de resposta polimórfica que o modelo consome mal.
 */
export function escolherReuniao(
  reunioes: ReuniaoResumo[],
  sigla: string,
  periodo: string,
): Resolucao {
  if (reunioes.length === 0) {
    return {
      tipo: "nenhuma",
      mensagem:
        `Nenhuma reunião da comissão ${sigla} em ${periodo}. Confira a sigla com ` +
        `senado_listar_comissoes ou amplie o período com senado_reunioes_comissao.`,
    };
  }
  if (reunioes.length === 1) return { tipo: "codigo", codigo: reunioes[0].codigo };
  const lista = reunioes
    .slice(0, 10)
    .map((r) => `${r.codigo} (${r.data}${r.hora ? " " + r.hora : ""}, ${r.descricao})`)
    .join("; ");
  return {
    tipo: "ambigua",
    mensagem:
      `${reunioes.length} reuniões da comissão ${sigla} em ${periodo}. Repita informando ` +
      `codigoReuniao com uma destas: ${lista}${reunioes.length > 10 ? "; …" : ""}`,
  };
}

/**
 * A resposta vazia do upstream em `/comissao/reuniao/{codigo}` NÃO é erro
 * transitório: é "não existe reunião com esse código". O `upstreamFetch` marca
 * corpo vazio como 502 retryable, o que é certo para a maioria dos endpoints e
 * errado para este — e mandava o agente repetir uma chamada que nunca ia
 * funcionar, gastando a vez dele. Esta função reconhece o caso.
 */
export function ehReuniaoInexistente(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /\/comissao\/reuniao\/\d+/.test(m) && /vazia|não é JSON|nao e JSON/i.test(m);
}

/** A mensagem que o agente recebe quando o código não existe. */
export function mensagemCodigoInexistente(codigo: number): string {
  return (
    `Não existe reunião com o código ${codigo}. Esse código é interno e não é ` +
    `dedutível: pegue-o em senado_reunioes_comissao (por sigla e período) ou em ` +
    `senado_agenda_comissoes (por data) — ou chame esta mesma ferramenta com ` +
    `sigla e data, que ela resolve o código sozinha. Repetir a chamada com o ` +
    `mesmo código não vai funcionar.`
  );
}
