/**
 * D1 no job: monta as tabelas publicadas (camada 3) de uma entidade a partir das observações já em
 * memória e do corpus do D1, e as grava no balde das observações, sob `publicacao/<entidade>/` (ou ao
 * lado de `--saida`). Refeitas inteiras a cada run. A edição pública (D2) empacota daqui.
 */

import { writeFileSync } from "node:fs";
import type { ClienteR2 } from "../ingest-ecidadania/r2.js";
import type { Observacao } from "../observacoes/fundir.js";
import { escreverTabela, type ColunaDaTabela } from "../observacoes/parquet.js";
import { tabelasDasConsultas, type LinhaConsulta, type PontoDeVotos } from "./consultas.js";
import {
  lerComentarios, lerConsultasAtuais, lerEventosAtuais, lerFirstSeen, lerIdeiasAtuais, lerVotosNoHistorico, lerVotosUfAtuais,
} from "./corpus-atual.js";
import { tabelasDosEventos, type LinhaComentario, type LinhaEvento, type LinhaItemDoEvento } from "./eventos.js";
import { situacoesAtuais, tabelasDasIdeias, type LinhaAcontecimento, type LinhaIdeia, type LinhaProposicao, type LinhaSituacaoAtual } from "./ideias.js";
import { tabelasDoAcervo, type LinhaMateriaDoAcervo, type LinhaVotosUf } from "./votos-uf.js";

const t = <T>(nome: string, valor: (l: T) => string | null): ColunaDaTabela<T> => ({ nome, tipo: "texto", opcional: true, valor });
const tt = <T>(nome: string, valor: (l: T) => string): ColunaDaTabela<T> => ({ nome, tipo: "texto", valor });
const i = <T>(nome: string, valor: (l: T) => number | null): ColunaDaTabela<T> => ({ nome, tipo: "inteiro", opcional: true, valor });
const d = <T>(nome: string, valor: (l: T) => number | null): ColunaDaTabela<T> => ({ nome, tipo: "decimal", opcional: true, valor });
const ts = <T>(nome: string, valor: (l: T) => string | null): ColunaDaTabela<T> => ({ nome, tipo: "instante", opcional: true, valor });
const id = <T>(nome: string, valor: (l: T) => string): ColunaDaTabela<T> => ({ nome, tipo: "inteiro", valor: (l) => Number(valor(l)) });

/** Origem e coletadoEm de cada bloco de página (decisão 2 da fase D). */
const origens = <T>(...blocos: string[]): ColunaDaTabela<T>[] => {
  const campo = (l: T, k: string) => (l as unknown as Record<string, string | null>)[k];
  return blocos.flatMap((b) => [t<T>(`origem${b}`, (l) => campo(l, `origem${b}`)), ts<T>(`coletadoEm${b}`, (l) => campo(l, `coletadoEm${b}`))]);
};

export const COLUNAS_IDEIAS: ColunaDaTabela<LinhaIdeia>[] = [
  id("id", (l) => l.id), t("titulo", (l) => l.titulo), t("descricao", (l) => l.descricao), t("status", (l) => l.status),
  t("dataProposta", (l) => l.dataProposta), t("autorNome", (l) => l.autorNome), t("autorUf", (l) => l.autorUf),
  t("oficinaNivel", (l) => l.oficinaNivel), t("oficinaDataCadastro", (l) => l.oficinaDataCadastro), i("apoios", (l) => l.apoios),
  t("prazoApoios", (l) => l.prazoApoios), t("data20mil", (l) => l.data20mil), t("dataSugestao", (l) => l.dataSugestao),
  i("sugestaoNumero", (l) => l.sugestaoNumero), i("sugestaoAno", (l) => l.sugestaoAno), t("dataDecisaoCdh", (l) => l.dataDecisaoCdh),
  t("decisaoCdh", (l) => l.decisaoCdh), t("dataPublicacao", (l) => l.dataPublicacao), tt("url", (l) => l.url), ts("firstSeenAt", (l) => l.firstSeenAt),
  ...origens<LinhaIdeia>("Resumo", "Detalhe"),
];

export const COLUNAS_PROPOSICOES: ColunaDaTabela<LinhaProposicao>[] = [
  id("id", (l) => l.id), t("data", (l) => l.data), t("transformadaPor", (l) => l.transformadaPor), t("sexo", (l) => l.sexo),
  t("parlamentar", (l) => l.parlamentar), t("parlamentarUf", (l) => l.parlamentarUf), t("tipoSigla", (l) => l.tipoSigla),
  t("tipoNome", (l) => l.tipoNome), t("numero", (l) => l.numero), i("ano", (l) => l.ano), t("complemento", (l) => l.complemento),
  t("url", (l) => l.url), tt("origem", (l) => l.origem),
];

