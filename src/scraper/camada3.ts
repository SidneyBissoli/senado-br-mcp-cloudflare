/**
 * D3 — o servidor lê a camada 3 (as tabelas publicadas do dataset 3.0.0, projetadas no D1 pelo job das
 * observações; nomes em `camada3-tabelas.ts`). Decisões do dono de 22/11/2026 (ROADMAP, item D3):
 *
 *   1. as ferramentas consultam a cópia no D1 por SQL;
 *   2. as séries no tempo entram no `obter_ideia` (apoios, situação) e no `obter_consulta` (votos SIM/NÃO),
 *      só os pontos de mudança, com teto e aviso de corte — nenhuma ferramenta nova;
 *   3. SEMPRE as tabelas novas (MCP = dataset em todo item): o corpus só responde por item que ainda não
 *      entrou na camada 3, com a origem marcada; toda resposta diz de onde e de quando veio cada bloco
 *      (`origem<Bloco>` / `coletadoEm<Bloco>`, os mesmos nomes do dicionário).
 *
 * Tudo aqui devolve `null` quando a camada 3 não está no banco (tabela ainda não criada, cópia vazia,
 * D1 ausente no canal stdio): quem chama cai no caminho de antes (corpus / leitura ao vivo). Os campos
 * de saída das ferramentas não mudam de nome nem perdem a não-nulidade que tinham; os da camada 3 entram
 * ao lado.
 *
 * As funções de mapeamento são puras e exportadas para os testes; as de leitura só montam SQL estático
 * com parâmetros ligados (`?`).
 */

import { tabelaC3, TABELA_CONTROLE_C3 } from "./camada3-tabelas.js";
import {
  type ConsultaResumo,
  type ConsultaVotoResumo,
  type EventoResumo,
  type IdeiaResumo,
  type VotosPorUf,
} from "./ecidadania.js";
import { isoDeDataExtenso, type Acontecimento, type IdeiaDetalhe, type ProposicaoDaIdeia, type TipoAcontecimento } from "./ideia-detalhe.js";

// ── Tipos das linhas (colunas do dicionário 3.0.0) ────────────────────────────────────────────────

type Txt = string | null;
type Num = number | null;

export interface OrigensDoBloco {
  origemResumo?: Txt;
  coletadoEmResumo?: Txt;
  origemDetalhe?: Txt;
  coletadoEmDetalhe?: Txt;
  origemComentarios?: Txt;
  coletadoEmComentarios?: Txt;
}

export interface LinhaIdeiaC3 extends OrigensDoBloco {
  id: number; titulo: Txt; descricao: Txt; status: Txt; dataProposta: Txt; autorNome: Txt; autorUf: Txt;
  oficinaNivel: Txt; oficinaDataCadastro: Txt; apoios: Num; prazoApoios: Txt; data20mil: Txt; dataSugestao: Txt;
  sugestaoNumero: Num; sugestaoAno: Num; dataDecisaoCdh: Txt; decisaoCdh: Txt; dataPublicacao: Txt; url: string; firstSeenAt: Txt;
}

export interface LinhaProposicaoC3 {
  id: number; data: Txt; transformadaPor: Txt; sexo: Txt; parlamentar: Txt; parlamentarUf: Txt; tipoSigla: Txt;
  tipoNome: Txt; numero: Txt; ano: Num; complemento: Txt; url: Txt; origem: string;
}

export interface LinhaAcontecimentoC3 { id: number; ordem: number; data: Txt; tipo: Txt; texto: string }

export interface PontoApoiosC3 { entity_id: string; origem: string; apoios: Num; desde: string; ate: string; leituras: number }

export interface PontoSituacaoC3 {
  entity_id: string; origem: string; situacao_codigo: Txt; situacao_nome: Txt; status: Txt; desde: string; ate: string; leituras: number;
}

export interface LinhaConsultaC3 extends OrigensDoBloco {
  id: number; materia: Txt; ementa: Txt; votosSim: Num; votosNao: Num; totalVotos: Num; percentualSim: Num; percentualNao: Num;
  autoria: Txt; relator: Txt; status: Txt; url: string; firstSeenAt: Txt;
}

export interface PontoVotosC3 { id: number; voto: "SIM" | "NAO"; votos: Num; desde: string; ate: string; leituras: number; origem: string }

export interface LinhaEventoC3 extends OrigensDoBloco {
  id: number; titulo: Txt; data: Txt; hora: Txt; comissao: Txt; comissaoNomeCompleto: Txt; local: Txt; descricao: Txt;
  videoUrl: Txt; comentarios: Num; status: Txt; url: string; firstSeenAt: Txt;
}

export interface ItemDoEventoC3 { id: number; ordem: number; texto: string; origem: string }

export interface LinhaMateriaC3 {
  codigo: number; materia: Txt; ementa: Txt; autoria: Txt; status: Txt; referencePeriod: Txt; votosSim: Num; votosNao: Num;
  totalVotos: Num; url: string; origem: string; coletadoEm: string;
}

export interface VotosUfC3 { codigo: number; uf: string; sim: Num; nao: Num; desde: string; ate: string }

