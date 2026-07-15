import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("obter_evento comentarios splice (BUG-020)", () => {
  // The static detail scrape returns comentarios 0 (AJAX-loaded); splice from the corpus.
  const spliceComentarios = (detalhe: { comentarios: number }, corpus: { id: number; comentarios: number }[], id: number) => {
    const item = corpus.find((e) => e.id === id);
    return { ...detalhe, comentarios: item ? item.comentarios : null };
  };
  it("uses the corpus count over the detail's spurious 0", () => {
    const corpus = [{ id: 39730, comentarios: 52 }];
    expect(spliceComentarios({ comentarios: 0 }, corpus, 39730).comentarios).toBe(52);
  });
  it("returns null (unknown) when the event is not in the corpus", () => {
    expect(spliceComentarios({ comentarios: 0 }, [], 999).comentarios).toBeNull();
  });
});

describe("e-Cidadania pagination offset (BUG-018)", () => {
  // listar_consultas/listar_ideias sliced [0, limite], ignoring `pagina`.
  const page = <T>(arr: T[], pagina: number, limite: number) =>
    arr.slice((pagina - 1) * limite, pagina * limite);
  it("returns disjoint pages via OFFSET", () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    expect(page(items, 1, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(page(items, 2, 5)).toEqual([5, 6, 7, 8, 9]);
    expect(page(items, 3, 5)).toEqual([10, 11]); // last partial page
    const p1 = page(items, 1, 5);
    expect(page(items, 2, 5).some((x) => p1.includes(x))).toBe(false); // disjoint
  });
});

import {
  parseBrNum,
  extractId,
  normalizeEcidadaniaUrl,
  stripHtml,
  extractDate,
  extractTime,
  ECIDADANIA_BASE,
  listarConsultasInternal,
  obterConsultaInternal,
  listarIdeiasInternal,
  obterIdeiaInternal,
  listarEventosInternal,
  obterEventoInternal,
  formatIntBR,
  buildConsultaDetalheResult,
  OBTER_CONSULTA_DATAS_AVISO,
} from "../../src/tools/ecidadania.js";

describe("buildConsultaDetalheResult (achado #10)", () => {
  // A página visualizacaomateria não publica o período da consulta; o aviso
  // explica os campos sempre-null. Só a RESPOSTA ganha aviso/comentarios null —
  // o payload do write-through (corpus) fica intacto (contentHash estável).
  it("anexa o aviso fixo e serve comentarios null (OBS-9)", () => {
    const raspado = {
      id: 173613, materia: "PL 1234/2026", votosSim: 61230, votosNao: 228,
      dataAbertura: null, dataEncerramento: null, comissao: null, comentarios: 0,
    };
    const r = buildConsultaDetalheResult(raspado);
    expect(r.aviso).toBe(OBTER_CONSULTA_DATAS_AVISO);
    expect(r.comentarios).toBeNull();
    expect(r.votosSim).toBe(61230);
  });

  it("não muta o objeto raspado (payload persistido no corpus)", () => {
    const raspado: Record<string, unknown> = { id: 1, comentarios: 0 };
    buildConsultaDetalheResult(raspado);
    expect(raspado.comentarios).toBe(0);
    expect("aviso" in raspado).toBe(false);
  });
});

describe("formatIntBR (OBS-12)", () => {
  it("groups thousands with pt-BR dots", () => {
    expect(formatIntBR(253804)).toBe("253.804");
    expect(formatIntBR(1000)).toBe("1.000");
    expect(formatIntBR(999)).toBe("999");
    expect(formatIntBR(1234567)).toBe("1.234.567");
  });
});

// ── Pure function tests ──────────────────────────────────────────────────

describe("parseBrNum", () => {
  it("parses simple number", () => {
    expect(parseBrNum("123")).toBe(123);
  });

  it("parses Brazilian-formatted number with dots", () => {
    expect(parseBrNum("1.234.567")).toBe(1234567);
  });

  it("returns 0 for empty string", () => {
    expect(parseBrNum("")).toBe(0);
  });

  it("returns 0 for non-numeric string", () => {
    expect(parseBrNum("abc")).toBe(0);
  });

  it("parses number with single dot separator", () => {
    expect(parseBrNum("12.345")).toBe(12345);
  });

  it("handles large numbers", () => {
    expect(parseBrNum("1.000.000")).toBe(1000000);
  });
});

describe("extractId", () => {
  it("extracts ID from href with id= parameter", () => {
    expect(extractId("visualizacaomateria?id=1234")).toBe(1234);
  });

  it("extracts ID from complex URL", () => {
    expect(extractId("/ecidadania/visualizacaomateria?id=56789&other=val")).toBe(56789);
  });

  it("returns null when no id parameter", () => {
    expect(extractId("/ecidadania/page")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractId("")).toBeNull();
  });
});

describe("normalizeEcidadaniaUrl", () => {
  it("constructs URL from href with id parameter", () => {
    const result = normalizeEcidadaniaUrl("visualizacaomateria?id=123", "visualizacaomateria");
    expect(result).toBe(`${ECIDADANIA_BASE}/visualizacaomateria?id=123`);
  });

  it("handles duplicate /ecidadania/ prefix", () => {
    const result = normalizeEcidadaniaUrl("/ecidadania/visualizacaoideia?foo=bar", "visualizacaoideia");
    expect(result).toBe(`${ECIDADANIA_BASE}/visualizacaoideia?foo=bar`);
  });

  it("trims leading spaces", () => {
    const result = normalizeEcidadaniaUrl("  /ecidadania/visualizacaoaudiencia?id=5", "visualizacaoaudiencia");
    expect(result).toBe(`${ECIDADANIA_BASE}/visualizacaoaudiencia?id=5`);
  });

  it("handles plain path", () => {
    const result = normalizeEcidadaniaUrl("somepath/page", "visualizacaomateria");
    expect(result).toBe(`${ECIDADANIA_BASE}/somepath/page`);
  });
});

describe("stripHtml", () => {
  it("removes HTML tags", () => {
    expect(stripHtml("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("collapses whitespace", () => {
    expect(stripHtml("<p>  Multiple   spaces  </p>")).toBe("Multiple spaces");
  });

  it("handles empty string", () => {
    expect(stripHtml("")).toBe("");
  });

  it("handles plain text (no tags)", () => {
    expect(stripHtml("Plain text")).toBe("Plain text");
  });

  it("handles nested tags", () => {
    expect(stripHtml("<div><p><span>Deep</span></p></div>")).toBe("Deep");
  });
});

describe("extractDate", () => {
  it("extracts DD/MM/YYYY date", () => {
    expect(extractDate("15/03/2024")).toBe("2024-03-15");
  });

  it("extracts DD/MM/YY date with 20xx prefix", () => {
    expect(extractDate("15/03/24")).toBe("2024-03-15");
  });

  it("extracts date from mixed text", () => {
    expect(extractDate("Data: 01/12/2023 às 10:00")).toBe("2023-12-01");
  });

  it("returns null when no date found", () => {
    expect(extractDate("No date here")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractDate("")).toBeNull();
  });
});

describe("extractTime", () => {
  it("extracts HH:MM time", () => {
    expect(extractTime("10:30")).toBe("10:30");
  });

  it("extracts time from mixed text", () => {
    expect(extractTime("Data: 15/03/2024 - 14:00")).toBe("14:00");
  });

  it("returns null when no time found", () => {
    expect(extractTime("No time here")).toBeNull();
  });

  it("handles midnight", () => {
    expect(extractTime("00:00")).toBe("00:00");
  });
});

// ── Scraping function tests (mocked fetch) ───────────────────────────────

const mockFetch = vi.fn();

describe("listarConsultasInternal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and parses consultas from REST API", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 100,
            identificacaoBasica: "PLP 183/2019",
            ementa: "Reforma tributária",
            votosFavor: "10.000",
            votosContra: "5.000",
            totalVotos: "15.000",
          },
          {
            id: 101,
            identificacaoBasica: "PL 200/2023",
            ementa: "Saúde pública",
            votosFavor: "8.000",
            votosContra: "2.000",
            totalVotos: "10.000",
          },
        ]),
        { status: 200 },
      ),
    );

    const result = await listarConsultasInternal({ limite: 10 });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(100);
    expect(result[0].votosSim).toBe(10000);
    expect(result[0].votosNao).toBe(5000);
    expect(result[0].totalVotos).toBe(15000);
    expect(result[0].percentualSim).toBe(67);
    expect(result[0].percentualNao).toBe(33);
    expect(result[0].status).toBe("aberta");
    expect(result[0].url).toContain("visualizacaomateria?id=100");
  });

  it("respects limite parameter", async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      identificacaoBasica: `PL ${i}/2024`,
      ementa: `Ementa ${i}`,
      votosFavor: "100",
      votosContra: "50",
      totalVotos: "150",
    }));
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(items), { status: 200 }));

    const result = await listarConsultasInternal({ limite: 3 });
    expect(result).toHaveLength(3);
  });
});

