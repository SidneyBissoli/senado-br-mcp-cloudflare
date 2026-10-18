/**
 * Leitor da página de detalhe de uma ideia legislativa (`visualizacaoideia?id=`) na forma redesenhada
 * pelo portal em 12/10/2026: a seção "Situação da Ideia" sumiu e virou uma "Linha do Tempo" de
 * acontecimentos datados (`<ol class="timeline">`, mais recente no topo), e a UF do autor e a data
 * limite mudaram de marcação. Fase A1 do ROADMAP ("Detalhe das ideias redesenhado…").
 *
 * Vocabulário FECHADO, medido em 17/10/2026 sobre 340 ideias de 2013 a 2026 em todas as situações
 * (`docs/_local/ideias-linha-do-tempo-2026-10-17/`): cada item da linha do tempo é de um dos tipos de
 * `TipoAcontecimento`; o que não casar com nenhum vira `naoReconhecido`, é copiado verbatim e ganha um
 * aviso — nunca é encaixado no tipo mais parecido. Um item que casa com um tipo mas não entrega os
 * campos do tipo (deriva parcial), ou um acontecimento de valor único que aparece duas vezes (duas
 * Sugestões, duas decisões da CDH…), LANÇA `IdeiaDetalheForaDoMoldeError`: escolher um dos dois seria
 * adivinhar, e quem chama (crawler, tool) decide o que fazer com a página — nunca gravar meio registro.
 *
 * Tudo aqui é COPIADO do que o portal publica: nenhuma situação é inferida (a situação do portal não é
 * o último acontecimento — medido —, ela vem do bucket da listagem). As únicas padronizações são de
 * forma, sem perda: datas para ISO, "Senadora"/"Deputada" para `transformadaPor` + `sexo`, número de
 * proposição em partes. O nome do autor é registrado como o portal publica (abreviado), decisão do
 * dono de 17/10/2026; os nomes de parlamentares são de agentes públicos.
 *
 * Puro: sem rede, sem banco. A página 410 (ideia removida) nunca chega aqui — `fetchPage` a trata pelo
 * status HTTP.
 */

export class IdeiaDetalheForaDoMoldeError extends Error {
  constructor(message: string) {
    super(`detalhe da ideia fora do molde medido: ${message}`);
    this.name = "IdeiaDetalheForaDoMoldeError";
  }
}

export type TipoAcontecimento =
  | "proposta" //            "Ideia proposta por NOME (UF)"
  | "prazo" //               "O que pode acontecer com essa ideia? … pode receber apoios até dd/mm/aaaa"
  | "oficina" //             "Ideia elaborada em uma Oficina Legislativa … nível X" (o único sem data)
  | "meta" //                "Ideia alcançou 20.000 apoios"
  | "prazoEncerrado" //      "Período de apoio encerrado — recebeu N apoios … terminou em d de mês de aaaa"
  | "sugestao" //            "Essa ideia gerou a Sugestão nº N, de AAAA"
  | "cdhNaoTransformou" //   "A CDH do Senado debateu e decidiu não transformar a Sugestão …"
  | "cdhTransformou" //      "Ideia transformada em SIGLA pela Comissão — a CDH debateu a Sugestão … e decidiu transformá-la no(a) …"
  | "adocao" //              "Ideia transformada em SIGLA por Senador(a)/Deputado(a) — adotada pelo(a) … e transformada no …"
  | "transformadaEm" //      "Ideia transformada em <proposição>" sem autor (Requerimento da CDH, Substitutivo-CD)
  | "naoReconhecido";

export interface Acontecimento {
  /** Posição na página, 0 = topo (o mais recente; o portal o marca como `active`). */
  ordem: number;
  /** `<time datetime>` (ISO), ou null quando o item não tem data (a oficina não tem). */
  data: string | null;
  ativo: boolean;
  tipo: TipoAcontecimento;
  /** Texto do item como publicado, sem tags (sem o link "Emitir declaração de autoria de ideia"). */
  texto: string;
}