// ── Proveniência da cópia ─────────────────────────────────────────────────────────────────────────

/** De onde e de quando veio a lista/o item: a cópia da camada 3 e o instante em que ela foi gerada. */
export interface MetaC3 {
  fonte: "camada3";
  /** Instante mais antigo em que as tabelas lidas foram geradas pelo job (o "dado de quando"). */
  lastScrapedAt: string | null;
  possivelDesatualizacao: boolean;
  motivo?: string;
  /** Itens que ainda não entraram na camada 3 e vieram do corpus (origem marcada em cada um). */
  itensDoCorpus?: number;
}

/** As colunas de origem de uma linha, na ordem do dicionário (só as que a linha tem). */
export function origensDa(l: OrigensDoBloco): OrigensDoBloco {
  const o: OrigensDoBloco = {};
  for (const k of ["origemResumo", "coletadoEmResumo", "origemDetalhe", "coletadoEmDetalhe", "origemComentarios", "coletadoEmComentarios"] as const) {
    if (k in l) o[k] = l[k] ?? null;
  }
  return o;
}

/** Item do corpus que ainda não entrou na camada 3: os blocos vêm do corpus, lidos em `scraped_at`. */
export function origensDoCorpus(scrapedAt: string, blocos: readonly ("Resumo" | "Detalhe" | "Comentarios")[]): OrigensDoBloco {
  const o: Record<string, string> = {};
  for (const b of blocos) {
    o[`origem${b}`] = "corpus";
    o[`coletadoEm${b}`] = scrapedAt;
  }
  return o as OrigensDoBloco;
}

// ── Mapeamentos puros: camada 3 → campos que as ferramentas já devolvem ───────────────────────────

const pct = (n: Num): number => n ?? 0;

/** Consulta da camada 3 no formato da lista (`ConsultaResumo`) + origens. Percentual com uma casa (dataset). */
export function consultaDaC3(l: LinhaConsultaC3): ConsultaResumo & OrigensDoBloco {
  return {
    id: l.id, materia: l.materia ?? "", ementa: l.ementa ?? "",
    votosSim: l.votosSim ?? 0, votosNao: l.votosNao ?? 0, totalVotos: l.totalVotos ?? 0,
    percentualSim: pct(l.percentualSim), percentualNao: pct(l.percentualNao),
    autoria: l.autoria, relator: l.relator, status: l.status ?? "aberta", url: l.url,
    ...origensDa(l),
  };
}

export const sugestaoComoTexto = (numero: Num, ano: Num): string | null => (numero !== null && ano !== null ? `SUG ${numero}/${ano}` : null);

/** Proposição da camada 3 no formato do leitor (`ProposicaoDaIdeia`); `ordem` = posição na linha do tempo. */
export function proposicaoDaC3(p: LinhaProposicaoC3, ordem: number | null): ProposicaoDaIdeia {
  return {
    ordem: ordem as number,
    data: p.data,
    transformadaPor: p.transformadaPor as ProposicaoDaIdeia["transformadaPor"],
    sexo: p.sexo as ProposicaoDaIdeia["sexo"],
    parlamentar: p.parlamentar, parlamentarUf: p.parlamentarUf, tipoSigla: p.tipoSigla, tipoNome: p.tipoNome ?? "",
    numero: p.numero === null ? (null as unknown as number) : Number(p.numero), ano: p.ano as number, complemento: p.complemento, url: p.url,
  };
}

const TIPOS_DE_PROPOSICAO = new Set(["cdhTransformou", "adocao", "transformadaEm"]);

/**
 * Proposições do arquivo com a posição na linha do tempo: cada uma nasce de um acontecimento de
 * transformação (`lerItem`), e as duas listas estão na mesma ordem (proposições do mais antigo; a linha
 * do tempo com 0 = o mais recente). Devolve na ordem da PÁGINA (mais recente primeiro), como o leitor.
 * Contagens diferentes = não casa (ordem null), nunca chute.
 */
export function proposicoesComOrdem(props: readonly LinhaProposicaoC3[], linha: readonly LinhaAcontecimentoC3[]): ProposicaoDaIdeia[] {
  const eventos = linha.filter((a) => a.tipo !== null && TIPOS_DE_PROPOSICAO.has(a.tipo)).sort((a, b) => b.ordem - a.ordem);
  const casa = eventos.length === props.length;
  return props.map((p, i) => proposicaoDaC3(p, casa ? eventos[i].ordem : null)).reverse();
}

/** Ideia da camada 3 no formato da lista (`IdeiaResumo`) + origens. `proposicoes` ausente = detalhe nunca lido. */
export function ideiaDaC3(l: LinhaIdeiaC3, proposicoes?: ProposicaoDaIdeia[]): IdeiaResumo & OrigensDoBloco {
  const item: IdeiaResumo & OrigensDoBloco = {
    id: l.id, titulo: l.titulo ?? "", apoios: l.apoios ?? 0,
    dataPublicacao: l.dataPublicacao, autorUf: l.autorUf, descricao: l.descricao,
    plConvertido: sugestaoComoTexto(l.sugestaoNumero, l.sugestaoAno),
    status: l.status ?? "aberta", url: l.url,
  };
  if (l.origemDetalhe) item.proposicoes = proposicoes ?? [];
  // `proposicoes` antes do status/url no leitor antigo; a ordem dos campos não é contrato da saída.
  return { ...item, ...origensDa(l) };
}