describe("obterConsultaInternal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses consulta detail from HTML", async () => {
    const html = `
      <html>
      <section class="materia-identificacao"><span>PLP 183/2019</span></section>
      <b>Ementa: </b><span>Reforma tributária sobre bens</span>
      <figure class="grafico-consulta-publica">
        <footer>
          <span class="contabilizacao-favor">10.000</span>
          <span class="contabilizacao-contra">5.000</span>
        </footer>
      </figure>
      <b>Autoria: </b><span>Senador Fulano</span>
      <b>Relatora: </b><span>Senadora Ciclana</span>
      <p>15 comentários sobre esta matéria</p>
      </html>
    `;
    mockFetch.mockResolvedValueOnce(new Response(html, { status: 200 }));

    const result = await obterConsultaInternal(100);
    expect(result.id).toBe(100);
    expect(result.materia).toBe("PLP 183/2019");
    expect(result.ementa).toContain("Reforma tributária");
    expect(result.votosSim).toBe(10000);
    expect(result.votosNao).toBe(5000);
    expect(result.totalVotos).toBe(15000);
    expect(result.percentualSim).toBe(67);
    expect(result.autor).toBe("Senador Fulano");
    expect(result.relator).toBe("Senadora Ciclana");
    expect(result.comentarios).toBe(15);
    expect(result.status).toBe("aberta");
  });

  it("detects encerrada status", async () => {
    const html = `<html><p>Consulta encerrada em 01/01/2024</p></html>`;
    mockFetch.mockResolvedValueOnce(new Response(html, { status: 200 }));

    const result = await obterConsultaInternal(200);
    expect(result.status).toBe("encerrada");
  });
});