export interface ProposicaoDaIdeia {
  /** Posição do acontecimento na linha do tempo (liga a proposição ao item de origem). */
  ordem: number;
  data: string | null;
  /** Quem transformou, como o portal diz; null quando o item não diz (Requerimento, Substitutivo-CD). */
  transformadaPor: "Comissão" | "Senador" | "Deputado" | null;
  /** Gênero gramatical do cargo publicado ("Senadora" → feminino); null para Comissão e sem autor. */
  sexo: "feminino" | "masculino" | null;
  parlamentar: string | null;
  parlamentarUf: string | null;
  /** Sigla do título do item ("PL", "PEC", "INC"…); null quando o item não traz sigla. */
  tipoSigla: string | null;
  /** Nome da proposição como no link ("Projeto de Lei do Senado", "Indicação (CD)"…). */
  tipoNome: string;
  numero: number;
  ano: number;
  /** Parêntese depois do ano, quando houver ("Substitutivo-CD"). */
  complemento: string | null;
  /** Link do portal para a proposição (Senado ou Câmara), base dos vínculos da fase E. */
  url: string | null;
}

export interface ReferenciaSugestao { numero: number; ano: number }

export interface IdeiaDetalhe {
  titulo: string;
  descricao: string | null;
  /** Contador "N apoios confirmados" (null se ausente — nunca 0 inventado). */
  apoios: number | null;
  autorNome: string | null;
  autorUf: string | null;
  dataProposta: string | null;
  /** "Essa ideia pode receber apoios até dd/mm/aaaa" (ISO). */
  prazoApoios: string | null;
  /** Data do acontecimento "Ideia alcançou 20.000 apoios". */
  dataMeta: string | null;
  /** Meta publicada no acontecimento (20.000 em todas as medidas). */
  meta: number | null;
  sugestao: (ReferenciaSugestao & { data: string | null; url: string | null }) | null;
  decisaoCdh: { data: string | null; resultado: "transformou" | "não transformou"; sugestao: ReferenciaSugestao } | null;
  /** "Período de apoio encerrado": apoios recebidos e o fim do período, ambos como publicados. */
  encerramento: { data: string | null; apoios: number; terminouEm: string } | null;
  oficina: { nivel: string; dataCadastro: string } | null;
  proposicoes: ProposicaoDaIdeia[];
  linhaDoTempo: Acontecimento[];
  /** Acontecimentos não reconhecidos (um aviso por item); o registro segue, o item fica verbatim. */
  avisos: string[];
}

// ── utilidades de texto ───────────────────────────────────────────────────

function decodificar(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, "&");
}

/**
 * Texto sem tags. Tags de bloco viram espaço; tags de linha somem sem espaço — o portal parte palavras
 * em `<span>` ("pel<span>o</span>"), e trocar toda tag por espaço daria "pel o Deputado".
 */
export function textoDoHtml(html: string): string {
  return decodificar(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/?(?:p|div|li|ul|ol|h\d|br|section|figure|figcaption)\b[^>]*>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  ).replace(/\s+/g, " ").trim();
}

/** dd/mm/aaaa → aaaa-mm-dd (validado: 31/02 é recusado, não "corrigido"). */
function isoDeDataBr(s: string, onde: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) throw new IdeiaDetalheForaDoMoldeError(`${onde}: data "${s}" não é dd/mm/aaaa`);
  return isoValida(Number(m[3]), Number(m[2]), Number(m[1]), onde);
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "26 de junho de 2018" → 2018-06-26. */
function isoDeDataExtenso(s: string, onde: string): string {
  const m = /^(\d{1,2}) de (\p{L}+) de (\d{4})$/u.exec(s.trim());
  const mes = m ? MESES.indexOf(m[2].toLowerCase()) + 1 : 0;
  if (!m || mes === 0) throw new IdeiaDetalheForaDoMoldeError(`${onde}: data "${s}" não é "d de mês de aaaa"`);
  return isoValida(Number(m[3]), mes, Number(m[1]), onde);
}

function isoValida(ano: number, mes: number, dia: number, onde: string): string {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    throw new IdeiaDetalheForaDoMoldeError(`${onde}: data inexistente ${dia}/${mes}/${ano}`);
  }
  return d.toISOString().slice(0, 10);
}

function inteiroBr(s: string): number {
  return parseInt(s.replace(/\./g, ""), 10);
}

/** "Projeto de Lei nº 3630, de 2021 (Substitutivo-CD)" → partes; null se não casar. */
export function partesDaProposicao(rotulo: string): { tipoNome: string; numero: number; ano: number; complemento: string | null } | null {
  const m = /^(.+?) nº ([\d.]+), de (\d{4})(?: \(([^)]+)\))?$/.exec(rotulo.trim());
  return m ? { tipoNome: m[1], numero: inteiroBr(m[2]), ano: Number(m[3]), complemento: m[4] ?? null } : null;
}