/** Evento da camada 3 no formato da lista (`EventoResumo`, sem pauta/convidados) + origens. */
export function eventoDaC3(l: LinhaEventoC3): Omit<EventoResumo, "pauta" | "convidados"> & OrigensDoBloco {
  return {
    id: l.id, titulo: l.titulo ?? "", data: l.data, hora: l.hora, comissao: l.comissao,
    comissaoNomeCompleto: l.comissaoNomeCompleto, local: l.local, descricao: l.descricao, videoUrl: l.videoUrl,
    comentarios: l.comentarios ?? 0, status: l.status ?? "agendado", url: l.url,
    ...origensDa(l),
  };
}

/** Votos por UF da versão mais recente do CSV (a linha de maior `desde` por matéria × UF). */
export function votosPorUfDaC3(linhas: readonly VotosUfC3[]): Map<number, VotosPorUf> {
  const ultima = new Map<string, VotosUfC3>();
  for (const l of linhas) {
    const k = `${l.codigo}|${l.uf}`;
    const a = ultima.get(k);
    if (!a || l.desde > a.desde) ultima.set(k, l);
  }
  const out = new Map<number, VotosPorUf>();
  for (const l of [...ultima.values()].sort((a, b) => (a.uf < b.uf ? -1 : a.uf > b.uf ? 1 : 0))) {
    if (l.sim === null || l.nao === null) continue;
    const m = out.get(l.codigo) ?? {};
    m[l.uf] = { sim: l.sim, nao: l.nao };
    out.set(l.codigo, m);
  }
  return out;
}

export function materiaDaC3(l: LinhaMateriaC3, votosPorUf: VotosPorUf): ConsultaVotoResumo & { origem: string; coletadoEm: string } {
  return {
    id: l.codigo, materia: l.materia ?? "", ementa: l.ementa ?? "", autoria: l.autoria ?? "", status: l.status ?? "",
    votosSim: l.votosSim ?? 0, votosNao: l.votosNao ?? 0, totalVotos: l.totalVotos ?? 0, votosPorUf, url: l.url,
    referencePeriod: l.referencePeriod, origem: l.origem, coletadoEm: l.coletadoEm,
  };
}

// ── Séries: só os pontos de mudança, com teto ─────────────────────────────────────────────────────

/** Pontos mostrados por série; a série inteira está no dataset. */
export const TETO_SERIE = 60;

/** Os `teto` pontos mais recentes e o aviso de corte (null = não cortou). */
export function cortar<T>(pontos: readonly T[], teto: number, oQue: string, tabela: string): { pontos: T[]; aviso: string | null } {
  if (pontos.length <= teto) return { pontos: [...pontos], aviso: null };
  return {
    pontos: pontos.slice(pontos.length - teto),
    aviso: `${oQue}: ${pontos.length} pontos de mudança; mostrando os ${teto} mais recentes (a série inteira está no dataset, tabela ${tabela}).`,
  };
}

const porDesde = <T extends { desde: string; ate: string }>(a: T, b: T) => (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : a.ate < b.ate ? -1 : a.ate > b.ate ? 1 : 0);

export interface PontoDeApoios { apoios: number | null; desde: string; ate: string; origem: string }

/**
 * Apoios no tempo, das séries do arquivo (listagem de cada situação, detalhe) e do corpus, juntas em
 * ordem de `desde`: um ponto novo só quando o valor muda; enquanto não muda, o ponto estende o `ate`.
 */
export function pontosDeApoios(linhas: readonly PontoApoiosC3[]): PontoDeApoios[] {
  const out: PontoDeApoios[] = [];
  for (const l of [...linhas].sort(porDesde)) {
    const u = out[out.length - 1];
    if (u && u.apoios === l.apoios) {
      if (l.ate > u.ate) u.ate = l.ate;
      continue;
    }
    out.push({ apoios: l.apoios, desde: l.desde, ate: l.ate, origem: l.origem });
  }
  return out;
}

export interface SituacaoNoPortal { codigo: string | null; nome: string | null; desde: string; ate: string }
export interface StatusNoCorpus { status: string | null; desde: string }

/** Situação no tempo, nas duas origens que não se misturam (dicionário, `ideias/historico-situacao`). */
export function situacoesNoTempo(linhas: readonly PontoSituacaoC3[]): { portal: SituacaoNoPortal[]; corpus: StatusNoCorpus[] } {
  const ord = [...linhas].sort(porDesde);
  const portal = ord.filter((l) => l.origem !== "corpus").map((l) => ({ codigo: l.situacao_codigo, nome: l.situacao_nome, desde: l.desde, ate: l.ate }));
  const corpus: StatusNoCorpus[] = [];
  for (const l of ord.filter((x) => x.origem === "corpus")) {
    if (corpus.length && corpus[corpus.length - 1].status === l.status) continue;
    corpus.push({ status: l.status, desde: l.desde });
  }
  return { portal, corpus };
}

