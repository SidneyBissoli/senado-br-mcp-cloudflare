/**
 * A2 do ROADMAP — leitura vazia nunca apaga valor guardado, na CLASSE INTEIRA dos escritores do corpus
 * e-Cidadania, e o vigia de taxa de leitura por campo reprova a rodada em que o leitor deixa de
 * reconhecer a página.
 *
 * Origem: em 12/10/2026 a página de detalhe da ideia foi redesenhada; o leitor antigo devolvia
 * `autorUf`/`dataPublicacao` null em páginas lidas com sucesso, e o backfill (`detail ? detail.x :
 * prev.x`) apagou ~21 mil UFs e datas com o workflow verde. O teste percorre cada escritor com um
 * payload guardado completo e uma leitura VAZIA; e passa as fixtures reais da página nova pelo leitor
 * novo (A4) para provar que a rodada real volta a gravar e a ser aprovada.
 */

import { describe, it, expect } from "vitest";
import {
  mesclarCampo,
  apagarComMotivo,
  ehVazio,
  lerBrNum,
  vigiarCampos,
  descreverVigia,
  RETENCAO_MINIMA,
  N_MINIMO,
} from "../../src/scraper/mesclar.js";
import {
  buildConsultaResumo,
  buildEventoResumo,
  buildEventoResumoEnriquecido,
  buildIdeiaResumo,
  type IdeiaResumo,
} from "../../src/scraper/ecidadania.js";
import { consultasHighlightCfg, eventosHighlightCfg, ideiasHighlightCfg } from "../../src/scraper/pipeline.js";
import { registroDetalheIdeia, registroIdeia, CAMPOS_DETALHE_IDEIA } from "../../scripts/ingest-ecidadania/ideias-registro.js";
import { detalheParaCorpus, lerIdeiaDetalhe } from "../../src/scraper/ideia-detalhe.js";
import { parseConsultaListingPage } from "../../scripts/ingest-ecidadania/listing.js";

import p0 from "../fixtures/ecidadania/ideias-detalhe-2026-10/aberta-221186.html?raw";
import p1 from "../fixtures/ecidadania/ideias-detalhe-2026-10/adotada-deputada-senadora-144418.html?raw";
import p2 from "../fixtures/ecidadania/ideias-detalhe-2026-10/adotada-inc-200691.html?raw";
import p3 from "../fixtures/ecidadania/ideias-detalhe-2026-10/adotada-prc-55581.html?raw";
import p4 from "../fixtures/ecidadania/ideias-detalhe-2026-10/adotada-sem-20mil-102777.html?raw";
import p5 from "../fixtures/ecidadania/ideias-detalhe-2026-10/aguardando-219395.html?raw";
import p6 from "../fixtures/ecidadania/ideias-detalhe-2026-10/cdh-ins-108750.html?raw";
import p7 from "../fixtures/ecidadania/ideias-detalhe-2026-10/cdh-pec-104651.html?raw";
import p8 from "../fixtures/ecidadania/ideias-detalhe-2026-10/cdh-plp-198137.html?raw";
import p9 from "../fixtures/ecidadania/ideias-detalhe-2026-10/cdh-pls-100841.html?raw";
import p10 from "../fixtures/ecidadania/ideias-detalhe-2026-10/em-avaliacao-107433.html?raw";
import p11 from "../fixtures/ecidadania/ideias-detalhe-2026-10/oficina-especial-adotada-171655.html?raw";
import p12 from "../fixtures/ecidadania/ideias-detalhe-2026-10/oficina-medio-240545.html?raw";
import p13 from "../fixtures/ecidadania/ideias-detalhe-2026-10/oficina-outros-0800-220987.html?raw";
import p14 from "../fixtures/ecidadania/ideias-detalhe-2026-10/oficina-superior-220801.html?raw";
import p15 from "../fixtures/ecidadania/ideias-detalhe-2026-10/rejeitada-101909.html?raw";
import p16 from "../fixtures/ecidadania/ideias-detalhe-2026-10/rejeitada-adotada-136304.html?raw";
import p17 from "../fixtures/ecidadania/ideias-detalhe-2026-10/requerimento-19341.html?raw";
import p18 from "../fixtures/ecidadania/ideias-detalhe-2026-10/sem-apoio-101185.html?raw";
import p19 from "../fixtures/ecidadania/ideias-detalhe-2026-10/substitutivo-65884.html?raw";

