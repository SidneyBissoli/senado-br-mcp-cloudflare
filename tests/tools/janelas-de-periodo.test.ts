/**
 * Janelas de período, ponta a ponta nas tools (decisões do dono de 30/10/2026).
 *
 * Os handlers são capturados dos registradores e chamados com a fonte DUBLADA por URL — o
 * caminho real (`cachedFetchWithMeta` → `upstreamFetch`), só sem rede. Cada caso fixa o que foi
 * medido no ar em 30/10/2026: a agenda de comissões corta calada em ~30 dias, os discursos do
 * senador em 12 meses, os apartes ignoram o período, o plenário recusa mais de 1 mês, `/votacao`
 * e `/processo/emenda` mais de 1 ano, e a janela invertida passava calada como lista vazia.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upstreamIo } from "../../src/throttle/upstream.js";
import * as tokenBucket from "../../src/throttle/token-bucket.js";
import { _resetStore } from "../../src/cache/l0-memory.js";
import { relogioJanela } from "../../src/utils/janela.js";
import { registerComissoesTools } from "../../src/tools/comissoes.js";
import { registerDiscursosTools } from "../../src/tools/discursos.js";
import { registerVotacoesTools } from "../../src/tools/votacoes.js";
import { registerSenadoresTools } from "../../src/tools/senadores.js";
import { registerMateriasTools } from "../../src/tools/materias.js";
import { registerProcessosTools } from "../../src/tools/processos.js";
import { registerVotacaoComissaoTools } from "../../src/tools/votacao-comissao.js";
import { registerPlenarioTools } from "../../src/tools/plenario.js";

type Resultado = { isError?: boolean; content: Array<{ text: string }>; structuredContent?: any };
type Callback = (params: Record<string, unknown>) => Promise<Resultado>;

const BASE = "https://legis.senado.leg.br/dadosabertos";
const tools = new Map<string, Callback>();
{
  const host = {
    tool: (name: string, _d: string, _s: unknown, cb: Callback) => void tools.set(name, cb),
  } as never;
  for (const registrar of [
    registerComissoesTools, registerDiscursosTools, registerVotacoesTools, registerSenadoresTools,
    registerMateriasTools, registerProcessosTools, registerVotacaoComissaoTools, registerPlenarioTools,
  ]) registrar(host, BASE);
}
const chamar = (nome: string, params: Record<string, unknown>) => tools.get(nome)!(params);

/** Fonte dublada: cada URL pedida é registrada e respondida por `rotas`. */
let pedidas: string[] = [];
function fonte(rotas: (url: URL) => unknown | Response) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    pedidas.push(url.pathname.replace("/dadosabertos", "") + url.search);
    const r = rotas(url);
    if (r instanceof Response) return r;
    return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
  }));
}
const erro500 = () => new Response("", { status: 500 });
const erroDoTexto = (r: Resultado) => JSON.parse(r.content[0].text).error as string;
const vintage = (r: Resultado) => r.structuredContent.provenance.data_vintage as string;