export interface PontoDeVotos { em: string; votosSim: number | null; votosNao: number | null; origem: string }

/**
 * Votos SIM/NÃO no tempo, em pares: a cada instante em que um dos dois muda (em qualquer origem), o par
 * vigente — o último valor de cada voto visto até ali. Um ponto só quando o par muda.
 */
export function pontosDeVotos(linhas: readonly PontoVotosC3[]): PontoDeVotos[] {
  const ord = [...linhas].sort(porDesde);
  const out: PontoDeVotos[] = [];
  let sim: number | null = null;
  let nao: number | null = null;
  for (const l of ord) {
    if (l.voto === "SIM") sim = l.votos;
    else nao = l.votos;
    const u = out[out.length - 1];
    if (u && u.votosSim === sim && u.votosNao === nao) continue;
    if (u && u.em === l.desde) Object.assign(u, { votosSim: sim, votosNao: nao, origem: l.origem });
    else out.push({ em: l.desde, votosSim: sim, votosNao: nao, origem: l.origem });
  }
  return out;
}

// ── Detalhe da ideia (obter_ideia) a partir da camada 3 ───────────────────────────────────────────

const RE_META = /^Ideia alcançou ([\d.]+) apoios$/;
const RE_ENCERRAMENTO = /^Período de apoio encerrado Esta ideia recebeu (\d+) apoios e não alcançou a meta dentro do prazo\. O período terminou em (.+?)\.$/;

/**
 * Os campos estruturados do leitor (`IdeiaDetalhe`) a partir das colunas e da linha do tempo da camada 3.
 * O que a camada 3 não guarda fica null (o link da Sugestão); `meta` e `encerramento` saem do texto do
 * acontecimento, com as mesmas expressões do leitor.
 */
export function detalheDaC3(l: LinhaIdeiaC3, linha: readonly LinhaAcontecimentoC3[], proposicoes: ProposicaoDaIdeia[]): IdeiaDetalhe {
  const linhaDoTempo: Acontecimento[] = [...linha]
    .sort((a, b) => a.ordem - b.ordem)
    .map((a) => ({ ordem: a.ordem, data: a.data, ativo: a.ordem === 0, tipo: (a.tipo ?? "naoReconhecido") as TipoAcontecimento, texto: a.texto }));
  const meta = linhaDoTempo.map((a) => RE_META.exec(a.texto)).find(Boolean);
  const enc = linhaDoTempo.find((a) => a.tipo === "prazoEncerrado");
  const encM = enc ? RE_ENCERRAMENTO.exec(enc.texto) : null;
  let encerramento: IdeiaDetalhe["encerramento"] = null;
  if (enc && encM) {
    try {
      encerramento = { data: enc.data, apoios: Number(encM[1]), terminouEm: isoDeDataExtenso(encM[2], "camada 3") };
    } catch {
      encerramento = null;
    }
  }
  const ref = l.sugestaoNumero !== null && l.sugestaoAno !== null ? { numero: l.sugestaoNumero, ano: l.sugestaoAno } : null;
  return {
    titulo: l.titulo ?? "",
    descricao: l.descricao,
    apoios: l.apoios,
    autorNome: l.autorNome,
    autorUf: l.autorUf,
    dataProposta: l.dataProposta,
    prazoApoios: l.prazoApoios,
    dataMeta: l.data20mil,
    meta: meta ? Number(meta[1].replace(/\./g, "")) : null,
    sugestao: ref ? { ...ref, data: l.dataSugestao, url: null } : null,
    decisaoCdh: l.decisaoCdh && ref ? { data: l.dataDecisaoCdh, resultado: l.decisaoCdh as "transformou" | "não transformou", sugestao: ref } : null,
    encerramento,
    oficina: l.oficinaNivel ? { nivel: l.oficinaNivel, dataCadastro: l.oficinaDataCadastro ?? "" } : null,
    proposicoes,
    linhaDoTempo,
    avisos: linhaDoTempo
      .filter((a) => a.tipo === "naoReconhecido")
      .map((a) => `acontecimento não reconhecido no item ${a.ordem} (${a.data ?? "sem data"}): "${a.texto.slice(0, 120)}"`),
  };
}

// ── Leitura no D1 ─────────────────────────────────────────────────────────────────────────────────

const T = {
  ideias: tabelaC3("ideias/ideias"),
  proposicoes: tabelaC3("ideias/proposicoes"),
  linhaDoTempo: tabelaC3("ideias/linha-do-tempo"),
  serieApoios: tabelaC3("ideias/serie-apoios"),
  situacao: tabelaC3("ideias/historico-situacao"),
  consultas: tabelaC3("consultas/consultas"),
  serieVotos: tabelaC3("consultas/serie-votos"),
  eventos: tabelaC3("eventos/eventos"),
  pauta: tabelaC3("eventos/pauta"),
  convidados: tabelaC3("eventos/convidados"),
  materias: tabelaC3("consultas_votos/materias"),
  votosUf: tabelaC3("consultas_votos/votos-uf"),
};