// As 20 páginas 200 da amostra de 17/10 (a 410 não tem conteúdo de ideia).
const PAGINAS_NOVAS: string[] = [p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19];

const IDEIA_GUARDADA = buildIdeiaResumo({
  id: 101185,
  titulo: "Título guardado",
  apoios: 1234,
  dataPublicacao: "2020-01-10",
  autorUf: "SP",
  descricao: "Descrição guardada",
  plConvertido: "SUG 1/2020",
  status: "encerrada",
});
const DETALHE_VAZIO = { dataPublicacao: null, autorUf: null, descricao: null, plConvertido: null };
const payload = (r: { payloadJson: string }) => JSON.parse(r.payloadJson) as IdeiaResumo;

describe("mesclarCampo — a regra", () => {
  it("vazio lido (null, undefined, '', espaço, lista vazia, NaN) mantém o guardado", () => {
    for (const vazio of [null, undefined, "", "   ", NaN]) expect(mesclarCampo(vazio as never, "SP")).toBe("SP");
    expect(mesclarCampo([], ["a"])).toEqual(["a"]);
  });

  it("valor lido substitui o guardado; 0 é contagem lida, não vazio", () => {
    expect(mesclarCampo("RJ", "SP")).toBe("RJ");
    expect(mesclarCampo(0, 1234)).toBe(0);
    expect(ehVazio(0)).toBe(false);
  });

  it("os dois vazios dão null (nunca inventa)", () => {
    expect(mesclarCampo(null, undefined)).toBeNull();
    expect(mesclarCampo("", "")).toBeNull();
  });

  it("apagar exige pedido explícito com motivo", () => {
    expect(mesclarCampo(apagarComMotivo("ideia removida pelo portal"), "SP")).toBeNull();
    expect(() => apagarComMotivo("  ")).toThrow(/motivo/);
  });

  it("lerBrNum devolve null para ausente/lixo, onde parseBrNum devolveria 0", () => {
    expect(lerBrNum("1.234.567")).toBe(1234567);
    expect(lerBrNum(" 0 ")).toBe(0);
    expect(lerBrNum(42)).toBe(42);
    for (const x of [undefined, null, "", "abc", "12a", NaN, {}]) expect(lerBrNum(x)).toBeNull();
  });
});

