/**
 * Fase D1 do ROADMAP — tabelas publicadas das ideias (camada 3), geradas da camada 2 (observações)
 * com o corpus do D1 de reserva. Puro: recebe as observações, as linhas do corpus e o first-seen.
 *
 * Decisões do dono (desenho da fase D, 22/11/2026):
 *   1. Valor da camada 2 quando ela já o leu; senão o do corpus, com a origem declarada.
 *   2. Origem e `coletadoEm` por BLOCO de página: o resumo (título, apoios) e o detalhe (o resto).
 *      Campos da mesma página chegam juntos, então a marca é exata numa linha mista.
 *   5. Colunas calculadas ficam, marcadas no dicionário (url, status de 3 valores, firstSeenAt).
 *
 * Bloco RESUMO: a leitura mais recente do arquivo que traz título e apoios — a listagem de qualquer
 * situação ou o detalhe —; `origemResumo` diz qual (`listagem` | `detalhe` | `corpus`).
 * Bloco DETALHE: a leitura de detalhe mais recente que o leitor abriu (HTTP 200 sem `erroLeitura`);
 * um 404/410 posterior não apaga o que a página mostrou antes (o status de 3 valores diz "removida").
 * Leitura = instante: a observação vale na leitura R quando `vistoPrimeiro ≤ R ≤ vistoUltimo` (a fusão
 * da camada 2 só junta leituras SEGUIDAS com o mesmo valor; a ausência fecha a linha).
 *
 * O corpus nunca guardou o nome do autor, a linha do tempo, a data da proposta, a meta, a oficina nem
 * a decisão da CDH: numa ideia cujo detalhe o arquivo ainda não leu, esses campos ficam null.
 */

import type { Observacao } from "../observacoes/fundir.js";
import { agruparPorId, compararIds, contem, int, json, naLeitura, txt, ultimaLeitura } from "./comum.js";

export const URL_DA_IDEIA = "https://www12.senado.leg.br/ecidadania/visualizacaoideia?id=";

export type Origem = "listagem" | "detalhe" | "corpus";

/** Uma linha do `ecidadania_current` das ideias, só com o que a camada 3 usa. */
export interface IdeiaDoCorpus {
  entityId: string;
  scrapedAt: string;
  titulo: string | null;
  apoios: number | null;
  status: string | null;
  /** = prazo de apoios (nome histórico). */
  dataPublicacao: string | null;
  autorUf: string | null;
  descricao: string | null;
  /** "SUG N/AAAA". */
  plConvertido: string | null;
  /** JSON da lista, como gravada; null = nunca lida pelo leitor da 3.21.0. */
  proposicoes: string | null;
}

export interface LinhaIdeia {
  id: string;
  titulo: string | null;
  descricao: string | null;
  status: string | null;
  dataProposta: string | null;
  autorNome: string | null;
  autorUf: string | null;
  oficinaNivel: string | null;
  oficinaDataCadastro: string | null;
  apoios: number | null;
  prazoApoios: string | null;
  data20mil: string | null;
  dataSugestao: string | null;
  sugestaoNumero: number | null;
  sugestaoAno: number | null;
  dataDecisaoCdh: string | null;
  decisaoCdh: string | null;
  /** Legado: = prazoApoios. */
  dataPublicacao: string | null;
  url: string;
  firstSeenAt: string | null;
  origemResumo: Origem | null;
  coletadoEmResumo: string | null;
  origemDetalhe: "arquivo" | "corpus" | null;
  coletadoEmDetalhe: string | null;
}

export interface LinhaProposicao {
  id: string;
  data: string | null;
  transformadaPor: string | null;
  sexo: string | null;
  parlamentar: string | null;
  parlamentarUf: string | null;
  tipoSigla: string | null;
  tipoNome: string | null;
  numero: string | null;
  ano: number | null;
  complemento: string | null;
  url: string | null;
  origem: "arquivo" | "corpus";
}

export interface LinhaAcontecimento {
  id: string;
  /** Ordem na página (0 = o do topo, o mais recente), como o portal mostra. */
  ordem: number;
  data: string | null;
  tipo: string | null;
  texto: string;
}

export interface TabelasDasIdeias {
  ideias: LinhaIdeia[];
  proposicoes: LinhaProposicao[];
  linhaDoTempo: LinhaAcontecimento[];
}

/** "SUG 12/2024" → número e ano; outro formato → nulls (o campo legado teve sobras, retiradas na A6). */
export function sugestaoDoCorpus(pl: string | null): { numero: number | null; ano: number | null } {
  const m = pl ? /^SUG\s+(\d+)\/(\d{4})$/.exec(pl.trim()) : null;
  return m ? { numero: Number(m[1]), ano: Number(m[2]) } : { numero: null, ano: null };
}

interface Resumo {
  titulo: string | null;
  apoios: number | null;
  origem: Origem;
  em: string;
}

/**
 * Título e apoios da leitura mais recente do arquivo que os traz: a listagem de qualquer situação ou o
 * detalhe aberto (`titulo` é emitido por toda leitura aberta das duas).
 */
function resumoDoArquivo(os: readonly Observacao[]): Resumo | null {
  const u = ultimaLeitura(os, () => true, "titulo");
  if (!u) return null;
  const na = naLeitura(os, u.fonte, u.r);
  return { titulo: na.v("titulo"), apoios: int(na.v("apoios")), origem: u.fonte === "detalhe" ? "detalhe" : "listagem", em: u.r };
}

