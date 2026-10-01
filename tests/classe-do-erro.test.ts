/**
 * A classe do erro na telemetria sai do TIPO da falha, não da frase.
 *
 * Medido em 30/09/2026, rodando `classifyError` sobre as mensagens de falha
 * da origem: "Erro de rede: ..." (base legislativa), o 429 do nosso próprio
 * balde ("Taxa de requisições excedida") e, no e-Cidadania, "falha de rede ao
 * acessar" e "retornou HTTP 429/400/403" caíam em `outro`. O tipo existia no
 * `catch`; só o texto chegava ao `instrumentTool`.
 *
 * O teste atravessa o caminho que perdia o tipo — ida à origem com `fetch`
 * dublado, `errorFrom`, `instrumentTool`, e a linha gravada no Analytics
 * Engine (blob7) — e fixa também as classes que JÁ estavam certas e têm de
 * continuar: 404 → `nao_encontrado`, rota inexistente → `defeito`, corpo vazio
 * → `nao_encontrado`, 5xx → `fonte`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upstreamFetch, upstreamIo } from "../src/throttle/upstream.js";
import * as tokenBucket from "../src/throttle/token-bucket.js";
import { fetchPage } from "../src/scraper/ecidadania.js";
import { errorFrom } from "../src/utils/validation.js";
import { instrumentTool } from "../src/instrument.js";
import { classeAnexada } from "../src/call-shape.js";
import { capturarDeepResearchTools } from "../src/tools/deep-research.js";
import { registerComissoesTools } from "../src/tools/comissoes.js";

/** A classe que a chamada gravaria no Analytics Engine (blob7). */
async function classeGravada(ida: () => Promise<unknown>): Promise<string> {
  const pontos: AnalyticsEngineDataPoint[] = [];
  const ae = { writeDataPoint: (p: AnalyticsEngineDataPoint) => void pontos.push(p) } as AnalyticsEngineDataset;
  const tool = instrumentTool(
    "senado_teste",
    async () => {
      try {
        await ida();
        return { content: [] };
      } catch (e) {
        return errorFrom(e, "falhou");
      }
    },
    ae,
  );
  await tool({});
  expect(pontos).toHaveLength(1);
  return String(pontos[0].blobs?.[6] ?? "");
}

function responder(fn: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(fn));
}