describe("a classe dos escritores — leitura vazia não apaga nenhum campo guardado", () => {
  it("backfill de detalhe (o defeito-mãe): página lida com sucesso e campos null", () => {
    const r = payload(registroDetalheIdeia(JSON.stringify(IDEIA_GUARDADA), IDEIA_GUARDADA.id, DETALHE_VAZIO));
    expect(r).toEqual(IDEIA_GUARDADA);
  });

  it("backfill de detalhe: 410 troca só o status", () => {
    const r = payload(registroDetalheIdeia(JSON.stringify(IDEIA_GUARDADA), IDEIA_GUARDADA.id, null, true));
    expect(r).toEqual({ ...IDEIA_GUARDADA, status: "removida" });
  });

  it("crawl do corpus — listagem com título vazio", () => {
    const r = payload(registroIdeia(IDEIA_GUARDADA.id, { titulo: "", apoios: 1300, status: "encerrada" }, JSON.stringify(IDEIA_GUARDADA)));
    expect(r).toEqual({ ...IDEIA_GUARDADA, apoios: 1300 });
  });

  it("crawl do corpus — transição sem contagem e com detalhe vazio", () => {
    const r = payload(registroIdeia(IDEIA_GUARDADA.id, { apoios: null, status: "convertida" }, JSON.stringify(IDEIA_GUARDADA), DETALHE_VAZIO));
    expect(r).toEqual({ ...IDEIA_GUARDADA, status: "convertida" });
  });

  it("splice de 2 h das ideias — destaque REST sem apoiamentos", () => {
    expect(ideiasHighlightCfg.splice(IDEIA_GUARDADA, { id: IDEIA_GUARDADA.id, titulo: "", apoios: null })).toEqual(IDEIA_GUARDADA);
    // Destaque novo sem contagem: não grava um 0 inventado.
    expect(ideiasHighlightCfg.splice(undefined, { id: 9, titulo: "Nova", apoios: null })).toBeNull();
    expect(ideiasHighlightCfg.splice(undefined, { id: 9, titulo: "Nova", apoios: 0 })?.apoios).toBe(0);
  });

  it("splice de 2 h das consultas — destaque REST sem placar", () => {
    const guardada = buildConsultaResumo({
      id: 100, materia: "PL 1/2024", ementa: "Ementa", votosSim: 10, votosNao: 5, totalVotos: 16,
      autoria: "Senador X", relator: "Senadora Y", status: "encerrada",
    });
    const vazio = { id: 100, materia: "", ementa: "", votosSim: null, votosNao: null, totalVotos: null };
    expect(consultasHighlightCfg.splice(guardada, vazio)).toEqual(guardada);
    expect(consultasHighlightCfg.splice(undefined, vazio)).toBeNull();
  });

  it("splice de 2 h dos eventos — preserva o corpus inteiro", () => {
    const guardado = buildEventoResumo({ id: 7, titulo: "Audiência", local: "Plenário 2", descricao: "D", pauta: ["p"], comentarios: 12, status: "encerrado" });
    const fresco = buildEventoResumo({ id: 7, titulo: "", comentarios: 0 });
    expect(eventosHighlightCfg.splice(guardado, fresco)).toEqual(guardado);
  });

  it("enriquecimento de eventos — detalhe e comentários falharam", () => {
    const guardado = buildEventoResumo({
      id: 7, titulo: "Audiência", data: "2026-05-01", hora: "10:00", comissao: "CDH", comissaoNomeCompleto: "Comissão de DH",
      local: "Plenário 2", descricao: "D", pauta: ["p"], convidados: ["c"], videoUrl: "https://v", comentarios: 12, status: "encerrado",
    });
    const r = buildEventoResumoEnriquecido({
      id: 7, titulo: "Audiência", comissao: "CDH", status: "encerrado",
      dataListagem: "2026-05-01", horaListagem: "09:00", comentariosListagem: 0,
      detalhe: null, comentariosCanon: null, guardado,
    });
    expect(r).toEqual(guardado);
  });

  it("listagem de consultas — bloco sem placar dá null, não 0", () => {
    const html = `<div class="resumo-materia"><header><a href="visualizacaomateria?id=5">PL 5/2024</a></header><section><a href="x">Ementa</a></section></div>`;
    expect(parseConsultaListingPage(html)[0]).toMatchObject({ codigoMateria: 5, votosSim: null, votosNao: null });
    // O link vazio só vale como 0 × 0 se apontar para a PRÓPRIA consulta.
    const outro = `<div class="resumo-materia"><header><a href="visualizacaomateria?id=5">PL 5/2024</a></header><a href="visualizacaomateria?id=6"> </a></div>`;
    expect(parseConsultaListingPage(outro)[0]).toMatchObject({ votosSim: null, votosNao: null });
  });
});