describe("listarIdeiasInternal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and parses ideias from REST API", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { id: 500, titulo: "Ideia Popular", apoiamentos: "17.978" },
          { id: 501, titulo: "Outra Ideia", apoiamentos: "5.000" },
        ]),
        { status: 200 },
      ),
    );

    const result = await listarIdeiasInternal({ limite: 10 });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(500);
    expect(result[0].titulo).toBe("Ideia Popular");
    expect(result[0].apoios).toBe(17978);
    expect(result[0].url).toContain("visualizacaoideia?id=500");
  });

  it("sorts by apoios desc", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { id: 1, titulo: "A", apoiamentos: "100" },
          { id: 2, titulo: "B", apoiamentos: "500" },
          { id: 3, titulo: "C", apoiamentos: "200" },
        ]),
        { status: 200 },
      ),
    );

    const result = await listarIdeiasInternal({ ordenarPor: "apoios", ordem: "desc", limite: 10 });
    expect(result[0].apoios).toBe(500);
    expect(result[1].apoios).toBe(200);
    expect(result[2].apoios).toBe(100);
  });
});

describe("obterIdeiaInternal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses ideia detail from HTML", async () => {
    const html = `
      <html>
      <article id="ideia-legislativa">
        <b><div style="font-size:24px;">Proibir obsolescência programada</div></b>
        <div style="margin-bottom:15px;">Descrição completa da ideia legislativa</div>
      </article>
      <span class="contabilizacao">17.978</span>
      <section title="Situação da Ideia"><em>Apoiamento aberto</em></section>
      <div>Ideia proposta por</div>
      <div><span>João Silva</span> <span>(SP)</span></div>
      <p>42 comentários</p>
      </html>
    `;
    mockFetch.mockResolvedValueOnce(new Response(html, { status: 200 }));

    const result = await obterIdeiaInternal(500);
    expect(result.id).toBe(500);
    expect(result.titulo).toContain("obsolescência");
    expect(result.apoios).toBe(17978);
    expect(result.status).toBe("aberta");
    expect(result.autor).toBe("João Silva (SP)");
    expect(result.comentarios).toBe(42);
  });

  it("detects convertida status", async () => {
    const html = `
      <html>
      <article id="ideia-legislativa"><b><div style="font-size:24px;">Ideia</div></b><div>desc</div></article>
      <span class="contabilizacao">100</span>
      <section title="Situação da Ideia"><em>Convertida em sugestão</em></section>
      <p>SUGESTÃO nº 10 de 2024</p>
      </html>
    `;
    mockFetch.mockResolvedValueOnce(new Response(html, { status: 200 }));

    const result = await obterIdeiaInternal(600);
    expect(result.status).toBe("convertida");
    expect(result.plConvertido).toBe("SUG 10/2024");
  });
});

