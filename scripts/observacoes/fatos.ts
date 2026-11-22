/**
 * Fase C1 do ROADMAP — fatos de UMA página do arquivo bruto das ideias. Puro: sem rede, sem banco.
 *
 * Um fato é `campo × valor` de uma entidade, lido numa página. A camada 2 é LONGA (decisão do
 * desenho: uma linha por entidade × campo × valor); o valor é sempre texto — número em decimal,
 * estrutura em JSON com chaves em ordem fixa — e `null` quando a página foi lida e o campo veio vazio
 * (diferente de não ter o fato). A tipagem fica para a camada 3.
 *
 * Fontes:
 *   - `listagem-sN` (`pesquisaideia?situacao=N&p=P`): para cada ideia da página, `titulo` e `apoios`,
 *     como o leitor do corpus os lê. A situação N faz parte da SÉRIE, não é um fato: o portal lista a
 *     mesma ideia em duas situações ao mesmo tempo (5+6, 5+8 — medido em 22/11/2026), e uma série só
 *     por ideia alternava 5, 6, 5, 6… todo dia, fingindo mudança de situação e comparando contagens de
 *     listagens diferentes. Estar listada na situação N de X a Y = o intervalo das linhas da série;
 *   - `detalhe` (`visualizacaoideia?id=N`): `statusHttp` sempre; com HTTP 200, os campos de
 *     `lerIdeiaDetalhe` + um fato `acontecimento` por item da linha do tempo e um `proposicao` por
 *     proposição. Página que o leitor recusa vira `erroLeitura` (a mensagem), nunca meio registro.
 *
 * Posição na linha do tempo: o portal numera do topo (0 = o mais recente), e um acontecimento novo
 * empurra todos para baixo. Aqui a posição é CRONOLÓGICA (0 = o mais antigo, contado de baixo), que
 * não muda quando um item novo entra no topo — senão toda a linha do tempo "mudaria" a cada novidade.
 * O `ativo` do portal (sempre o do topo) fica de fora pelo mesmo motivo: é a maior posição.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lerIdeiaDetalhe, type IdeiaDetalhe } from "../../src/scraper/ideia-detalhe.js";
import { parseIdeiaListingPage } from "../ingest-ecidadania/ideias-listing.js";

/** Tipo da página pelo caminho da URL. */
export type TipoDePagina = "listagem" | "detalhe";

/**
 * Fonte de uma série: o detalhe, ou a listagem de UMA situação do portal (`listagem-s5`); na C5
 * também o fragmento de comentários dos eventos e o CSV do acervo de votos (`fatos-c5.ts`).
 */
export type Fonte = "detalhe" | "listagem" | `listagem-s${string}` | "comentarios" | "csv";

/** Fonte da série de uma listagem: `listagem-sN`, ou `listagem` se a URL não diz a situação. */
export function fonteDaListagem(url: string): Fonte {
  const s = situacaoDaUrl(url);
  return s === null ? "listagem" : `listagem-s${s}`;
}

export interface Fato {
  campo: string;
  valor: string | null;
}

/** Fatos de uma página de listagem, agrupados por id da ideia (ordem da página). */
export type FatosDaListagem = Map<string, Fato[]>;

const num = (n: number | null): string | null => (n === null ? null : String(n));

/** Situação da listagem = o `situacao=N` da URL (o portal não a escreve no bloco). Null se ausente. */
export function situacaoDaUrl(url: string): string | null {
  return /[?&]situacao=(\d+)/.exec(url)?.[1] ?? null;
}

/** Fatos da listagem. Lança se a página tem um bloco fora do molde (o leitor do corpus faz o mesmo). */
export function fatosDaListagem(url: string, html: string): FatosDaListagem {
  void url;
  const porId: FatosDaListagem = new Map();
  for (const it of parseIdeiaListingPage(html)) {
    const id = String(it.id);
    const fatos = porId.get(id) ?? [];
    fatos.push({ campo: "titulo", valor: it.titulo }, { campo: "apoios", valor: num(it.apoios) });
    porId.set(id, fatos);
  }
  return porId;
}