// Colunas listadas à mão (a `chave` interna nunca sai); o teste confere contra o dicionário.
export const COLS_IDEIA =
  "id, titulo, descricao, status, dataProposta, autorNome, autorUf, oficinaNivel, oficinaDataCadastro, apoios, prazoApoios, data20mil, " +
  "dataSugestao, sugestaoNumero, sugestaoAno, dataDecisaoCdh, decisaoCdh, dataPublicacao, url, firstSeenAt, " +
  "origemResumo, coletadoEmResumo, origemDetalhe, coletadoEmDetalhe";
export const COLS_CONSULTA =
  "id, materia, ementa, votosSim, votosNao, totalVotos, percentualSim, percentualNao, autoria, relator, status, url, firstSeenAt, " +
  "origemResumo, coletadoEmResumo, origemDetalhe, coletadoEmDetalhe";
export const COLS_EVENTO =
  "id, titulo, data, hora, comissao, comissaoNomeCompleto, local, descricao, videoUrl, comentarios, status, url, firstSeenAt, " +
  "origemResumo, coletadoEmResumo, origemDetalhe, coletadoEmDetalhe, origemComentarios, coletadoEmComentarios";
const COLS_PROPOSICAO = "id, data, transformadaPor, sexo, parlamentar, parlamentarUf, tipoSigla, tipoNome, numero, ano, complemento, url, origem";

/**
 * Quando as tabelas foram geradas (o mais antigo) e se a cópia vale: todas presentes e com linhas.
 * Null = a camada 3 não está no banco (ou a leitura falhou) → o chamador usa o caminho de antes.
 */
export async function metaDaC3(db: D1Database | undefined, tabelas: readonly string[], staleMaxMin: number, now = new Date()): Promise<MetaC3 | null> {
  if (!db) return null;
  try {
    const marcas = tabelas.map(() => "?").join(",");
    const rs = await db
      .prepare(`SELECT tabela, gerado_em, linhas FROM ${TABELA_CONTROLE_C3} WHERE tabela IN (${marcas})`)
      .bind(...tabelas)
      .all<{ tabela: string; gerado_em: string | null; linhas: number }>();
    const linhas = rs.results ?? [];
    if (linhas.length !== tabelas.length || linhas.some((l) => !l.linhas)) return null;
    const geradoEm = linhas.map((l) => l.gerado_em ?? "").sort()[0] || null;
    const idadeMin = geradoEm ? (now.getTime() - new Date(geradoEm).getTime()) / 60000 : Infinity;
    const velha = idadeMin > staleMaxMin;
    return { fonte: "camada3", lastScrapedAt: geradoEm, possivelDesatualizacao: velha, ...(velha ? { motivo: "camada3-desatualizada" } : {}) };
  } catch {
    return null;
  }
}

/** Linhas do corpus de uma entidade que ainda não entraram na camada 3 (payload + instante). */
async function doCorpusForaDaC3(db: D1Database, entidade: string, tabela: string, idCol: string): Promise<Array<{ payload: Record<string, unknown>; scrapedAt: string }>> {
  const rs = await db
    .prepare(`SELECT scraped_at, payload_json FROM ecidadania_current WHERE entidade = ? AND entity_id NOT IN (SELECT ${idCol} FROM ${tabela})`)
    .bind(entidade)
    .all<{ scraped_at: string; payload_json: string }>();
  return (rs.results ?? []).map((r) => ({ payload: JSON.parse(r.payload_json) as Record<string, unknown>, scrapedAt: r.scraped_at }));
}

export interface ListaC3<T> {
  items: T[];
  meta: MetaC3;
}

/** Todas as consultas: camada 3 + as do corpus que ainda não entraram (origem marcada). */
export async function consultasDaC3(db: D1Database | undefined, staleMaxMin: number): Promise<ListaC3<ConsultaResumo & OrigensDoBloco> | null> {
  const meta = await metaDaC3(db, [T.consultas], staleMaxMin);
  if (!meta || !db) return null;
  try {
    const rs = await db.prepare(`SELECT ${COLS_CONSULTA} FROM ${T.consultas} ORDER BY id DESC`).all<LinhaConsultaC3>();
    const extras = await doCorpusForaDaC3(db, "consultas", T.consultas, "id");
    const items = [
      ...extras.map((e) => ({ ...(e.payload as unknown as ConsultaResumo), ...origensDoCorpus(e.scrapedAt, ["Resumo", "Detalhe"]) })),
      ...(rs.results ?? []).map(consultaDaC3),
    ];
    return { items, meta: { ...meta, itensDoCorpus: extras.length } };
  } catch {
    return null;
  }
}