beforeEach(() => {
  vi.spyOn(upstreamIo, "sleep").mockResolvedValue(undefined);
  vi.spyOn(upstreamIo, "random").mockReturnValue(0);
  vi.spyOn(tokenBucket.globalBucket, "tryConsume").mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const legis = () => upstreamFetch("/senador/lista/atual");

describe("base legislativa: falha da origem é `fonte`", () => {
  it("rede — 'Erro de rede' caía em `outro`", async () => {
    responder(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await classeGravada(legis)).toBe("fonte");
  });

  it("429 do nosso próprio balde — 'Taxa de requisições excedida' caía em `outro`", async () => {
    vi.spyOn(tokenBucket.globalBucket, "tryConsume").mockReturnValue(false);
    expect(await classeGravada(legis)).toBe("fonte");
  });

  it("503 (já era `fonte`, continua)", async () => {
    responder(async () => new Response("", { status: 503 }));
    expect(await classeGravada(legis)).toBe("fonte");
  });
});

describe("base legislativa: o que já estava certo não muda", () => {
  it("404 é ausência respondida", async () => {
    responder(async () => new Response("", { status: 404 }));
    expect(await classeGravada(legis)).toBe("nao_encontrado");
  });

  it("rota inexistente é `defeito` — o 404 que é bug nosso", async () => {
    responder(
      async () =>
        new Response(JSON.stringify({ detail: "No static resource senador/xpto." }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    );
    expect(await classeGravada(() => upstreamFetch("/senador/xpto", {}, undefined, { on404: "absent" }))).toBe(
      "defeito",
    );
  });

  it("corpo vazio é `nao_encontrado` (código de reunião inexistente responde assim)", async () => {
    responder(async () => new Response("", { status: 200 }));
    expect(await classeGravada(legis)).toBe("nao_encontrado");
  });
});

describe("e-Cidadania: falha do portal é `fonte`", () => {
  const portal = () => fetchPage("/principal/index");

  it("rede — 'falha de rede ao acessar' caía em `outro`", async () => {
    responder(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await classeGravada(portal)).toBe("fonte");
  });

  it("429", async () => {
    responder(async () => new Response("", { status: 429 }));
    expect(await classeGravada(portal)).toBe("fonte");
  });

  it("403", async () => {
    responder(async () => new Response("", { status: 403 }));
    expect(await classeGravada(portal)).toBe("fonte");
  });

  it("404 é ausência respondida", async () => {
    responder(async () => new Response("", { status: 404 }));
    expect(await classeGravada(portal)).toBe("nao_encontrado");
  });
});

describe("bug nosso no handler é `defeito` (varredura de 30/09/2026)", () => {
  it("TypeError do nosso código, engolido por errorFrom", async () => {
    const classe = await classeGravada(async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'x')");
    });
    expect(classe).toBe("defeito");
  });

  it("a falha de rede crua da undici NÃO é bug nosso", async () => {
    const classe = await classeGravada(async () => {
      throw new TypeError("fetch failed");
    });
    expect(classe).not.toBe("defeito");
  });
});

describe("search/fetch pelo tipo (mcp-search 0.8.0)", () => {
  it("id desconhecido é nao_encontrado mesmo ecoando uma palavra de `contrato`", async () => {
    const { fetch } = capturarDeepResearchTools("https://legis.senado.leg.br/dadosabertos");
    const r = await fetch.callback({ id: "invalid" });
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect(classeAnexada(r)).toBe("nao_encontrado");
  });
});

describe("a classe viaja FORA do fio", () => {
  it("o resultado serializado não ganha chave nenhuma", async () => {
    responder(async () => new Response("", { status: 429 }));
    let resultado: unknown;
    try {
      await legis();
    } catch (e) {
      resultado = errorFrom(e, "falhou");
    }
    expect(Object.keys(resultado as object).sort()).toEqual(["content", "isError", "structuredContent"]);
    expect(JSON.stringify(resultado)).not.toContain("classe");
  });
});

/**
 * Onda 2 (30/09/2026): o erro que o HANDLER decide (`toolError`) passa a
 * declarar a classe. Antes, `toolError` não anexava nada e o hook caía na
 * frase — que ecoa argumento do chamador. Os casos abaixo atravessam a tool
 * de verdade (registrada num host dublado), `instrumentTool` e a linha do
 * Analytics Engine, com `fetch` dublado (sem rede).
 */
type Callback = (params: Record<string, unknown>) => Promise<unknown>;

function toolsDeComissoes(): Map<string, Callback> {
  const tools = new Map<string, Callback>();
  const host = {
    tool: (name: string, _d: string, _s: unknown, cb: Callback) => void tools.set(name, cb),
  } as unknown as Parameters<typeof registerComissoesTools>[0];
  registerComissoesTools(host, "https://legis.senado.leg.br/dadosabertos");
  return tools;
}

async function classeDaTool(nome: string, params: Record<string, unknown>): Promise<string> {
  const pontos: AnalyticsEngineDataPoint[] = [];
  const ae = { writeDataPoint: (p: AnalyticsEngineDataPoint) => void pontos.push(p) } as AnalyticsEngineDataset;
  const cb = toolsDeComissoes().get(nome)!;
  const resultado = await instrumentTool(nome, cb as Parameters<typeof instrumentTool>[1], ae)(params);
  expect((resultado as { isError?: boolean }).isError).toBe(true);
  expect(pontos).toHaveLength(1);
  return String(pontos[0].blobs?.[6] ?? "");
}

function agendaCom(reunioes: unknown[]) {
  responder(
    async () =>
      new Response(JSON.stringify({ AgendaReuniao: { reunioes: { reuniao: reunioes } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

describe("senado_reuniao_comissao por sigla: a classe é declarada, não lida da frase", () => {
  it("nenhuma reunião no período é `nao_encontrado` (caía em `outro`)", async () => {
    agendaCom([]);
    expect(await classeDaTool("senado_reuniao_comissao", { sigla: "ZZA", data: "20260901" })).toBe(
      "nao_encontrado",
    );
  });

  it("várias reuniões (pedido ambíguo) é `contrato` (caía em `outro`)", async () => {
    const r = (codigo: string, hora: string) => ({
      codigo,
      descricao: "Reunião",
      dataInicio: `2026-09-01T${hora}:00`,
      colegiadoCriador: { sigla: "ZZB" },
    });
    agendaCom([r("1001", "09:00"), r("1002", "14:00")]);
    expect(await classeDaTool("senado_reuniao_comissao", { sigla: "ZZB", data: "20260901" })).toBe("contrato");
  });
});

describe("texto que ecoa argumento não sequestra a classe", () => {
  it("sigla 'INVALIDA' inexistente é `nao_encontrado` (a frase casava `invalid` -> `contrato`)", async () => {
    responder(
      async () =>
        new Response(JSON.stringify({ ListaColegiados: { Colegiados: { Colegiado: [{ Sigla: "CAE", Codigo: "38" }] } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    expect(await classeDaTool("senado_obter_comissao", { sigla: "INVALIDA", secao: "resumo" })).toBe(
      "nao_encontrado",
    );
  });
});
