/**
 * Leitor da página de detalhe redesenhada (12/10/2026) — fase A1 do ROADMAP.
 *
 * Fixtures: capturas REAIS de 17/10/2026, uma por caminho medido na amostra de 340 ideias, recortadas
 * em #container-ideia-legislativa com os bytes do portal intactos (cabeçalho de procedência em cada
 * arquivo). Os casos negativos partem de uma fixture real e mudam UM trecho, para provar que a deriva
 * parcial lança e que o acontecimento novo vira aviso — nunca um campo adivinhado.
 */

import { describe, it, expect } from "vitest";
import {
  lerIdeiaDetalhe, partesDaProposicao, textoDoHtml, statusDaLinhaDoTempo, detalheParaCorpus, apoiosPublicados,
  IdeiaDetalheForaDoMoldeError, type TipoAcontecimento,
} from "../../src/scraper/ideia-detalhe.js";
import aberta from "../fixtures/ecidadania/ideias-detalhe-2026-10/aberta-221186.html?raw";
import oficinaMedio from "../fixtures/ecidadania/ideias-detalhe-2026-10/oficina-medio-240545.html?raw";
import oficinaSuperior from "../fixtures/ecidadania/ideias-detalhe-2026-10/oficina-superior-220801.html?raw";
import oficinaOutros from "../fixtures/ecidadania/ideias-detalhe-2026-10/oficina-outros-0800-220987.html?raw";
import oficinaEspecial from "../fixtures/ecidadania/ideias-detalhe-2026-10/oficina-especial-adotada-171655.html?raw";
import semApoio from "../fixtures/ecidadania/ideias-detalhe-2026-10/sem-apoio-101185.html?raw";
import aguardando from "../fixtures/ecidadania/ideias-detalhe-2026-10/aguardando-219395.html?raw";
import emAvaliacao from "../fixtures/ecidadania/ideias-detalhe-2026-10/em-avaliacao-107433.html?raw";
import rejeitada from "../fixtures/ecidadania/ideias-detalhe-2026-10/rejeitada-101909.html?raw";
import rejeitadaAdotada from "../fixtures/ecidadania/ideias-detalhe-2026-10/rejeitada-adotada-136304.html?raw";
import cdhPec from "../fixtures/ecidadania/ideias-detalhe-2026-10/cdh-pec-104651.html?raw";
import cdhPls from "../fixtures/ecidadania/ideias-detalhe-2026-10/cdh-pls-100841.html?raw";
import cdhPlp from "../fixtures/ecidadania/ideias-detalhe-2026-10/cdh-plp-198137.html?raw";
import cdhIns from "../fixtures/ecidadania/ideias-detalhe-2026-10/cdh-ins-108750.html?raw";
import adotadaSem20mil from "../fixtures/ecidadania/ideias-detalhe-2026-10/adotada-sem-20mil-102777.html?raw";
import adotadaDeputada from "../fixtures/ecidadania/ideias-detalhe-2026-10/adotada-deputada-senadora-144418.html?raw";
import adotadaInc from "../fixtures/ecidadania/ideias-detalhe-2026-10/adotada-inc-200691.html?raw";
import adotadaPrc from "../fixtures/ecidadania/ideias-detalhe-2026-10/adotada-prc-55581.html?raw";
import requerimento from "../fixtures/ecidadania/ideias-detalhe-2026-10/requerimento-19341.html?raw";
import substitutivo from "../fixtures/ecidadania/ideias-detalhe-2026-10/substitutivo-65884.html?raw";
import removida from "../fixtures/ecidadania/ideias-detalhe-2026-10/removida-220396.html?raw";
// A8 (18/10/2026): os dois outros valores do parêntese do autor medidos nas 2.968 ideias sem UF.
import autorExterior from "../fixtures/ecidadania/ideias-detalhe-2026-10/autor-exterior-62016.html?raw";
import autorSemLocal from "../fixtures/ecidadania/ideias-detalhe-2026-10/autor-sem-local-1281.html?raw";