/** Todos os eventos (sem pauta/convidados): camada 3 + os do corpus que ainda não entraram. */
export async function eventosDaC3(db: D1Database | undefined, staleMaxMin: number): Promise<ListaC3<Omit<EventoResumo, "pauta" | "convidados"> & OrigensDoBloco> | null> {
  const meta = await metaDaC3(db, [T.eventos], staleMaxMin);
  if (!meta || !db) return null;
  try {
    const rs = await db.prepare(`SELECT ${COLS_EVENTO} FROM ${T.eventos} ORDER BY id DESC`).all<LinhaEventoC3>();
    const extras = await doCorpusForaDaC3(db, "eventos", T.eventos, "id");
    const items = [
      ...extras.map((e) => {
        const { pauta: _p, convidados: _c, ...resto } = e.payload as unknown as EventoResumo;
        return { ...resto, ...origensDoCorpus(e.scrapedAt, ["Resumo", "Detalhe", "Comentarios"]) };
      }),
      ...(rs.results ?? []).map(eventoDaC3),
    ];
    return { items, meta: { ...meta, itensDoCorpus: extras.length } };
  } catch {
    return null;
  }
}

export type MateriaDoAcervo = ConsultaVotoResumo & { origem: string; coletadoEm: string };

/**
 * O acervo de votos por UF: as matérias (com os totais), e os votos por UF só onde fazem falta — os da
 * UF pedida, para o recorte e a ordenação (`uf`), e o mapa inteiro só das matérias que vão na resposta
 * (`completar`). Ler as ~155 mil linhas de votos por UF a cada chamada seria 10× o que o corpus lia.
 * As matérias do corpus que ainda não entraram na camada 3 já trazem o mapa inteiro.
 */
export async function acervoDaC3(
  db: D1Database | undefined,
  staleMaxMin: number,
  uf?: string,
): Promise<(ListaC3<MateriaDoAcervo> & { completar: (itens: MateriaDoAcervo[]) => Promise<MateriaDoAcervo[]> }) | null> {
  const meta = await metaDaC3(db, [T.materias, T.votosUf], staleMaxMin);
  if (!meta || !db) return null;
  try {
    const [ms, vs] = await Promise.all([
      db.prepare(`SELECT codigo, materia, ementa, autoria, status, referencePeriod, votosSim, votosNao, totalVotos, url, origem, coletadoEm FROM ${T.materias}`).all<LinhaMateriaC3>(),
      uf ? db.prepare(`SELECT codigo, uf, sim, nao, desde, ate FROM ${T.votosUf} WHERE uf = ?`).bind(uf).all<VotosUfC3>() : Promise.resolve({ results: [] as VotosUfC3[] }),
    ]);
    const daUf = votosPorUfDaC3(vs.results ?? []);
    const extras = await doCorpusForaDaC3(db, "consultas_votos", T.materias, "codigo");
    const doBanco = new Set<number>();
    const items: MateriaDoAcervo[] = [
      ...extras.map((e) => ({ ...(e.payload as unknown as ConsultaVotoResumo), origem: "corpus", coletadoEm: e.scrapedAt })),
      ...(ms.results ?? []).map((m) => {
        doBanco.add(m.codigo);
        return materiaDaC3(m, daUf.get(m.codigo) ?? {});
      }),
    ];
    const completar = async (itens: MateriaDoAcervo[]): Promise<MateriaDoAcervo[]> => {
      const codigos = itens.filter((i) => doBanco.has(i.id)).map((i) => i.id);
      if (!codigos.length) return itens;
      const rs = await db
        .prepare(`SELECT codigo, uf, sim, nao, desde, ate FROM ${T.votosUf} WHERE codigo IN (${codigos.map(() => "?").join(",")})`)
        .bind(...codigos)
        .all<VotosUfC3>();
      const mapa = votosPorUfDaC3(rs.results ?? []);
      return itens.map((i) => (doBanco.has(i.id) ? { ...i, votosPorUf: mapa.get(i.id) ?? {} } : i));
    };
    return { items, meta: { ...meta, itensDoCorpus: extras.length }, completar };
  } catch {
    return null;
  }
}

/**
 * Proposições das ideias de uma página (só as que têm detalhe lido). Do arquivo: a tabela da camada 3
 * com a posição casada na linha do tempo. Do corpus: a lista que o corpus guarda (já com a posição).
 */
async function proposicoesDe(db: D1Database, linhas: readonly LinhaIdeiaC3[]): Promise<Map<number, ProposicaoDaIdeia[]>> {
  const out = new Map<number, ProposicaoDaIdeia[]>();
  const arq = linhas.filter((l) => l.origemDetalhe === "arquivo").map((l) => l.id);
  const cor = linhas.filter((l) => l.origemDetalhe === "corpus").map((l) => l.id);
  if (arq.length) {
    const m = arq.map(() => "?").join(",");
    const [ps, ls] = await Promise.all([
      db.prepare(`SELECT ${COLS_PROPOSICAO} FROM ${T.proposicoes} WHERE id IN (${m}) AND origem = 'arquivo'`).bind(...arq).all<LinhaProposicaoC3>(),
      db.prepare(`SELECT id, ordem, data, tipo, texto FROM ${T.linhaDoTempo} WHERE id IN (${m}) AND tipo IN ('cdhTransformou','adocao','transformadaEm')`).bind(...arq).all<LinhaAcontecimentoC3>(),
    ]);
    for (const id of arq) {
      const p = (ps.results ?? []).filter((x) => x.id === id);
      if (p.length) out.set(id, proposicoesComOrdem(p, (ls.results ?? []).filter((x) => x.id === id)));
    }
  }
  if (cor.length) {
    const m = cor.map(() => "?").join(",");
    const rs = await db
      .prepare(`SELECT entity_id, json_extract(payload_json, '$.proposicoes') AS p FROM ecidadania_current WHERE entidade = 'ideias' AND entity_id IN (${m})`)
      .bind(...cor)
      .all<{ entity_id: number; p: string | null }>();
    for (const r of rs.results ?? []) {
      const lista = r.p ? (JSON.parse(r.p) as ProposicaoDaIdeia[]) : [];
      if (lista.length) out.set(Number(r.entity_id), lista);
    }
  }
  return out;
}