function referenciaSugestao(rotulo: string, onde: string): ReferenciaSugestao {
  const p = partesDaProposicao(rotulo);
  if (!p || p.tipoNome !== "Sugestão" || p.complemento) {
    throw new IdeiaDetalheForaDoMoldeError(`${onde}: "${rotulo}" não é "Sugestão nº N, de AAAA"`);
  }
  return { numero: p.numero, ano: p.ano };
}

/** Links `<a href>` do item, com o texto já limpo. */
function links(html: string): Array<{ href: string; texto: string }> {
  return [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ href: decodificar(m[1]), texto: textoDoHtml(m[2]) }));
}

/**
 * Link de uma proposição: o primeiro "… nº N, de AAAA" que não é a Sugestão (a decisão da CDH cita as
 * duas) nem a Consulta Pública do próprio portal.
 */
function linkDaProposicao(html: string, onde: string): { href: string; texto: string } {
  const l = links(html).find((x) => !/^\/?ecidadania\//.test(x.href) && !x.texto.startsWith("Sugestão") && partesDaProposicao(x.texto));
  if (!l) throw new IdeiaDetalheForaDoMoldeError(`${onde}: proposição sem link "… nº N, de AAAA"`);
  return l;
}

/**
 * Construtor canônico: ordem de campos FIXA em todos os caminhos (o corpus compara payloads por hash,
 * e ordem diferente faria a mesma proposição parecer mudada — ver `buildIdeiaResumo`).
 */
function novaProposicao(p: ProposicaoDaIdeia): ProposicaoDaIdeia {
  return {
    ordem: p.ordem, data: p.data, transformadaPor: p.transformadaPor, sexo: p.sexo,
    parlamentar: p.parlamentar, parlamentarUf: p.parlamentarUf, tipoSigla: p.tipoSigla,
    tipoNome: p.tipoNome, numero: p.numero, ano: p.ano, complemento: p.complemento, url: p.url,
  };
}

// ── leitura de um item ────────────────────────────────────────────────────

const CARGOS: Record<string, { por: "Senador" | "Deputado"; sexo: "feminino" | "masculino" }> = {
  Senador: { por: "Senador", sexo: "masculino" },
  Senadora: { por: "Senador", sexo: "feminino" },
  Deputado: { por: "Deputado", sexo: "masculino" },
  Deputada: { por: "Deputado", sexo: "feminino" },
};

interface Contexto { ideia: IdeiaDetalhe; item: Acontecimento; html: string; onde: string }

/** Campo de valor único: a segunda ocorrência é molde novo, nunca sobrescrita. */
function unico<K extends keyof IdeiaDetalhe>(c: Contexto, campo: K, valor: IdeiaDetalhe[K]): void {
  if (c.ideia[campo] !== null) throw new IdeiaDetalheForaDoMoldeError(`${c.onde}: segundo acontecimento para "${String(campo)}"`);
  c.ideia[campo] = valor;
}

/** Tenta cada tipo em ordem; devolve o tipo reconhecido (e preenche a ideia) ou null. */
function lerItem(c: Contexto): TipoAcontecimento | null {
  const { html, item, onde } = c;
  const t = item.texto;

  if (/^Ideia proposta por /.test(t)) {
    const m = /Ideia proposta por\s*<strong>\s*<span>([\s\S]*?)<\/span>\s*(?:<span>\s*\(([A-Z]{2})\)\s*<\/span>)?\s*<\/strong>/.exec(html);
    if (!m) throw new IdeiaDetalheForaDoMoldeError(`${onde}: proposta sem "<strong><span>NOME</span><span> (UF)</span>"`);
    unico(c, "autorNome", textoDoHtml(m[1]) || null);
    c.ideia.autorUf = m[2] ?? null;
    unico(c, "dataProposta", item.data);
    return "proposta";
  }

  if (/^O que pode acontecer com essa ideia\?/.test(t)) {
    const m = /pode receber apoios até\s*<strong>\s*([^<]+?)\s*<\/strong>/.exec(html);
    if (!m) throw new IdeiaDetalheForaDoMoldeError(`${onde}: regras sem "pode receber apoios até <strong>data</strong>"`);
    unico(c, "prazoApoios", isoDeDataBr(m[1], onde));
    return "prazo";
  }

  if (/class="oficina_legislativa"/.test(html)) {
    const nivel = /realizada com participantes de nível\s*<span>([^<]+)<\/span>/.exec(html);
    const cad = /Ideia cadastrada pelo usuário em\s*<span>(\d{2}\/\d{2}\/\d{4}) às (\d{2}:\d{2}:\d{2})<\/span>/.exec(html);
    if (!nivel || !cad) throw new IdeiaDetalheForaDoMoldeError(`${onde}: oficina sem nível ou sem data de cadastro`);
    // Hora local do portal, sem fuso: o portal não publica o fuso (e houve horário de verão até 2019).
    unico(c, "oficina", { nivel: nivel[1].trim(), dataCadastro: `${isoDeDataBr(cad[1], onde)}T${cad[2]}` });
    return "oficina";
  }

  const meta = /^Ideia alcançou ([\d.]+) apoios$/.exec(t);
  if (meta) {
    unico(c, "dataMeta", item.data);
    c.ideia.meta = inteiroBr(meta[1]);
    return "meta";
  }

  if (/^Período de apoio encerrado /.test(t)) {
    const m = /^Período de apoio encerrado Esta ideia recebeu (\d+) apoios e não alcançou a meta dentro do prazo\. O período terminou em (.+?)\.$/.exec(t);
    if (!m) throw new IdeiaDetalheForaDoMoldeError(`${onde}: encerramento sem "recebeu N apoios … terminou em data"`);
    unico(c, "encerramento", { data: item.data, apoios: Number(m[1]), terminouEm: isoDeDataExtenso(m[2], onde) });
    return "prazoEncerrado";
  }

  if (/^Essa ideia gerou a Sugestão /.test(t)) {
    const l = links(html).find((x) => x.texto.startsWith("Sugestão"));
    if (!l) throw new IdeiaDetalheForaDoMoldeError(`${onde}: "gerou a Sugestão" sem o link da Sugestão`);
    unico(c, "sugestao", { ...referenciaSugestao(l.texto, onde), data: item.data, url: l.href });
    return "sugestao";
  }

  if (/^A CDH do Senado debateu e decidiu não transformar a Sugestão /.test(t)) {
    const l = links(html).find((x) => x.texto.startsWith("Sugestão"));
    if (!l) throw new IdeiaDetalheForaDoMoldeError(`${onde}: decisão da CDH sem o link da Sugestão`);
    unico(c, "decisaoCdh", { data: item.data, resultado: "não transformou", sugestao: referenciaSugestao(l.texto, onde) });
    return "cdhNaoTransformou";
  }

  const titulo = /<h3>\s*Ideia transformada em\s*<span>([^<]+)<\/span>\s*(pela|por)\s*<span>([^<]+)<\/span>\s*<\/h3>/.exec(html);
  if (titulo) {
    const [, sigla, , quemBruto] = titulo;
    const quem = quemBruto.trim();
    // Autor fora do vocabulário medido (Comissão, Senador(a), Deputado(a)) é acontecimento novo:
    // fica verbatim com aviso, em vez de virar um "por" adivinhado.
    if (quem !== "Comissão" && !CARGOS[quem]) return null;
    const prop = linkDaProposicao(html, onde);
    const partes = partesDaProposicao(prop.texto)!;
    const base = { ordem: item.ordem, data: item.data, tipoSigla: sigla.trim(), ...partes, url: prop.href };

    if (quem === "Comissão") {
      const sug = links(html).find((x) => x.texto.startsWith("Sugestão"));
      if (!sug || !/A CDH do Senado debateu a Sugestão .+ e decidiu transformá-la no\(a\) /.test(t)) {
        throw new IdeiaDetalheForaDoMoldeError(`${onde}: "transformada pela Comissão" sem "a CDH debateu a Sugestão … e decidiu transformá-la"`);
      }
      unico(c, "decisaoCdh", { data: item.data, resultado: "transformou", sugestao: referenciaSugestao(sug.texto, onde) });
      c.ideia.proposicoes.push(novaProposicao({ ...base, transformadaPor: "Comissão", sexo: null, parlamentar: null, parlamentarUf: null }));
      return "cdhTransformou";
    }

    const cargo = CARGOS[quem];
    const autor = /A ideia foi adotada pel<span>[oa]<\/span>\s*<span>\s*(Senador|Senadora|Deputado|Deputada) (.+?) \(([A-Z]{2})\)\s*<\/span>/.exec(html);
    if (!autor || autor[1] !== quem) {
      throw new IdeiaDetalheForaDoMoldeError(`${onde}: "transformada por ${quem}" sem "adotada pelo(a) ${quem} NOME (UF)" correspondente`);
    }
    c.ideia.proposicoes.push(novaProposicao({ ...base, transformadaPor: cargo.por, sexo: cargo.sexo, parlamentar: autor[2].trim(), parlamentarUf: autor[3] }));
    return "adocao";
  }

  if (/^Ideia transformada em /.test(t)) {
    const prop = linkDaProposicao(html, onde);
    c.ideia.proposicoes.push(novaProposicao({
      ordem: item.ordem, data: item.data, transformadaPor: null, sexo: null, parlamentar: null, parlamentarUf: null,
      tipoSigla: null, ...partesDaProposicao(prop.texto)!, url: prop.href,
    }));
    return "transformadaEm";
  }

  return null;
}

// ── a página ──────────────────────────────────────────────────────────────

/** Lê a página de detalhe inteira (ou o recorte `#container-ideia-legislativa`). */
export function lerIdeiaDetalhe(html: string): IdeiaDetalhe {
  if (/class="object-not-found"/.test(html)) {
    throw new IdeiaDetalheForaDoMoldeError('a página diz "Ideia Legislativa não encontrada!" (object-not-found)');
  }

  // Título em <b><div>, seguido da descrição no primeiro <div> (o mesmo par que o leitor antigo lia).
  const cabeca = /id="ideia-legislativa"[\s\S]*?<b><div[^>]*>([\s\S]*?)<\/div><\/b>(?:\s*<div[^>]*>([\s\S]*?)<\/div>)?/.exec(html);
  const titulo = cabeca ? textoDoHtml(cabeca[1]) : "";
  if (!titulo) throw new IdeiaDetalheForaDoMoldeError("sem título em #ideia-legislativa");
  const descricao = cabeca?.[2] !== undefined ? textoDoHtml(cabeca[2]) || null : null;

  const apoiosM = /<span class="contabilizacao">\s*([\d.]+)\s*<\/span>\s*apoios confirmados/.exec(html);

  const linha = /<ol class="timeline">([\s\S]*?)<\/ol>\s*<\/section>/.exec(html);
  if (!linha) throw new IdeiaDetalheForaDoMoldeError("sem a Linha do Tempo (<ol class=\"timeline\">)");
  const itens = linha[1].split(/(?=<li class="timeline-item)/).slice(1);
  if (itens.length === 0) throw new IdeiaDetalheForaDoMoldeError("Linha do Tempo vazia");

  const ideia: IdeiaDetalhe = {
    titulo, descricao, apoios: apoiosM ? inteiroBr(apoiosM[1]) : null,
    autorNome: null, autorUf: null, dataProposta: null, prazoApoios: null, dataMeta: null, meta: null,
    sugestao: null, decisaoCdh: null, encerramento: null, oficina: null,
    proposicoes: [], linhaDoTempo: [], avisos: [],
  };

  itens.forEach((li, ordem) => {
    const corpo = li.replace(/<time\b[\s\S]*?<\/time>/, "").replace(/<a\b[^>]*href="declaracaoideia[^"]*"[\s\S]*?<\/a>/, "");
    const item: Acontecimento = {
      ordem,
      data: /<time datetime="(\d{4}-\d{2}-\d{2})"/.exec(li)?.[1] ?? null,
      ativo: /^<li class="timeline-item active"/.test(li),
      tipo: "naoReconhecido",
      texto: textoDoHtml(corpo),
    };
    const tipo = lerItem({ ideia, item, html: corpo, onde: `item ${ordem}` });
    if (tipo) item.tipo = tipo;
    else ideia.avisos.push(`acontecimento não reconhecido no item ${ordem} (${item.data ?? "sem data"}): "${item.texto.slice(0, 120)}"`);
    ideia.linhaDoTempo.push(item);
  });

  if (ideia.dataProposta === null) throw new IdeiaDetalheForaDoMoldeError('Linha do Tempo sem "Ideia proposta por"');
  return ideia;
}