export const COLUNAS_LINHA_DO_TEMPO: ColunaDaTabela<LinhaAcontecimento>[] = [
  id("id", (l) => l.id), { nome: "ordem", tipo: "inteiro", valor: (l) => l.ordem }, t("data", (l) => l.data), t("tipo", (l) => l.tipo), tt("texto", (l) => l.texto),
];

export const COLUNAS_SITUACOES_ATUAIS: ColunaDaTabela<LinhaSituacaoAtual>[] = [
  id("id", (l) => l.id), tt("situacaoCodigo", (l) => l.situacaoCodigo), t("situacaoNome", (l) => l.situacaoNome),
  { nome: "vistaEm", tipo: "instante", valor: (l) => l.vistaEm },
];

export const COLUNAS_CONSULTAS: ColunaDaTabela<LinhaConsulta>[] = [
  id("id", (l) => l.id), t("materia", (l) => l.materia), t("ementa", (l) => l.ementa), i("votosSim", (l) => l.votosSim), i("votosNao", (l) => l.votosNao),
  i("totalVotos", (l) => l.totalVotos), d("percentualSim", (l) => l.percentualSim), d("percentualNao", (l) => l.percentualNao),
  t("autoria", (l) => l.autoria), t("relator", (l) => l.relator), t("status", (l) => l.status), tt("url", (l) => l.url), ts("firstSeenAt", (l) => l.firstSeenAt),
  ...origens<LinhaConsulta>("Resumo", "Detalhe"),
];

export const COLUNAS_SERIE_VOTOS: ColunaDaTabela<PontoDeVotos>[] = [
  id("id", (l) => l.id), tt("voto", (l) => l.voto), i("votos", (l) => l.votos), { nome: "desde", tipo: "instante", valor: (l) => l.desde },
  { nome: "ate", tipo: "instante", valor: (l) => l.ate }, { nome: "leituras", tipo: "inteiro", valor: (l) => l.leituras }, t("sha", (l) => l.sha), tt("origem", (l) => l.origem),
];

export const COLUNAS_EVENTOS: ColunaDaTabela<LinhaEvento>[] = [
  id("id", (l) => l.id), t("titulo", (l) => l.titulo), t("data", (l) => l.data), t("hora", (l) => l.hora), t("comissao", (l) => l.comissao),
  t("comissaoNomeCompleto", (l) => l.comissaoNomeCompleto), t("local", (l) => l.local), t("descricao", (l) => l.descricao), t("videoUrl", (l) => l.videoUrl),
  i("comentarios", (l) => l.comentarios), t("status", (l) => l.status), tt("url", (l) => l.url), ts("firstSeenAt", (l) => l.firstSeenAt),
  ...origens<LinhaEvento>("Resumo", "Detalhe", "Comentarios"),
];

export const COLUNAS_ITENS_DO_EVENTO: ColunaDaTabela<LinhaItemDoEvento>[] = [
  id("id", (l) => l.id), { nome: "ordem", tipo: "inteiro", valor: (l) => l.ordem }, tt("texto", (l) => l.texto), tt("origem", (l) => l.origem),
];

export const COLUNAS_COMENTARIOS: ColunaDaTabela<LinhaComentario>[] = [
  id("eventoId", (l) => l.eventoId), id("comentarioId", (l) => l.comentarioId), t("uf", (l) => l.uf), t("data", (l) => l.data), t("hora", (l) => l.hora),
  t("texto", (l) => l.texto), t("momentoVideoUrl", (l) => l.momentoVideoUrl), t("convidadoAssociado", (l) => l.convidadoAssociado), tt("origem", (l) => l.origem),
];

export const COLUNAS_MATERIAS_DO_ACERVO: ColunaDaTabela<LinhaMateriaDoAcervo>[] = [
  id("codigo", (l) => l.codigo), t("materia", (l) => l.materia), t("ementa", (l) => l.ementa), t("autoria", (l) => l.autoria),
  t("status", (l) => l.status), t("referencePeriod", (l) => l.referencePeriod), i("votosSim", (l) => l.votosSim), i("votosNao", (l) => l.votosNao),
  i("totalVotos", (l) => l.totalVotos), tt("url", (l) => l.url), tt("origem", (l) => l.origem),
  { nome: "coletadoEm", tipo: "instante", valor: (l) => l.coletadoEm },
];

export const COLUNAS_VOTOS_UF: ColunaDaTabela<LinhaVotosUf>[] = [
  id("codigo", (l) => l.codigo), tt("uf", (l) => l.uf), i("sim", (l) => l.sim), i("nao", (l) => l.nao),
  { nome: "desde", tipo: "instante", valor: (l) => l.desde }, { nome: "ate", tipo: "instante", valor: (l) => l.ate },
  { nome: "leituras", tipo: "inteiro", valor: (l) => l.leituras }, t("sha", (l) => l.sha), tt("origem", (l) => l.origem),
];

export type EntidadePublicada = "ideias" | "consultas" | "eventos" | "consultas_votos";