export interface PaginaDeIdeias {
  status?: string;
  ordenarPorApoios?: "asc" | "desc";
  limite: number;
  offset: number;
}

/**
 * Uma página de ideias, filtrada e ordenada no banco (índices em status e apoios). As do corpus que
 * ainda não entraram na camada 3 (poucas: as novas desde a última projeção) entram na mesma ordenação.
 * Sem ordenação pedida: id decrescente (as mais novas primeiro).
 */
export async function paginaDeIdeiasDaC3(
  db: D1Database | undefined,
  staleMaxMin: number,
  p: PaginaDeIdeias,
): Promise<ListaC3<IdeiaResumo & OrigensDoBloco> | null> {
  const meta = await metaDaC3(db, [T.ideias, T.proposicoes, T.linhaDoTempo], staleMaxMin);
  if (!meta || !db) return null;
  try {
    const ordem = p.ordenarPorApoios ? `apoios ${p.ordenarPorApoios === "asc" ? "ASC" : "DESC"}, id DESC` : "id DESC";
    const onde = p.status ? "WHERE status = ?" : "";
    const ate = p.offset + p.limite;
    const stmt = db.prepare(`SELECT ${COLS_IDEIA} FROM ${T.ideias} ${onde} ORDER BY ${ordem} LIMIT ?`);
    const rs = await (p.status ? stmt.bind(p.status, ate) : stmt.bind(ate)).all<LinhaIdeiaC3>();
    const extras = (await doCorpusForaDaC3(db, "ideias", T.ideias, "id"))
      .map((e) => ({ ...(e.payload as unknown as IdeiaResumo), ...origensDoCorpus(e.scrapedAt, ["Resumo", "Detalhe"]) }))
      .filter((i) => !p.status || i.status === p.status);
    // Ordena e corta ANTES das proposições: elas são lidas só para a fatia (≤ 100 ids ligados no IN).
    type Candidata = { item: IdeiaResumo & OrigensDoBloco; linha?: LinhaIdeiaC3 };
    const todas: Candidata[] = [...extras.map((item) => ({ item })), ...(rs.results ?? []).map((linha) => ({ item: ideiaDaC3(linha), linha }))];
    const cmp = (x: Candidata, y: Candidata) => {
      const a = x.item, b = y.item;
      return p.ordenarPorApoios === "asc" ? a.apoios - b.apoios || b.id - a.id : p.ordenarPorApoios === "desc" ? b.apoios - a.apoios || b.id - a.id : b.id - a.id;
    };
    const fatia = todas.sort(cmp).slice(p.offset, ate);
    const props = await proposicoesDe(db, fatia.flatMap((c) => (c.linha ? [c.linha] : [])));
    const items = fatia.map((c) => (c.linha ? ideiaDaC3(c.linha, props.get(c.linha.id)) : c.item));
    return { items, meta: { ...meta, itensDoCorpus: extras.length } };
  } catch {
    return null;
  }
}

/**
 * As ideias para a sugestão de tema da enquete: quantas foram analisadas, quantas passam do mínimo de
 * apoios e as `topo` mais apoiadas — no banco, sem trazer as ~123 mil linhas.
 */
export async function ideiasParaEnqueteDaC3(
  db: D1Database | undefined,
  staleMaxMin: number,
  o: { apenasAbertas: boolean; minimo: number; topo: number },
): Promise<{ analisadas: number; qualificadas: number; topo: Array<IdeiaResumo & OrigensDoBloco>; meta: MetaC3 } | null> {
  const meta = await metaDaC3(db, [T.ideias], staleMaxMin);
  if (!meta || !db) return null;
  try {
    const onde = o.apenasAbertas ? "WHERE status = 'aberta'" : "";
    const e = o.apenasAbertas ? "AND" : "WHERE";
    const [n, q, top] = await Promise.all([
      db.prepare(`SELECT COUNT(*) AS n FROM ${T.ideias} ${onde}`).first<{ n: number }>(),
      db.prepare(`SELECT COUNT(*) AS n FROM ${T.ideias} ${onde} ${e} apoios >= ?`).bind(o.minimo).first<{ n: number }>(),
      db.prepare(`SELECT ${COLS_IDEIA} FROM ${T.ideias} ${onde} ${e} apoios >= ? ORDER BY apoios DESC, id DESC LIMIT ?`).bind(o.minimo, o.topo).all<LinhaIdeiaC3>(),
    ]);
    const extras = (await doCorpusForaDaC3(db, "ideias", T.ideias, "id"))
      .map((x) => ({ ...(x.payload as unknown as IdeiaResumo), ...origensDoCorpus(x.scrapedAt, ["Resumo", "Detalhe"]) }))
      .filter((i) => !o.apenasAbertas || i.status === "aberta");
    const extrasQ = extras.filter((i) => i.apoios >= o.minimo);
    const topo = [...extrasQ, ...(top.results ?? []).map((l) => ideiaDaC3(l))].sort((a, b) => b.apoios - a.apoios || b.id - a.id).slice(0, o.topo);
    return { analisadas: (n?.n ?? 0) + extras.length, qualificadas: (q?.n ?? 0) + extrasQ.length, topo, meta: { ...meta, itensDoCorpus: extras.length } };
  } catch {
    return null;
  }
}