function vazia(id: string, firstSeenAt: string | null): LinhaIdeia {
  return {
    id, titulo: null, descricao: null, status: null, dataProposta: null, autorNome: null, autorUf: null,
    oficinaNivel: null, oficinaDataCadastro: null, apoios: null, prazoApoios: null, data20mil: null,
    dataSugestao: null, sugestaoNumero: null, sugestaoAno: null, dataDecisaoCdh: null, decisaoCdh: null,
    dataPublicacao: null, url: `${URL_DA_IDEIA}${id}`, firstSeenAt,
    origemResumo: null, coletadoEmResumo: null, origemDetalhe: null, coletadoEmDetalhe: null,
  };
}

/**
 * Monta as três tabelas. `obs` = observações das ideias (qualquer ordem); `corpus` = linhas atuais do
 * D1; `firstSeen` = MIN(scraped_at) do history por id. Saída ordenada por id (e ordem/posição).
 */
export function tabelasDasIdeias(
  obs: readonly Observacao[],
  corpus: readonly IdeiaDoCorpus[],
  firstSeen: ReadonlyMap<string, string>,
): TabelasDasIdeias {
  const porId = agruparPorId(obs, "ideias");
  const doCorpus = new Map(corpus.map((c) => [c.entityId, c]));
  const ids = [...new Set([...porId.keys(), ...doCorpus.keys()])].sort(compararIds);

  const ideias: LinhaIdeia[] = [];
  const proposicoes: LinhaProposicao[] = [];
  const linhaDoTempo: LinhaAcontecimento[] = [];

  for (const id of ids) {
    const os = porId.get(id) ?? [];
    const c = doCorpus.get(id);
    const linha = vazia(id, firstSeen.get(id) ?? null);
    linha.status = c?.status ?? null;

    // ── Resumo ────────────────────────────────────────────────────────────────
    const resumo = resumoDoArquivo(os);
    if (resumo) {
      Object.assign(linha, { titulo: resumo.titulo, apoios: resumo.apoios, origemResumo: resumo.origem, coletadoEmResumo: resumo.em });
    } else if (c) {
      Object.assign(linha, { titulo: c.titulo, apoios: c.apoios, origemResumo: "corpus", coletadoEmResumo: c.scrapedAt });
    }

    // ── Detalhe ───────────────────────────────────────────────────────────────
    const det = os.filter((o) => o.fonte === "detalhe");
    // Última leitura de detalhe que o leitor ABRIU: a recusada e o 404/410 não emitem `titulo`.
    const r = ultimaLeitura(det, (f) => f === "detalhe", "titulo")?.r ?? null;
    if (r) {
      const na = det.filter((o) => contem(o, r));
      const v = (campo: string) => na.find((o) => o.campo === campo)?.valor ?? null;
      const sug = json<{ numero: string | number; ano: string | number; data: string | null }>(v("sugestao"));
      const cdh = json<{ data: string | null; resultado: string }>(v("decisaoCdh"));
      const ofi = json<{ nivel: string; dataCadastro: string }>(v("oficina"));
      Object.assign(linha, {
        descricao: v("descricao"), dataProposta: v("dataProposta"), autorNome: v("autorNome"), autorUf: v("autorUf"),
        oficinaNivel: ofi?.nivel ?? null, oficinaDataCadastro: ofi?.dataCadastro ?? null,
        prazoApoios: v("prazoApoios"), dataPublicacao: v("prazoApoios"), data20mil: v("dataMeta"),
        dataSugestao: sug?.data ?? null, sugestaoNumero: int(sug?.numero), sugestaoAno: int(sug?.ano),
        dataDecisaoCdh: cdh?.data ?? null, decisaoCdh: cdh?.resultado ?? null,
        origemDetalhe: "arquivo", coletadoEmDetalhe: r,
      });
      const acont = na
        .filter((o) => o.campo === "acontecimento")
        .map((o) => json<{ posicao: number; data: string | null; tipo: string | null; texto: string }>(o.valor)!);
      const ultimo = acont.length - 1;
      for (const a of acont.sort((x, y) => y.posicao - x.posicao)) {
        linhaDoTempo.push({ id, ordem: ultimo - a.posicao, data: a.data, tipo: a.tipo, texto: a.texto });
      }
      const props = na
        .filter((o) => o.campo === "proposicao")
        .map((o) => json<Record<string, unknown> & { posicao: number }>(o.valor)!)
        .sort((x, y) => x.posicao - y.posicao);
      for (const p of props) proposicoes.push({ id, ...camposDaProposicao(p), origem: "arquivo" });
    } else if (c) {
      const s = sugestaoDoCorpus(c.plConvertido);
      Object.assign(linha, {
        descricao: c.descricao, autorUf: c.autorUf, prazoApoios: c.dataPublicacao, dataPublicacao: c.dataPublicacao,
        sugestaoNumero: s.numero, sugestaoAno: s.ano, origemDetalhe: "corpus", coletadoEmDetalhe: c.scrapedAt,
      });
      // A lista do corpus está na ordem da PÁGINA (mais recente primeiro); publicada do mais antigo.
      const lista = json<Record<string, unknown>[]>(c.proposicoes) ?? [];
      for (const p of [...lista].reverse()) proposicoes.push({ id, ...camposDaProposicao(p), origem: "corpus" });
    }
    ideias.push(linha);
  }
  return { ideias, proposicoes, linhaDoTempo };
}

function camposDaProposicao(p: Record<string, unknown>): Omit<LinhaProposicao, "id" | "origem"> {
  return {
    data: txt(p.data), transformadaPor: txt(p.transformadaPor), sexo: txt(p.sexo), parlamentar: txt(p.parlamentar),
    parlamentarUf: txt(p.parlamentarUf), tipoSigla: txt(p.tipoSigla), tipoNome: txt(p.tipoNome), numero: txt(p.numero),
    ano: int(p.ano as string | number | null), complemento: txt(p.complemento), url: txt(p.url),
  };
}