describe("vigia de taxa de leitura por campo", () => {
  const par = (lido: Record<string, unknown>, guardado?: Record<string, unknown>) => ({ lido, guardado });

  it("compara a leitura com os MESMOS ids guardados preenchidos", () => {
    const pares = [
      ...Array.from({ length: 60 }, () => par({ autorUf: null }, { autorUf: "SP" })),
      ...Array.from({ length: 40 }, () => par({ autorUf: "RJ" }, { autorUf: null })), // não contam
    ];
    const v = vigiarCampos(pares, ["autorUf"]);
    expect(v.campos[0]).toEqual({ campo: "autorUf", guardados: 60, lidos: 0, retencao: 0 });
    expect(v.ok).toBe(false);
    expect(descreverVigia(v)).toBe("autorUf 0/60 (0.0%)");
  });

  it("retenção no mínimo (90%) passa; abaixo, com n suficiente, reprova", () => {
    expect(RETENCAO_MINIMA).toBe(0.9);
    const comPerdas = (perdas: number) =>
      Array.from({ length: 100 }, (_, i) => par({ autorUf: i < perdas ? null : "SP" }, { autorUf: "SP" }));
    expect(vigiarCampos(comPerdas(10), ["autorUf"]).ok).toBe(true);
    expect(vigiarCampos(comPerdas(11), ["autorUf"]).ok).toBe(false);
  });

  it("abaixo do n mínimo fica mudo (o splice de 2 h lê ~5 itens)", () => {
    const poucos = Array.from({ length: N_MINIMO - 1 }, () => par({ autorUf: null }, { autorUf: "SP" }));
    expect(vigiarCampos(poucos, ["autorUf"]).ok).toBe(true);
  });

  it("sem guardado (item novo) não entra na conta", () => {
    const v = vigiarCampos(Array.from({ length: 100 }, () => par({ autorUf: null })), ["autorUf"]);
    expect(v.campos[0].guardados).toBe(0);
    expect(v.ok).toBe(true);
  });
});

describe("o caso de 12/10/2026, com as páginas reais — pelo leitor NOVO (A4)", () => {
  // Até a A4 este bloco passava as 20 páginas pelo leitor ANTIGO e provava as duas defesas: o backfill
  // mantinha UF e data guardadas, e o vigia reprovava a rodada (retenção 0). Com o leitor novo ligado
  // (fase A4), a prova se inverte: as páginas são lidas, a mesclagem grava o que leu e o vigia APROVA.
  const paginas = PAGINAS_NOVAS;
  const lidas = paginas.map((html) => detalheParaCorpus(lerIdeiaDetalhe(html)));

  it("o leitor novo acha UF e data limite nas 20 páginas", () => {
    expect(lidas.length).toBe(20);
    for (const d of lidas) {
      expect(d.autorUf).toMatch(/^[A-Z]{2}$/);
      expect(d.dataPublicacao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("o backfill grava o que leu (nunca o vazio)", () => {
    for (const d of lidas) {
      const r = payload(registroDetalheIdeia(JSON.stringify(IDEIA_GUARDADA), IDEIA_GUARDADA.id, d));
      expect(r.autorUf).toBe(d.autorUf);
      expect(r.dataPublicacao).toBe(d.dataPublicacao);
    }
  });

  it("o vigia aprova a rodada", () => {
    // O guardado de cada página tem Sugestão só quando a página tem: o leitor novo põe em plConvertido
    // apenas a Sugestão (adoção por parlamentar fica para a A6), e um guardado inventado mediria nada.
    const pares = lidas.map((d) => ({
      lido: { ...d } as Record<string, unknown>,
      guardado: { ...IDEIA_GUARDADA, plConvertido: d.plConvertido ? IDEIA_GUARDADA.plConvertido : null } as unknown as Record<string, unknown>,
    }));
    const v = vigiarCampos(pares, CAMPOS_DETALHE_IDEIA, { nMinimo: pares.length });
    expect(v.quedas.map((q) => q.campo)).toEqual([]);
    expect(v.ok).toBe(true);
  });
});