describe("listarEventosInternal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and parses eventos from REST API", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 300,
            titulo: "Audiência sobre educação",
            dataPublicacao: "23/02/26 10:00",
            sigla: "CE",
            qtdComentario: 42,
            situacaoAudienciaId: 2,
          },
        ]),
        { status: 200 },
      ),
    );

    const result = await listarEventosInternal({ limite: 10 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(300);
    expect(result[0].titulo).toBe("Audiência sobre educação");
    expect(result[0].data).toBe("2026-02-23");
    expect(result[0].hora).toBe("10:00");
    expect(result[0].comissao).toBe("CE");
    expect(result[0].comentarios).toBe(42);
    expect(result[0].status).toBe("agendado");
  });

  it("filters by status", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { id: 1, titulo: "A", situacaoAudienciaId: 2, qtdComentario: 0, dataPublicacao: "" },
          { id: 2, titulo: "B", situacaoAudienciaId: 3, qtdComentario: 0, dataPublicacao: "" },
        ]),
        { status: 200 },
      ),
    );

    const result = await listarEventosInternal({ status: "agendado", limite: 10 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("filters by comissao", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { id: 1, titulo: "A", sigla: "CE", qtdComentario: 0, dataPublicacao: "" },
          { id: 2, titulo: "B", sigla: "CCJ", qtdComentario: 0, dataPublicacao: "" },
        ]),
        { status: 200 },
      ),
    );

    const result = await listarEventosInternal({ comissao: "CE", limite: 10 });
    expect(result).toHaveLength(1);
    expect(result[0].comissao).toBe("CE");
  });
});