/** Fatos do detalhe já lido (HTTP 200). Separado de `fatosDoDetalhe` para os testes. */
export function fatosDaIdeia(d: IdeiaDetalhe): Fato[] {
  const ultimo = d.linhaDoTempo.length - 1;
  const fatos: Fato[] = [
    { campo: "statusHttp", valor: "200" },
    { campo: "titulo", valor: d.titulo },
    { campo: "descricao", valor: d.descricao },
    { campo: "apoios", valor: num(d.apoios) },
    { campo: "autorNome", valor: d.autorNome },
    { campo: "autorUf", valor: d.autorUf },
    { campo: "dataProposta", valor: d.dataProposta },
    { campo: "prazoApoios", valor: d.prazoApoios },
    { campo: "dataMeta", valor: d.dataMeta },
    { campo: "meta", valor: num(d.meta) },
    { campo: "sugestao", valor: d.sugestao && JSON.stringify({ numero: d.sugestao.numero, ano: d.sugestao.ano, data: d.sugestao.data, url: d.sugestao.url }) },
    {
      campo: "decisaoCdh",
      valor: d.decisaoCdh && JSON.stringify({
        data: d.decisaoCdh.data, resultado: d.decisaoCdh.resultado,
        sugestao: { numero: d.decisaoCdh.sugestao.numero, ano: d.decisaoCdh.sugestao.ano },
      }),
    },
    { campo: "encerramento", valor: d.encerramento && JSON.stringify({ data: d.encerramento.data, apoios: d.encerramento.apoios, terminouEm: d.encerramento.terminouEm }) },
    { campo: "oficina", valor: d.oficina && JSON.stringify({ nivel: d.oficina.nivel, dataCadastro: d.oficina.dataCadastro }) },
  ];
  for (const a of d.linhaDoTempo) {
    fatos.push({
      campo: "acontecimento",
      valor: JSON.stringify({ posicao: ultimo - a.ordem, data: a.data, tipo: a.tipo, texto: a.texto }),
    });
  }
  for (const p of d.proposicoes) {
    fatos.push({
      campo: "proposicao",
      valor: JSON.stringify({
        posicao: ultimo - p.ordem, data: p.data, transformadaPor: p.transformadaPor, sexo: p.sexo,
        parlamentar: p.parlamentar, parlamentarUf: p.parlamentarUf, tipoSigla: p.tipoSigla, tipoNome: p.tipoNome,
        numero: p.numero, ano: p.ano, complemento: p.complemento, url: p.url,
      }),
    });
  }
  return fatos;
}

/** Fatos de uma leitura do detalhe. 404/410 = só o status (a ideia saiu do ar; nada a ler). */
export function fatosDoDetalhe(statusHttp: number, html: string): Fato[] {
  if (statusHttp !== 200) return [{ campo: "statusHttp", valor: String(statusHttp) }];
  try {
    return fatosDaIdeia(lerIdeiaDetalhe(html));
  } catch (e) {
    return [
      { campo: "statusHttp", valor: "200" },
      { campo: "erroLeitura", valor: e instanceof Error ? e.message : String(e) },
    ];
  }
}

/** Status que vira observação. 5xx e afins são falha de leitura (ficam no índice), não fato da ideia. */
export function statusObservavel(fonte: TipoDePagina, statusHttp: number): boolean {
  return fonte === "listagem" ? statusHttp === 200 : statusHttp === 200 || statusHttp === 404 || statusHttp === 410;
}

/** Fonte da página pelo caminho da URL; null = tipo que esta versão não lê (fica para depois). */
export function fonteDaUrl(url: string): TipoDePagina | null {
  if (/\/visualizacaoideia\?/.test(url)) return "detalhe";
  if (/\/pesquisaideia(?:\?|$)/.test(url)) return "listagem";
  return null;
}

/**
 * Versão do leitor: sha dos fontes que decidem os fatos (este arquivo, a fusão, as linhas do índice e
 * os leitores de página com os utilitários que eles usam). Mudou um deles → outra versão → o
 * reprocessador refaz tudo do arquivo, sozinho. Assim nenhuma observação antiga fica com cara de ter
 * sido lida pelo leitor novo. (`ecidadania.ts` muda por outros motivos também; o custo é um
 * reprocessamento completo a mais, nunca uma observação errada.)
 */
export function versaoDoLeitor(): string {
  const h = createHash("sha256");
  const aqui = dirname(fileURLToPath(import.meta.url));
  for (const rel of ["fatos.ts", "fundir.ts", "linhas.ts", "../../src/scraper/ideia-detalhe.ts", "../../src/scraper/ecidadania.ts", "../ingest-ecidadania/ideias-listing.ts", "../ingest-ecidadania/listing.ts"]) {
    // Fim de linha normalizado: o mesmo código dá a mesma versão no Windows (CRLF) e no CI (LF).
    h.update(readFileSync(join(aqui, rel), "utf8").replace(/\r\n/g, "\n"));
  }
  return `observacoes@${h.digest("hex").slice(0, 12)}`;
}