export interface IdeiaDaC3 {
  linha: LinhaIdeiaC3;
  detalhe: IdeiaDetalhe;
  serieApoios: PontoApoiosC3[];
  situacoes: PontoSituacaoC3[];
  meta: MetaC3;
}

/** Uma ideia inteira da camada 3, ou null (fora da camada 3, ou camada 3 ausente). */
export async function ideiaInteiraDaC3(db: D1Database | undefined, id: number, staleMaxMin: number): Promise<IdeiaDaC3 | null> {
  const meta = await metaDaC3(db, [T.ideias, T.proposicoes, T.linhaDoTempo, T.serieApoios, T.situacao], staleMaxMin);
  if (!meta || !db) return null;
  try {
    const linha = await db.prepare(`SELECT ${COLS_IDEIA} FROM ${T.ideias} WHERE id = ?`).bind(id).first<LinhaIdeiaC3>();
    if (!linha) return null;
    const [tl, ap, si, props] = await Promise.all([
      db.prepare(`SELECT id, ordem, data, tipo, texto FROM ${T.linhaDoTempo} WHERE id = ? ORDER BY ordem`).bind(id).all<LinhaAcontecimentoC3>(),
      db.prepare(`SELECT entity_id, origem, apoios, desde, ate, leituras FROM ${T.serieApoios} WHERE entity_id = ?`).bind(String(id)).all<PontoApoiosC3>(),
      db.prepare(`SELECT entity_id, origem, situacao_codigo, situacao_nome, status, desde, ate, leituras FROM ${T.situacao} WHERE entity_id = ?`).bind(String(id)).all<PontoSituacaoC3>(),
      proposicoesDe(db, [linha]),
    ]);
    const detalhe = detalheDaC3(linha, tl.results ?? [], props.get(id) ?? []);
    return { linha, detalhe, serieApoios: ap.results ?? [], situacoes: si.results ?? [], meta };
  } catch {
    return null;
  }
}

/** Uma consulta da camada 3 com a série de votos, ou null. */
export async function consultaInteiraDaC3(
  db: D1Database | undefined,
  id: number,
  staleMaxMin: number,
): Promise<{ linha: LinhaConsultaC3; serie: PontoVotosC3[]; meta: MetaC3 } | null> {
  const meta = await metaDaC3(db, [T.consultas, T.serieVotos], staleMaxMin);
  if (!meta || !db) return null;
  try {
    const linha = await db.prepare(`SELECT ${COLS_CONSULTA} FROM ${T.consultas} WHERE id = ?`).bind(id).first<LinhaConsultaC3>();
    if (!linha) return null;
    const s = await db.prepare(`SELECT id, voto, votos, desde, ate, leituras, origem FROM ${T.serieVotos} WHERE id = ?`).bind(id).all<PontoVotosC3>();
    return { linha, serie: s.results ?? [], meta };
  } catch {
    return null;
  }
}

/** Um evento da camada 3 com pauta e convidados, ou null. */
export async function eventoInteiroDaC3(
  db: D1Database | undefined,
  id: number,
  staleMaxMin: number,
): Promise<{ linha: LinhaEventoC3; pauta: string[]; convidados: string[]; meta: MetaC3 } | null> {
  const meta = await metaDaC3(db, [T.eventos, T.pauta, T.convidados], staleMaxMin);
  if (!meta || !db) return null;
  try {
    const linha = await db.prepare(`SELECT ${COLS_EVENTO} FROM ${T.eventos} WHERE id = ?`).bind(id).first<LinhaEventoC3>();
    if (!linha) return null;
    const [p, c] = await Promise.all([
      db.prepare(`SELECT texto FROM ${T.pauta} WHERE id = ? ORDER BY ordem`).bind(id).all<{ texto: string }>(),
      db.prepare(`SELECT texto FROM ${T.convidados} WHERE id = ? ORDER BY ordem`).bind(id).all<{ texto: string }>(),
    ]);
    return { linha, pauta: (p.results ?? []).map((x) => x.texto), convidados: (c.results ?? []).map((x) => x.texto), meta };
  } catch {
    return null;
  }
}