interface Tabela {
  nome: string;
  bytes: Uint8Array;
  linhas: number;
}

const tabela = <T>(nome: string, linhas: readonly T[], colunas: readonly ColunaDaTabela<T>[], kv: Record<string, string>): Tabela => ({
  nome, bytes: escreverTabela(linhas, colunas, kv), linhas: linhas.length,
});

/** Contagem por valor de uma coluna, para o log ("listagem 110102, corpus 3"). */
function contar<T>(xs: readonly T[], f: (x: T) => unknown): string {
  const m = new Map<string, number>();
  for (const x of xs) m.set(String(f(x)), (m.get(String(f(x))) ?? 0) + 1);
  return [...m].map(([v, n]) => `${v} ${n}`).join(", ");
}

/** Monta as tabelas da entidade (lê o corpus do D1). Devolve as tabelas e um resumo para o log. */
function montar(entidade: EntidadePublicada, obs: readonly Observacao[], kv: Record<string, string>): { tabelas: Tabela[]; resumo: string } {
  if (entidade === "ideias") {
    const r = tabelasDasIdeias(obs, lerIdeiasAtuais(), lerFirstSeen("ideias"));
    return {
      tabelas: [
        tabela("ideias", r.ideias, COLUNAS_IDEIAS, kv), tabela("proposicoes", r.proposicoes, COLUNAS_PROPOSICOES, kv),
        tabela("linha-do-tempo", r.linhaDoTempo, COLUNAS_LINHA_DO_TEMPO, kv),
        tabela("situacoes-portal", situacoesAtuais(obs), COLUNAS_SITUACOES_ATUAIS, kv),
      ],
      resumo: `resumo: ${contar(r.ideias, (x) => x.origemResumo)}; detalhe: ${contar(r.ideias, (x) => x.origemDetalhe)}`,
    };
  }
  if (entidade === "consultas") {
    const r = tabelasDasConsultas(obs, lerConsultasAtuais(), lerVotosNoHistorico(), lerFirstSeen("consultas"));
    return {
      tabelas: [tabela("consultas", r.consultas, COLUNAS_CONSULTAS, kv), tabela("serie-votos", r.serieVotos, COLUNAS_SERIE_VOTOS, kv)],
      resumo: `resumo: ${contar(r.consultas, (x) => x.origemResumo)}; detalhe: ${contar(r.consultas, (x) => x.origemDetalhe)}; série: ${contar(r.serieVotos, (x) => x.origem)}`,
    };
  }
  if (entidade === "eventos") {
    const r = tabelasDosEventos(obs, lerEventosAtuais(), lerComentarios(), lerFirstSeen("eventos"));
    return {
      tabelas: [
        tabela("eventos", r.eventos, COLUNAS_EVENTOS, kv), tabela("pauta", r.pauta, COLUNAS_ITENS_DO_EVENTO, kv),
        tabela("convidados", r.convidados, COLUNAS_ITENS_DO_EVENTO, kv), tabela("comentarios", r.comentarios, COLUNAS_COMENTARIOS, kv),
      ],
      resumo: `resumo: ${contar(r.eventos, (x) => x.origemResumo)}; detalhe: ${contar(r.eventos, (x) => x.origemDetalhe)}; comentários: ${contar(r.eventos, (x) => x.origemComentarios)}`,
    };
  }
  const r = tabelasDoAcervo(obs, lerVotosUfAtuais());
  return {
    tabelas: [tabela("materias", r.materias, COLUNAS_MATERIAS_DO_ACERVO, kv), tabela("votos-uf", r.votosUf, COLUNAS_VOTOS_UF, kv)],
    resumo: `matérias: ${contar(r.materias, (x) => x.origem)}; votos por UF: ${contar(r.votosUf, (x) => x.origem)}`,
  };
}

export async function gravarPublicacao(entidade: EntidadePublicada, o: { obs: readonly Observacao[]; leitor: string; cursor: number; balde: ClienteR2; saida?: string }): Promise<void> {
  const kv = { entidade, leitor: o.leitor, cursor: String(o.cursor), geradoEm: new Date().toISOString() };
  const { tabelas, resumo } = montar(entidade, o.obs, kv);
  for (const tb of tabelas) {
    if (o.saida) writeFileSync(`${o.saida.replace(/\.parquet$/, "")}-pub-${entidade}-${tb.nome}.parquet`, tb.bytes);
    else await o.balde.gravar(`publicacao/${entidade}/${tb.nome}.parquet`, tb.bytes, { "content-type": "application/vnd.apache.parquet" });
  }
  console.log(
    `[observacoes][publicacao][${entidade}] ${tabelas.map((tb) => `${tb.nome} ${tb.linhas} (${(tb.bytes.length / 1048576).toFixed(2)} MB)`).join(", ")}; ${resumo}`,
  );
}