beforeEach(() => {
  _resetStore();
  pedidas = [];
  vi.spyOn(upstreamIo, "sleep").mockResolvedValue(undefined);
  vi.spyOn(upstreamIo, "random").mockReturnValue(0);
  vi.spyOn(tokenBucket.globalBucket, "tryConsume").mockReturnValue(true);
  // "Hoje" = 30/10/2026, meio-dia em Brasília.
  vi.spyOn(relogioJanela, "agora").mockReturnValue(new Date("2026-10-30T15:00:00Z"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("decisão 3 — janela invertida é recusada antes da fonte, nas dez tools", () => {
  const casos: Array<[string, Record<string, unknown>]> = [
    ["senado_reunioes_comissao", { sigla: "CCJ", dataInicio: "20261030", dataFim: "20260101" }],
    ["senado_discursos_senador", { codigoSenador: 5672, dataInicio: "20261030", dataFim: "20260101" }],
    ["senado_discursos_plenario", { dataInicio: "20261030", dataFim: "20260101" }],
    ["senado_buscar_materias", { sigla: "PL", dataInicioApresentacao: "2026-10-30", dataFimApresentacao: "2026-01-01" }],
    ["senado_search_processos", { sigla: "PL", dataInicioApresentacao: "20261030", dataFimApresentacao: "20260101" }],
    ["senado_processo_detalhe", { secao: "emendas", dataInicio: "20261030", dataFim: "20260101" }],
    ["senado_votacoes_senador", { codigoSenador: 5672, dataInicio: "20261030", dataFim: "20260101" }],
    ["senado_votacao_comissao", { por: "comissao", siglaComissao: "CCJ", dataInicio: "20261030", dataFim: "20260101" }],
    ["senado_search_votacoes", { dataInicio: "20261030", dataFim: "20260101" }],
    ["senado_orientacao_bancada", { dataInicio: "20261030", dataFim: "20260101" }],
  ];
  it.each(casos)("%s", async (nome, params) => {
    fonte(() => { throw new Error("não devia ir à fonte"); });
    const r = await chamar(nome, params);
    expect(r.isError).toBe(true);
    expect(erroDoTexto(r)).toBe("A data de fim (01/01/2026) é anterior à de início (30/10/2026); corrija o período.");
    expect(pedidas).toEqual([]);
  });
});

describe("decisões 1 e 4 — senado_reunioes_comissao lê dia a dia, até 30 dias", () => {
  const reuniao = (codigo: number, sigla: string, dataInicio: string, extra: Record<string, unknown> = {}) => ({
    codigo: String(codigo), descricao: `${codigo}ª`, colegiadoCriador: { sigla }, dataInicio, situacao: "Realizada", ...extra,
  });
  const agenda = (...reunioes: unknown[]) => ({ AgendaReuniao: { reunioes: { reuniao: reunioes } } });

  it("refuses a window over 30 days, without going to the source", async () => {
    fonte(() => { throw new Error("não devia ir à fonte"); });
    const r = await chamar("senado_reunioes_comissao", { sigla: "CCJ", dataInicio: "20260701", dataFim: "20261030" });
    expect(r.isError).toBe(true);
    expect(erroDoTexto(r)).toBe(
      "A agenda de comissões aceita até 30 dias por consulta (limite da fonte), e o período pedido vai de 01/07/2026 a 30/10/2026 (121 dias). Divida em consultas de até 30 dias.",
    );
    expect(pedidas).toEqual([]);
  });

  it("one read per day; the creating committee only; a failed day is NAMED; the future goes to agendaPrevista", async () => {
    fonte((url) => {
      const dia = url.pathname.match(/agenda\/(\d{8})\.json$/)![1];
      if (dia === "20261029") return erro500();
      if (dia === "20261028") {
        // 14880-like: a CAS meeting that mentions the CCJ in its content is NOT a CCJ meeting.
        return agenda(reuniao(1, "CCJ", "2026-10-28T10:00:00"), reuniao(2, "CAS", "2026-10-28T11:00:00", { partes: { sigla: "CCJ" } }));
      }
      if (dia === "20261030") return agenda(reuniao(3, "CCJ", "2026-10-30T09:00:00"));
      return agenda(reuniao(4, "CCJ", "2026-10-31T09:00:00", { situacao: "Agendada" }));
    });
    const r = await chamar("senado_reunioes_comissao", { sigla: "ccj", dataInicio: "20261028", dataFim: "20261031" });
    expect(r.isError).toBeFalsy();
    expect(pedidas.filter((p) => !p.includes("20261029")).sort()).toEqual([
      "/comissao/agenda/20261028.json", "/comissao/agenda/20261030.json", "/comissao/agenda/20261031.json",
    ]);
    const s = r.structuredContent;
    expect(s.reunioes.map((x: any) => x.codigo)).toEqual([1, 3]);
    expect(s.count).toBe(2);
    expect(s.agendaPrevista.count).toBe(1);
    expect(s.agendaPrevista.reunioes[0]).toMatchObject({ codigo: 4, data: "2026-10-31", situacao: "Agendada" });
    expect(s.agendaPrevista.aviso).toMatch(/previsão e podem mudar/);
    expect(s.diasNaoLidos).toEqual(["2026-10-29"]);
    expect(s.aviso).toBe("A fonte falhou ao entregar este dia, que ficou FORA da lista: 29/10/2026. Repita a consulta mais tarde para cobri-lo.");
    expect(vintage(r)).toBe("2026-10-28/2026-10-30 (pedido até 2026-10-31)");
  });

  it("a meeting listed on two days (continuation) counts once; no future, no agendaPrevista", async () => {
    fonte(() => agenda(reuniao(7, "CAE", "2026-08-11T10:00:00")));
    const r = await chamar("senado_reunioes_comissao", { sigla: "CAE", dataInicio: "20260811", dataFim: "20260812" });
    expect(r.structuredContent.count).toBe(1);
    expect(r.structuredContent).not.toHaveProperty("agendaPrevista");
    expect(vintage(r)).toBe("2026-08-11/2026-08-12");
  });

  it("every day failing is an error, not an empty list", async () => {
    fonte(() => erro500());
    const r = await chamar("senado_reunioes_comissao", { sigla: "CCJ", dataInicio: "20260811", dataFim: "20260812" });
    expect(r.isError).toBe(true);
  });
});

describe("decisão 2 — discursos do senador ano a ano; apartes filtrados pelo período", () => {
  const discursos = (...datas: string[]) => ({
    DiscursosParlamentar: { Parlamentar: {
      IdentificacaoParlamentar: { NomeParlamentar: "Fulano" },
      Pronunciamentos: { Pronunciamento: datas.map((d, i) => ({ CodigoPronunciamento: `${d}-${i}`, DataPronunciamento: d })) },
    } },
  });

  it("over 1 year: one read per calendar year, merged; the stamp keeps the whole window", async () => {
    fonte((url) => {
      const ano = url.searchParams.get("dataInicio")!.slice(0, 4);
      return discursos(`${ano}-03-10`, `${ano}-09-02`);
    });
    const r = await chamar("senado_discursos_senador", { codigoSenador: 5672, dataInicio: "20240101", dataFim: "20261030" });
    expect(pedidas.sort()).toEqual([
      "/senador/5672/discursos.json?dataFim=20241231&dataInicio=20240101",
      "/senador/5672/discursos.json?dataFim=20251231&dataInicio=20250101",
      "/senador/5672/discursos.json?dataFim=20261030&dataInicio=20260101",
    ]);
    expect(r.structuredContent.count).toBe(6);
    expect(r.structuredContent.discursos[0].nomeParlamentar).toBe("Fulano");
    expect(vintage(r)).toBe("2024-01-01/2026-10-30");
  });

  it("a year the source does not deliver is named in periodosNaoLidos", async () => {
    fonte((url) => (url.searchParams.get("dataInicio") === "20250101" ? erro500() : discursos("2024-05-05")));
    const r = await chamar("senado_discursos_senador", { codigoSenador: 5672, dataInicio: "20240101", dataFim: "20261030" });
    expect(r.structuredContent.periodosNaoLidos).toEqual(["2025-01-01/2025-12-31"]);
    expect(r.structuredContent.aviso).toMatch(/01\/01\/2025 a 31\/12\/2025/);
  });

  it("apartes: the source ignores the period, so the tool keeps only the ones inside it", async () => {
    fonte(() => ({ ApartesParlamentar: { Parlamentar: { Apartes: { Aparte: [
      { CodigoPronunciamento: "a", DataPronunciamento: "2021-06-29" },
      { CodigoPronunciamento: "b", DataPronunciamento: "2025-04-01" },
    ] } } } }));
    const r = await chamar("senado_discursos_senador", { codigoSenador: 5672, tipo: "apartes", dataInicio: "20240101", dataFim: "20261030" });
    expect(pedidas).toEqual(["/senador/5672/apartes.json"]);
    expect(r.structuredContent.discursos.map((d: any) => d.codigo)).toEqual(["b"]);
    const semPeriodo = await chamar("senado_discursos_senador", { codigoSenador: 5672, tipo: "apartes" });
    expect(semPeriodo.structuredContent.count).toBe(2);
  });
});

describe("decisão 6 — limites da fonte", () => {
  it("discursos do plenário: one read per calendar month (the source refuses over 1 month)", async () => {
    fonte(() => ({ DiscursosSessao: { Sessoes: { Sessao: [{ Pronunciamentos: { Pronunciamento: [{ CodigoPronunciamento: "x" }] } }] } } }));
    const r = await chamar("senado_discursos_plenario", { dataInicio: "20260215", dataFim: "20260410" });
    // Parallel reads reach the source in any order.
    expect(pedidas.sort()).toEqual([
      "/plenario/lista/discursos/20260215/20260228.json",
      "/plenario/lista/discursos/20260301/20260331.json",
      "/plenario/lista/discursos/20260401/20260410.json",
    ]);
    expect(r.structuredContent.count).toBe(3);
    expect(vintage(r)).toBe("2026-02-15/2026-04-10");
  });

  it("votações: one read per calendar year (the source refuses over 1 year), both tools", async () => {
    fonte((url) => [{ codigoSessao: url.searchParams.get("dataInicio"), dataSessao: `${url.searchParams.get("dataInicio")}T10:00:00` }]);
    const busca = await chamar("senado_search_votacoes", { dataInicio: "20240601", dataFim: "20250201" });
    expect(pedidas.sort()).toEqual([
      "/votacao.json?dataFim=2024-12-31&dataInicio=2024-06-01",
      "/votacao.json?dataFim=2025-02-01&dataInicio=2025-01-01",
    ]);
    expect(busca.structuredContent.count).toBe(2);
    expect(vintage(busca)).toBe("2024-06-01/2025-02-01");

    pedidas = [];
    const senador = await chamar("senado_votacoes_senador", { codigoSenador: 5672, dataInicio: "20240601", dataFim: "20250201" });
    expect(pedidas.sort()).toEqual([
      "/votacao.json?codigoParlamentar=5672&dataFim=2024-12-31&dataInicio=2024-06-01",
      "/votacao.json?codigoParlamentar=5672&dataFim=2025-02-01&dataInicio=2025-01-01",
    ]);
    expect(senador.structuredContent.count).toBe(2);
  });

  it("emendas over 1 year are refused before the source; up to 1 year goes through", async () => {
    fonte(() => []);
    const r = await chamar("senado_processo_detalhe", { secao: "emendas", dataInicio: "20250101", dataFim: "20261030" });
    expect(r.isError).toBe(true);
    expect(erroDoTexto(r)).toBe(
      "Emendas aceitam até 1 ano por consulta (limite da fonte), e o período pedido vai de 01/01/2025 a 30/10/2026. Divida em consultas de até 1 ano.",
    );
    expect(pedidas).toEqual([]);
    const ok = await chamar("senado_processo_detalhe", { secao: "emendas", dataInicio: "20251030", dataFim: "20261030" });
    expect(ok.isError).toBeFalsy();
  });
});

describe("decisões 4, 5 e 7 — selo cortado em hoje, em ISO; aviso de corte com o período entregue", () => {
  it("buscar_materias: end in the future is cut at today; the cut list says what was delivered", async () => {
    fonte(() => ["2026-10-29", "2026-09-15", "2026-04-23", "2026-01-02"].map((d, i) => ({ id: i, identificacao: `PL ${i}/2026`, dataApresentacao: d })));
    const r = await chamar("senado_buscar_materias", { sigla: "PL", dataInicioApresentacao: "20260101", dataFimApresentacao: "20271231", limite: 3 });
    expect(vintage(r)).toBe("2026-01-01/2026-10-30 (pedido até 2027-12-31)");
    expect(r.structuredContent.total).toBe(4);
    expect(r.structuredContent.aviso).toBe(
      "Exibindo 3 de 4 resultados: os mais recentes, de 23/04/2026 a 29/10/2026. Os demais ficaram de fora: reduza o período ou aumente o limite.",
    );
  });

  it("search_processos in source order (not by date) never claims a delivered period", async () => {
    fonte(() => ["2026-03-01", "2026-01-06", "2026-09-11"].map((d, i) => ({ id: i, identificacao: `PL ${i}/2026`, dataApresentacao: d })));
    const r = await chamar("senado_search_processos", { sigla: "PL", dataInicioApresentacao: "20260101", dataFimApresentacao: "20261030", limite: 2 });
    expect(r.structuredContent.aviso).toMatch(/^Exibindo 2 de 3 processos, fora de ordem de data/);
    expect(vintage(r)).toBe("2026-01-01/2026-10-30");
  });

  it("orientação de bancada and votação em comissão stamp ISO, cut at today", async () => {
    fonte((url) => (url.pathname.includes("votacaoComissao") ? { VotacoesComissao: { Votacoes: { Votacao: [] } } } : []));
    const o = await chamar("senado_orientacao_bancada", { dataInicio: "20260901", dataFim: "20271231" });
    expect(vintage(o)).toBe("2026-09-01/2026-10-30 (pedido até 2027-12-31)");
    const dia = await chamar("senado_orientacao_bancada", { data: "20261015" });
    expect(vintage(dia)).toBe("2026-10-15");
    const v = await chamar("senado_votacao_comissao", { por: "comissao", siglaComissao: "CCJ", dataInicio: "20260101", dataFim: "20261030" });
    expect(vintage(v)).toBe("2026-01-01/2026-10-30");
  });

  it("resultado do plenário com escopo=mes stamps the month, not the given day", async () => {
    fonte(() => ({}));
    const r = await chamar("senado_resultado_plenario", { data: "20261015", escopo: "mes" });
    expect(vintage(r)).toBe("2026-10");
  });
});