const TODAS: Record<string, string> = {
  aberta, oficinaMedio, oficinaSuperior, oficinaOutros, oficinaEspecial, semApoio, aguardando, emAvaliacao,
  rejeitada, rejeitadaAdotada, cdhPec, cdhPls, cdhPlp, cdhIns, adotadaSem20mil, adotadaDeputada, adotadaInc,
  adotadaPrc, requerimento, substitutivo,
};

const tipos = (html: string) => lerIdeiaDetalhe(html).linhaDoTempo.map((e) => e.tipo);

/** Troca um trecho que PRECISA existir na fixture (falha alto se o recorte mudar). */
function trocar(html: string, de: string | RegExp, para: string): string {
  const novo = html.replace(de, para);
  if (novo === html) throw new Error(`trecho não achado na fixture: ${de}`);
  return novo;
}

/** O `<li class="timeline-item…">…</li>` que contém o trecho (o `</li>` final, não o das regras). */
function itemCom(html: string, trecho: string): string {
  const p = html.split(/(?=<li class="timeline-item)/).find((x) => x.includes(trecho));
  if (!p) throw new Error(`item não achado na fixture: ${trecho}`);
  return p.slice(0, p.lastIndexOf("</li>") + "</li>".length);
}

describe("lerIdeiaDetalhe — vocabulário fechado sobre as capturas reais", () => {
  it("reconhece todo acontecimento das 20 páginas, sem aviso", () => {
    for (const [nome, html] of Object.entries(TODAS)) {
      const d = lerIdeiaDetalhe(html);
      expect(d.avisos, nome).toEqual([]);
      expect(d.linhaDoTempo.every((e) => e.tipo !== "naoReconhecido"), nome).toBe(true);
    }
  });

  it("as fixtures cobrem os dez tipos do vocabulário", () => {
    const vistos = new Set(Object.values(TODAS).flatMap(tipos));
    const esperados: TipoAcontecimento[] = ["proposta", "prazo", "oficina", "meta", "prazoEncerrado", "sugestao", "cdhNaoTransformou", "cdhTransformou", "adocao", "transformadaEm"];
    expect([...vistos].sort()).toEqual([...esperados].sort());
  });

  it("só o topo é ativo, e a ordem é a da página", () => {
    const d = lerIdeiaDetalhe(rejeitadaAdotada);
    expect(d.linhaDoTempo.map((e) => e.ativo)).toEqual([true, false, false, false, false, false, false, false]);
    expect(d.linhaDoTempo.map((e) => e.ordem)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("lerIdeiaDetalhe — um caminho por fixture", () => {
  it("aberta: proposta + prazo, autor e UF da marcação nova", () => {
    const d = lerIdeiaDetalhe(aberta);
    expect(tipos(aberta)).toEqual(["prazo", "proposta"]);
    expect(d).toMatchObject({
      apoios: 5145, autorNome: "NILTON R. D. A.", autorUf: "RJ", dataProposta: "2026-06-25", prazoApoios: "2026-10-23",
      dataMeta: null, sugestao: null, decisaoCdh: null, encerramento: null, oficina: null, proposicoes: [],
    });
    expect(d.titulo).toMatch(/^Equiparação dos soldos/);
    expect(d.descricao).toMatch(/^Tendo em vista a falta de reajustes/);
  });

  it("autor no exterior: o parêntese da fonte é guardado como publicado, e não vaza para o nome", () => {
    const d = lerIdeiaDetalhe(autorExterior);
    expect(d.autorUf).toBe("Exterior");
    expect(d.autorNome).toBeTruthy();
    expect(d.autorNome).not.toMatch(/Exterior|\(/);
    expect(detalheParaCorpus(d).autorUf).toBe("Exterior");
  });

  it("autor sem localidade publicada (parêntese vazio): null, e o nome sai limpo", () => {
    const d = lerIdeiaDetalhe(autorSemLocal);
    expect(d.autorUf).toBeNull();
    expect(d.autorNome).toBeTruthy();
    expect(d.autorNome).not.toMatch(/\(|\s$/);
  });

  it("texto do item: sem tags, sem o link de declaração de autoria, palavras partidas em <span> reunidas", () => {
    const d = lerIdeiaDetalhe(aberta);
    expect(d.linhaDoTempo[1].texto).toBe("Ideia proposta por NILTON R. D. A. (RJ)");
    const adot = lerIdeiaDetalhe(rejeitadaAdotada).linhaDoTempo[1].texto;
    expect(adot).toContain("A ideia foi adotada pelo Deputado Zé Silva (MG) e transformada no Projeto de Lei nº 4405, de 2020.");
  });

  it("oficina: nível e cadastro (hora local, sem fuso), único item sem data", () => {
    expect(lerIdeiaDetalhe(oficinaMedio).oficina).toEqual({ nivel: "médio", dataCadastro: "2026-09-15T09:28:27" });
    expect(lerIdeiaDetalhe(oficinaSuperior).oficina?.nivel).toBe("superior");
    expect(lerIdeiaDetalhe(oficinaEspecial).oficina?.nivel).toBe("educação especial");
    const outros = lerIdeiaDetalhe(oficinaOutros);
    expect(outros.oficina?.nivel).toBe("outros");
    const of = outros.linhaDoTempo.find((e) => e.tipo === "oficina")!;
    expect(of.data).toBeNull();
    // Autor como o portal publica, mesmo quando é o canal telefônico.
    expect(outros.autorNome).toBe("PARTICIPAÇÃO VIA 0800 061 2211");
  });

  it("sem apoio suficiente: encerramento com apoios e fim do período (extenso → ISO)", () => {
    const d = lerIdeiaDetalhe(semApoio);
    expect(tipos(semApoio)).toEqual(["prazoEncerrado", "prazo", "proposta"]);
    expect(d.encerramento).toEqual({ data: "2018-06-26", apoios: 17255, terminouEm: "2018-06-26" });
    expect(d.prazoApoios).toBe("2018-06-26");
  });

  it("aguardando envio à CDH: meta alcançada, sem Sugestão", () => {
    const d = lerIdeiaDetalhe(aguardando);
    expect(tipos(aguardando)).toEqual(["meta", "prazo", "proposta"]);
    expect(d).toMatchObject({ dataMeta: "2026-09-21", meta: 20000, sugestao: null, apoios: 21846 });
  });

  it("em avaliação: Sugestão com número, ano, data e link", () => {
    expect(lerIdeiaDetalhe(emAvaliacao).sugestao).toEqual({
      numero: 21, ano: 2019, data: "2019-02-15", url: "https://www25.senado.leg.br/web/atividade/materias/-/materia/135709",
    });
  });

  it("rejeitada pela CDH: decisão 'não transformou', sem proposição", () => {
    const d = lerIdeiaDetalhe(rejeitada);
    expect(d.decisaoCdh).toEqual({ data: "2019-04-01", resultado: "não transformou", sugestao: { numero: 19, ano: 2018 } });
    expect(d.proposicoes).toEqual([]);
  });

  it("rejeitada + três adoções: a decisão e as proposições convivem", () => {
    const d = lerIdeiaDetalhe(rejeitadaAdotada);
    expect(d.decisaoCdh?.resultado).toBe("não transformou");
    expect(d.proposicoes.map((p) => [p.ordem, p.transformadaPor, p.parlamentar, p.parlamentarUf, `${p.tipoSigla} ${p.numero}/${p.ano}`])).toEqual([
      [1, "Deputado", "Zé Silva", "MG", "PL 4405/2020"],
      [2, "Deputado", "Pompeo de Mattos", "RS", "PL 4367/2020"],
      [3, "Senador", "Paulo Paim", "RS", "PL 3657/2020"],
    ]);
    expect(d.proposicoes[0].url).toBe("https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=2261210");
  });

  it("CDH transformou: decisão + proposição da Comissão, para cada sigla medida", () => {
    const casos: Array<[string, string, string, number, number]> = [
      [cdhPec, "PEC", "Proposta de Emenda à Constituição", 141, 2019],
      [cdhPls, "PLS", "Projeto de Lei do Senado", 263, 2018],
      [cdhPlp, "PLP", "Projeto de Lei Complementar", 150, 2026],
      [cdhIns, "INS", "Indicação", 65, 2023],
    ];
    for (const [html, sigla, nome, numero, ano] of casos) {
      const d = lerIdeiaDetalhe(html);
      expect(d.decisaoCdh?.resultado, sigla).toBe("transformou");
      expect(d.decisaoCdh?.sugestao, sigla).toEqual({ numero: d.sugestao!.numero, ano: d.sugestao!.ano });
      expect(d.proposicoes, sigla).toHaveLength(1);
      expect(d.proposicoes[0], sigla).toMatchObject({
        transformadaPor: "Comissão", sexo: null, parlamentar: null, tipoSigla: sigla, tipoNome: nome, numero, ano, complemento: null,
      });
      // O link da proposição, não o da Sugestão que o mesmo item cita.
      expect(d.proposicoes[0].url, sigla).not.toBe(d.sugestao!.url);
    }
  });

  it("adotada sem 20 mil apoios: Senador e Senadora, sexo do cargo publicado", () => {
    const d = lerIdeiaDetalhe(adotadaSem20mil);
    expect(d.dataMeta).toBeNull();
    expect(d.encerramento?.apoios).toBe(22);
    expect(d.proposicoes.map((p) => [p.transformadaPor, p.sexo, p.parlamentar])).toEqual([
      ["Senador", "masculino", "Astronauta Marcos Pontes"],
      ["Senador", "feminino", "Eliziane Gama"],
    ]);
  });

  it("Deputada, Indicação (CD) e Projeto de Resolução (CD)", () => {
    expect(lerIdeiaDetalhe(adotadaDeputada).proposicoes[0]).toMatchObject({ transformadaPor: "Deputado", sexo: "feminino", parlamentar: "Maria do Rosário", parlamentarUf: "RS" });
    expect(lerIdeiaDetalhe(adotadaInc).proposicoes[0]).toMatchObject({ tipoSigla: "INC", tipoNome: "Indicação (CD)", numero: 1011, ano: 2026 });
    expect(lerIdeiaDetalhe(adotadaPrc).proposicoes[0]).toMatchObject({ tipoSigla: "PRC", tipoNome: "Projeto de Resolução (CD)", numero: 76, ano: 2025, parlamentar: "Kim Kataguiri" });
  });

  it("transformada sem autor: Requerimento da CDH (sem decisão da CDH inventada)", () => {
    const d = lerIdeiaDetalhe(requerimento);
    expect(d.decisaoCdh).toBeNull();
    expect(d.proposicoes).toEqual([{
      ordem: 0, data: "2015-09-02", transformadaPor: null, sexo: null, parlamentar: null, parlamentarUf: null, tipoSigla: null,
      tipoNome: "Requerimento Comissão de Direitos Humanos e Legislação Participativa", numero: 142, ano: 2015, complemento: null,
      url: "https://www25.senado.leg.br/web/atividade/materias/-/materia/123020",
    }]);
  });

  it("Substitutivo-CD depois do PLS da Comissão: complemento preservado", () => {
    const d = lerIdeiaDetalhe(substitutivo);
    expect(tipos(substitutivo)).toEqual(["transformadaEm", "cdhTransformou", "sugestao", "meta", "prazo", "proposta"]);
    expect(d.proposicoes.map((p) => [p.transformadaPor, p.tipoSigla, p.tipoNome, p.numero, p.ano, p.complemento])).toEqual([
      [null, null, "Projeto de Lei", 3630, 2021, "Substitutivo-CD"],
      ["Comissão", "PLS", "Projeto de Lei do Senado", 169, 2018, null],
    ]);
  });

  it("proposições saem com a mesma ordem de campos em todos os caminhos (hash estável)", () => {
    const chaves = Object.values(TODAS).flatMap((h) => lerIdeiaDetalhe(h).proposicoes).map((p) => Object.keys(p).join(","));
    expect(new Set(chaves).size).toBe(1);
  });
});

describe("lerIdeiaDetalhe — fora do molde", () => {
  it("página 'não encontrada' (a de 410) lança", () => {
    expect(() => lerIdeiaDetalhe(removida)).toThrow(IdeiaDetalheForaDoMoldeError);
  });

  it("sem Linha do Tempo (a página antiga) lança", () => {
    expect(() => lerIdeiaDetalhe(trocar(aberta, '<ol class="timeline">', '<ol class="lista">'))).toThrow(/sem a Linha do Tempo/);
  });

  it("segunda Sugestão lança", () => {
    const item = itemCom(emAvaliacao, "Essa ideia gerou a");
    expect(() => lerIdeiaDetalhe(trocar(emAvaliacao, item, item + item))).toThrow(/segundo acontecimento para "sugestao"/);
  });

  it("segunda decisão da CDH lança, mesmo de tipos diferentes", () => {
    const pls = itemCom(cdhPls, "decidiu transformá-la");
    const naoTransf = itemCom(rejeitada, "decidiu não transformar");
    expect(() => lerIdeiaDetalhe(trocar(cdhPls, pls, naoTransf + pls))).toThrow(/segundo acontecimento para "decisaoCdh"/);
  });

  it("adoção sem 'NOME (UF)' do parlamentar lança (deriva parcial)", () => {
    expect(() => lerIdeiaDetalhe(trocar(adotadaInc, "<span>Deputado Rodrigo Rollemberg (DF)</span>", "<span>Rodrigo Rollemberg</span>"))).toThrow(/transformada por Deputado/);
  });

  it("parêntese do autor fora dos valores medidos (27 UFs e Exterior) lança, em vez de gravar o desconhecido", () => {
    expect(() => lerIdeiaDetalhe(trocar(autorExterior, "(Exterior)", "(Portugal)"))).toThrow(/parêntese do autor/);
    expect(() => lerIdeiaDetalhe(trocar(aberta, "(RJ)", "(rj)"))).toThrow(/parêntese do autor/);
  });

  it("prazo sem a data em <strong> lança", () => {
    expect(() => lerIdeiaDetalhe(trocar(aberta, /<strong>23\/10\/2026<\/strong>/, "23/10/2026"))).toThrow(/pode receber apoios até/);
  });

  it("acontecimento novo vira 'naoReconhecido' com aviso, e o resto da página é lido", () => {
    const novo = '<li class="timeline-item"><span class="timeline-icon" aria-hidden="true"></span><time datetime="2026-10-01">01/10/2026</time><div><p>Ideia arquivada ao final da legislatura.</p></div></li>';
    const d = lerIdeiaDetalhe(trocar(aguardando, '<li class="timeline-item">', novo + '<li class="timeline-item">'));
    const item = d.linhaDoTempo.find((e) => e.tipo === "naoReconhecido")!;
    expect(item).toMatchObject({ data: "2026-10-01", texto: "Ideia arquivada ao final da legislatura." });
    expect(d.avisos).toHaveLength(1);
    expect(d.avisos[0]).toMatch(/não reconhecido no item 1 \(2026-10-01\)/);
    expect(d.dataMeta).toBe("2026-09-21");
  });

  it("autor de cargo fora do vocabulário vira aviso, não um 'por' adivinhado", () => {
    const d = lerIdeiaDetalhe(trocar(adotadaInc, "<span>Deputado</span></h3>", "<span>Vereador</span></h3>"));
    expect(d.proposicoes).toEqual([]);
    expect(d.linhaDoTempo[0].tipo).toBe("naoReconhecido");
    expect(d.avisos).toHaveLength(1);
  });

  it("sem o contador de apoios: null, nunca 0", () => {
    expect(lerIdeiaDetalhe(trocar(aberta, /<span class="contabilizacao">[^<]*<\/span>/, "")).apoios).toBeNull();
  });
});

describe("statusDaLinhaDoTempo — contra o bucket REAL de cada captura (A4)", () => {
  // Bucket da listagem de cada ideia, medido em 17/10/2026 (amostra de docs/_local). s5/s6/s8 → aberta,
  // s7/s9 → encerrada, s10 → convertida — o mapa de SITUACAO_STATUS.
  const BUCKET: Record<string, 5 | 6 | 7 | 8 | 9 | 10> = {
    aberta: 5, oficinaMedio: 5, oficinaSuperior: 7, oficinaOutros: 7, oficinaEspecial: 10, semApoio: 7, aguardando: 8,
    emAvaliacao: 6, rejeitada: 9, rejeitadaAdotada: 9, cdhPec: 10, cdhPls: 10, cdhPlp: 10, cdhIns: 10, adotadaSem20mil: 10,
    adotadaDeputada: 10, adotadaInc: 6, adotadaPrc: 10, requerimento: 10, substitutivo: 10,
  };
  const STATUS = { 5: "aberta", 6: "aberta", 8: "aberta", 7: "encerrada", 9: "encerrada", 10: "convertida" } as const;

  it("acerta a categoria do portal nas 20 capturas", () => {
    expect(Object.keys(BUCKET).sort()).toEqual(Object.keys(TODAS).sort());
    for (const [nome, html] of Object.entries(TODAS)) {
      expect(statusDaLinhaDoTempo(lerIdeiaDetalhe(html)), nome).toBe(STATUS[BUCKET[nome]]);
    }
  });

  it("adoção com a Sugestão ainda na CDH segue aberta (s6), não convertida", () => {
    expect(lerIdeiaDetalhe(adotadaInc).proposicoes).toHaveLength(1);
    expect(statusDaLinhaDoTempo(lerIdeiaDetalhe(adotadaInc))).toBe("aberta");
  });
});

describe("detalheParaCorpus e apoiosPublicados — a forma histórica do corpus", () => {
  it("data limite no nome histórico, UF sem nome, Sugestão no formato do histórico", () => {
    expect(detalheParaCorpus(lerIdeiaDetalhe(aberta))).toEqual({
      dataPublicacao: "2026-10-23", autorUf: "RJ", descricao: expect.stringMatching(/^Tendo em vista/), plConvertido: null,
    });
    expect(detalheParaCorpus(lerIdeiaDetalhe(emAvaliacao)).plConvertido).toBe("SUG 21/2019");
    expect(JSON.stringify(detalheParaCorpus(lerIdeiaDetalhe(aberta)))).not.toContain("NILTON");
  });

  it("descrição cortada no limite histórico de 2000", () => {
    const d = { ...lerIdeiaDetalhe(aberta), descricao: "x".repeat(2500) };
    expect(detalheParaCorpus(d).descricao).toHaveLength(2000);
  });

  it("apoios: o contador, senão o número do encerramento, senão null", () => {
    const d = lerIdeiaDetalhe(semApoio);
    expect(apoiosPublicados({ ...d, apoios: null })).toBe(17255);
    expect(apoiosPublicados({ ...lerIdeiaDetalhe(aberta), apoios: null })).toBeNull();
  });
});

describe("auxiliares", () => {
  it("partesDaProposicao", () => {
    expect(partesDaProposicao("Projeto de Lei nº 3630, de 2021 (Substitutivo-CD)")).toEqual({ tipoNome: "Projeto de Lei", numero: 3630, ano: 2021, complemento: "Substitutivo-CD" });
    expect(partesDaProposicao("Indicação (CD) nº 1.011, de 2026")).toEqual({ tipoNome: "Indicação (CD)", numero: 1011, ano: 2026, complemento: null });
    expect(partesDaProposicao("Consulta Pública")).toBeNull();
  });

  it("textoDoHtml junta tags de linha e separa as de bloco", () => {
    expect(textoDoHtml("pel<span>o</span>\n <span>Senador X (SP)</span><p>fim&nbsp;&amp; ponto</p>")).toBe("pelo Senador X (SP) fim & ponto");
  });
});