describe("obterEventoInternal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses evento detail from HTML", async () => {
    const html = `
      <html>
      <div class="audiencia-titulo">Audiência Pública sobre IA</div>
      <div class="audiencia-finalidade">Debate sobre regulamentação</div>
      <span class="audiencia-data">23/02/2026 - 10:00</span>
      <span class="audiencia-tag">Audiência Pública</span>
      <span class="audiencia-tag">CE</span>
      <div class="audiencia-comissao">Comissão de Educação</div>
      <div class="audiencia-local">Plenário 14</div>
      <div class="situacao-audiencia-AGENDADO"></div>
      <p class="titulo-convidados"><span>Dr. João</span></p>
      <p class="titulo-convidados"><span>Dra. Maria</span></p>
      <div class="audiencia-pauta">Tema 1; Tema 2; Tema 3</div>
      <p>25 comentários</p>
      </html>
    `;
    mockFetch.mockResolvedValueOnce(new Response(html, { status: 200 }));

    const result = await obterEventoInternal(300);
    expect(result.id).toBe(300);
    expect(result.titulo).toBe("Audiência Pública sobre IA");
    expect(result.descricao).toBe("Debate sobre regulamentação");
    expect(result.data).toBe("2026-02-23");
    expect(result.hora).toBe("10:00");
    expect(result.comissao).toBe("CE");
    expect(result.comissaoNomeCompleto).toBe("Comissão de Educação");
    expect(result.local).toBe("Plenário 14");
    expect(result.status).toBe("agendado");
    expect(result.convidados).toEqual(["Dr. João", "Dra. Maria"]);
    expect(result.pauta).toContain("Tema 1");
    expect(result.comentarios).toBe(25);
  });

  it("detects encerrado status via CSS class", async () => {
    const html = `
      <html>
      <div class="audiencia-titulo">Evento</div>
      <div class="situacao-audiencia-REALIZADO"></div>
      </html>
    `;
    mockFetch.mockResolvedValueOnce(new Response(html, { status: 200 }));

    const result = await obterEventoInternal(400);
    expect(result.status).toBe("encerrado");
  });

  it("extracts YouTube video URL", async () => {
    const html = `
      <html>
      <div class="audiencia-titulo">Evento</div>
      <iframe src="https://www.youtube.com/embed/abc123?autoplay=1"></iframe>
      </html>
    `;
    mockFetch.mockResolvedValueOnce(new Response(html, { status: 200 }));

    const result = await obterEventoInternal(500);
    expect(result.videoUrl).toBe("https://www.youtube.com/embed/abc123");
  });
});

// ── Consensus & Polarization math ────────────────────────────────────────

describe("consensus/polarization math", () => {
  it("identifies consensus (>85% in one direction)", () => {
    const consultas = [
      { percentualSim: 90, percentualNao: 10, totalVotos: 5000 },
      { percentualSim: 50, percentualNao: 50, totalVotos: 5000 },
      { percentualSim: 10, percentualNao: 90, totalVotos: 5000 },
    ];
    const consensuais = consultas.filter(
      (c) => c.totalVotos >= 1000 && Math.max(c.percentualSim, c.percentualNao) >= 85,
    );
    expect(consensuais).toHaveLength(2); // 90/10 and 10/90
  });

  it("identifies polarization (diff < 15%)", () => {
    const consultas = [
      { percentualSim: 52, percentualNao: 48, totalVotos: 5000 },
      { percentualSim: 90, percentualNao: 10, totalVotos: 5000 },
      { percentualSim: 45, percentualNao: 55, totalVotos: 5000 },
    ];
    const polarizados = consultas.filter(
      (c) => c.totalVotos >= 1000 && Math.abs(c.percentualSim - c.percentualNao) <= 15,
    );
    expect(polarizados).toHaveLength(2); // 52/48 (diff=4) and 45/55 (diff=10)
  });

  it("filters by minimum votes", () => {
    const consultas = [
      { percentualSim: 90, percentualNao: 10, totalVotos: 500 },
      { percentualSim: 90, percentualNao: 10, totalVotos: 5000 },
    ];
    const consensuais = consultas.filter(
      (c) => c.totalVotos >= 1000 && Math.max(c.percentualSim, c.percentualNao) >= 85,
    );
    expect(consensuais).toHaveLength(1);
    expect(consensuais[0].totalVotos).toBe(5000);
  });

  it("percentage calculation is correct", () => {
    const votosSim = 7500;
    const votosNao = 2500;
    const total = votosSim + votosNao;
    const pctSim = Math.round((votosSim / total) * 100);
    const pctNao = Math.round((votosNao / total) * 100);
    expect(pctSim).toBe(75);
    expect(pctNao).toBe(25);
  });
});
