/**
 * Contrato de saída: o `structuredContent` obedece ao `outputSchema` anunciado.
 *
 * Por que este arquivo existe. A spec do MCP exige que o `structuredContent`
 * obedeça ao `outputSchema`; cliente que valida — o MCP Inspector valida —
 * rejeita a resposta INTEIRA quando não obedece, e `tools/list` não expõe nada
 * disso (só `tools/call` expõe). Num servidor irmão do portfólio esse buraco
 * produziu nove violações invisíveis: campos anuláveis anunciados como string.
 *
 * Aqui a exposição é ESTRUTURALMENTE diferente, e é isso que este arquivo
 * ancora: as 69 tools anunciam UM único schema, o ENVELOPE COMUM (decisão do
 * dono, 04/10/2026). Ele é ABERTO — a forma dos dados de cada tool continua sem
 * contrato, pela decisão anterior de manter o passthrough
 * (`docs/_local/_checklist-melhorias-arquiteturais.pt-BR.md`, "não reabrir") —,
 * mas EXIGE o que toda resposta de sucesso das 69 carrega: `provenance` (o
 * bloco concise do `@sbissoli/mcp-provenance`, objeto ou lista) e
 * `attribution`. Até a 3.12.1 o schema era `z.object({}).passthrough()`, sem
 * obrigatório nenhum, e este teste não tinha o que quebrar além de
 * "structuredContent ausente".
 *
 * O portão tem três dentes:
 *   1. o schema é UM, idêntico nas 69 tools, aberto no nível de cima e com
 *      exatamente `provenance` + `attribution` obrigatórios;
 *   2. o bloco de `provenance` é o do PACOTE, comparado contra o próprio zod
 *      dele — nunca transcrito (cópia à mão de bloco selado derrubou quatro
 *      irmãos quando o contrato ganhou `retrieval`);
 *   3. nenhum módulo de tool devolve `toolResult()`, que não leva proveniência e
 *      viraria `isError` no próprio servidor (o SDK v2 valida a saída).
 *
 * Desde 04/10/2026 o teste tem FORMA DE CLIENTE (ideia de leitor,
 * https://dev.to/arhancanli/comment/3g4i4): o servidor de verdade
 * (`createServer`) é interrogado pelo `Client` do SDK, que faz `tools/list` e
 * `tools/call` e reprova o resultado contra o schema LISTADO, sem validador
 * escolhido por nós — o teste falha como a sessão do usuário falharia. O
 * circuito é o `@sbissoli/mcp-surface/cliente`, comum aos sete servidores; ele
 * passa cada mensagem do servidor por JSON, como a rede passaria (o
 * `InMemoryTransport` sozinho deixa chave `undefined` sobreviver em memória).
 * Controles negativos quebram o resultado NO FIO e exigem que a chamada falhe.
 *
 * Se um dia as tools ganharem schemas de saída próprios, ESTE arquivo tem de
 * virar o teste por-tool com fontes mockadas que o resto do portfólio usa
 * (ver `bcb-br-mcp/src/output-contract.test.ts`).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { z } from "zod";
import type { Client } from "@modelcontextprotocol/client";
import { ConciseBlockSchema } from "@sbissoli/mcp-provenance";
import { chamarComoCliente, conectarComoCliente, controlesNegativos } from "@sbissoli/mcp-surface/cliente";
import { createServer } from "../src/server.js";
import { toolResult, toolError } from "../src/utils/validation.js";

/** O servidor de verdade, como o Worker o monta (sem KV real: as tools daqui não tocam a rede). */
const fabricar = (toolProfile: "full" | "openai-app" = "full") =>
  createServer({ CACHE_KV: {} as never } as never, undefined, { toolProfile });

/**
 * O bloco de proveniência como o PRÓPRIO pacote o publica, convertido pelo mesmo
 * zod — a referência contra a qual o schema listado é comparado. Deriva da
 * fonte: subir o contrato de proveniência muda os dois lados juntos.
 *
 * O DIALETO NÃO É PINADO, e a razão foi medida: na migração para o SDK v2
 * (30/08/2026) o emissor passou de `draft-07` para `2020-12` sem que nada
 * nosso mudasse. Quem escolhe o dialeto é o SDK; pinar a string fazia este
 * teste reprovar uma troca de biblioteca como se fosse regressão do servidor.
 * Por isso o `$schema` sai da comparação e é conferido à parte.
 */
const BLOCO_DO_PACOTE = (() => {
  const { $schema: _dialeto, ...bloco } = z.toJSONSchema(ConciseBlockSchema) as Record<string, unknown>;
  return bloco;
})();

let client: Client;
let tools: Awaited<ReturnType<Client["listTools"]>>["tools"];

beforeAll(async () => {
  // `listTools` aqui também arma o validador do Client: ele só confere o
  // `tools/call` contra o schema que tem em cache do `tools/list`.
  client = await conectarComoCliente(fabricar());
  ({ tools } = await client.listTools());
});

afterAll(async () => {
  await client.close();
});

/**
 * Parâmetro que não existe tem de ser RECUSADO, nunca descartado em silêncio.
 *
 * Com o esquema aberto, o zod tira a chave desconhecida, o parâmetro que o
 * chamador queria usar fica com o default e a tool responde OUTRA pergunta com
 * cara de resposta. Medido no irmão ibge-br-mcp em 11/09/2026: `periodo` no
 * singular, que o esquema não tem, devolveu a população de 2026 para uma
 * pergunta sobre 2023, sem nenhum aviso. Resposta errada é pior que erro — erro
 * o modelo corrige na chamada seguinte, resposta errada vira número em
 * relatório. Aqui o campo minado é grande: 67 ferramentas, muitas com pares
 * quase homônimos (`codigoSenador`/`codigoParlamentar`, `sigla`/`siglaComissao`).
 *
 * `search`/`fetch` também: abertas até a 3.11.0 por serem contrato da OpenAI,
 * estritas desde o `@sbissoli/mcp-search` 0.9.0 (`z.strictObject`).
 */
describe("esquema de entrada recusa parâmetro que não existe", () => {
  it("toda tool publica additionalProperties: false, search e fetch inclusive", () => {
    expect(tools.length).toBeGreaterThanOrEqual(60);
    for (const nome of ["search", "fetch"]) {
      expect(tools.some((t) => t.name === nome), `${nome} sumiu da superfície`).toBe(true);
    }
    for (const t of tools) {
      const schema = t.inputSchema as { additionalProperties?: unknown };
      expect(schema.additionalProperties, `${t.name} aceita chave desconhecida`).toBe(false);
    }
  });

  it("search recusa chave desconhecida e a NOMEIA, antes de chegar ao handler", async () => {
    const r = await client.callTool({
      name: "search",
      arguments: { query: "reforma", ano: 2023 },
    });

    expect(r.isError).toBe(true);
    const texto = Array.isArray(r.content)
      ? r.content.map((c) => ("text" in c ? c.text : "")).join(" ")
      : "";
    expect(texto).toContain("ano");
    expect(r.structuredContent, "o handler rodou e devolveu resultado").toBeUndefined();
  });

  it("a recusa NOMEIA a chave, para o modelo se corrigir sozinho", async () => {
    const r = await client.callTool({
      name: "senado_listar_senadores",
      arguments: { emExercicio: true, sigla: "SP" },
    });

    expect(r.isError).toBe(true);
    const texto = Array.isArray(r.content)
      ? r.content.map((c) => ("text" in c ? c.text : "")).join(" ")
      : "";
    expect(texto).toContain("sigla");
  });
});

describe("outputSchema anunciado", () => {
  it("as 69 tools declaram outputSchema", () => {
    expect(tools).toHaveLength(69);
    for (const tool of tools) {
      expect(tool.outputSchema, `${tool.name} sem outputSchema`).toBeDefined();
    }
  });

  it("é UM único schema, idêntico em todas — o envelope comum", () => {
    const distintos = new Set(tools.map((t) => JSON.stringify(t.outputSchema)));
    expect(distintos.size, `schemas distintos: ${[...distintos].join(" | ")}`).toBe(1);
    const { $schema } = tools[0]!.outputSchema as { $schema?: string };
    expect($schema, "sumiu o $schema do outputSchema publicado").toMatch(/json-schema\.org/);
  });

  it("exige exatamente provenance + attribution, e deixa os dados abertos", () => {
    const schema = tools[0]!.outputSchema as {
      required?: string[];
      additionalProperties?: unknown;
      properties?: Record<string, unknown>;
    };
    expect([...(schema.required ?? [])].sort()).toEqual(["attribution", "provenance"]);
    // Aberto no nível de cima: a forma dos dados de cada tool não é contrato
    // (decisão de manter o passthrough). Fechar aqui reprovaria toda tool.
    expect(schema.additionalProperties, "o envelope fechou o objeto").not.toBe(false);
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["attribution", "provenance"]);
    expect(schema.properties?.attribution).toEqual({ type: "array", items: { type: "string" } });
  });

  it("o bloco de provenance é o do PACOTE (objeto ou lista não vazia), não uma transcrição", () => {
    const prov = (tools[0]!.outputSchema as { properties: { provenance: { anyOf: unknown[] } } }).properties
      .provenance;
    expect(prov.anyOf).toEqual([BLOCO_DO_PACOTE, { type: "array", minItems: 1, items: BLOCO_DO_PACOTE }]);
  });

  it("o perfil openai-app publica o mesmo envelope", async () => {
    const app = await conectarComoCliente(fabricar("openai-app"));
    try {
      const { tools: doApp } = await app.listTools();
      expect(doApp.length).toBeGreaterThan(0);
      for (const t of doApp) expect(t.outputSchema, t.name).toEqual(tools[0]!.outputSchema);
    } finally {
      await app.close();
    }
  });
});

/**
 * Com o envelope obrigatório, resultado sem proveniência é `isError` no
 * próprio servidor (o SDK v2 valida a saída contra o schema). `toolResult()` não
 * leva proveniência: ficou para o envelope de erro e para os testes, e nenhum
 * módulo de tool pode devolvê-lo. Varredura do texto-fonte, que é onde a
 * regressão entraria.
 */
describe("nenhuma tool devolve resultado sem proveniência", () => {
  it("src/tools não chama toolResult()", () => {
    const dir = join(import.meta.dirname, "..", "src", "tools");
    const ofensores = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /\btoolResult\s*\(/.test(readFileSync(join(dir, f), "utf8")));
    expect(ofensores, `módulos que devolvem toolResult(): ${ofensores.join(", ")}`).toEqual([]);
  });
});

describe("toolResult — continua devolvendo objeto (envelope de erro e testes)", () => {
  const naoObjetos: Array<[string, unknown]> = [
    ["array", [1, 2, 3]],
    ["null", null],
    ["string", "texto solto"],
    ["número", 42],
    ["boolean", false],
  ];

  it.each(naoObjetos)("embrulha %s em { result } para manter structuredContent objeto", (_rotulo, valor) => {
    const r = toolResult(valor);
    expect(r.structuredContent).toEqual({ result: valor });
    expect(Array.isArray(r.structuredContent)).toBe(false);
    expect(typeof r.structuredContent).toBe("object");
    expect(r.structuredContent).not.toBeNull();
  });

  it("passa objeto adiante sem reembrulhar", () => {
    const dados = { count: 2, itens: [{ id: 1 }, { id: 2 }] };
    expect(toolResult(dados).structuredContent).toBe(dados);
  });

  it("o envelope de erro também é objeto (isError dispensa validação, mas não é motivo para quebrar)", () => {
    const r = toolError("falhou", "fonte", true);
    expect(r.isError).toBe(true);
    expect(typeof r.structuredContent).toBe("object");
    expect(Array.isArray(r.structuredContent)).toBe(false);
  });
});

describe("chamada real ponta a ponta", () => {
  it("uma tool servida do catálogo local devolve structuredContent objeto e válido", async () => {
    // `tipos-materia` é catálogo curado no próprio servidor: não toca a rede.
    // `chamarComoCliente` lança se o Client reprovar o resultado ou se a tool
    // responder isError.
    const resultado = await chamarComoCliente(client, "senado_tabelas_referencia", { tabela: "tipos-materia" });

    const sc = resultado.structuredContent as Record<string, unknown>;
    expect(sc).toBeDefined();
    expect(Array.isArray(sc)).toBe(false);
    expect(typeof sc).toBe("object");
    expect(sc.tabela).toBe("tipos-materia");
    expect(sc.provenance, "o envelope chegou sem proveniência").toBeDefined();
    expect(Array.isArray(sc.attribution)).toBe(true);
  });

  /**
   * O perfil `openai-app` (`/mcp/openai-app-v2`) tem caminho de saída PRÓPRIO:
   * `minimizeToolResultForProfile` reescreve o `structuredContent` (tira o
   * `meta` de topo, quando há) depois do handler. Reescrita é onde um não-objeto pode nascer, então
   * o perfil passa pelo mesmo cliente. `senado_estrutura_organizacional` está na
   * allowlist e lê o snapshot embarcado: não toca a rede.
   */
  it("perfil openai-app: a saída minimizada continua objeto e passa pelo Client", async () => {
    const app = await conectarComoCliente(fabricar("openai-app"));
    try {
      const r = await chamarComoCliente(app, "senado_estrutura_organizacional", { unidade: "DGER", limite: 3 });
      const sc = r.structuredContent as Record<string, unknown>;
      expect(sc).toBeDefined();
      expect(Array.isArray(sc)).toBe(false);
      expect(sc.unidade).toMatchObject({ sigla: "DGER" });
      expect(sc.provenance, "o minimizador tirou a proveniência").toBeDefined();
    } finally {
      await app.close();
    }
  });

});

// ==================== controle negativo, no percurso do cliente ====================
//
// O servidor responde certo e o resultado é quebrado NO FIO, entre servidor e
// cliente — como chegaria de um servidor com defeito. Cada quebra tem de fazer a
// chamada falhar. As quebras saem do schema listado: `structuredContent`
// ausente, `provenance` e `attribution` ausentes, `attribution` de tipo errado.
// As duas de baixo são deste envelope: um bloco de proveniência sem campo do
// contrato, e um campo a mais DENTRO do bloco, que é selado (o nível de cima é
// aberto por desenho — ali campo extra é válido). O último veredito é a
// armadilha: sem `tools/list` antes, o Client não valida.

describe("o validador do cliente reprova resultado quebrado no fio", () => {
  it("senado_tabelas_referencia: toda quebra reprova, e a armadilha se confirma", async () => {
    const vs = await controlesNegativos(() => fabricar(), "senado_tabelas_referencia", { tabela: "tipos-materia" }, [
      {
        descricao: "bloco de proveniência sem campo do contrato (citation)",
        adulterar: (r) => {
          const p = r.structuredContent?.provenance as Record<string, unknown> | undefined;
          if (p) delete p.citation;
        },
      },
      {
        descricao: "campo a mais dentro do bloco selado de proveniência",
        adulterar: (r) => {
          const p = r.structuredContent?.provenance as Record<string, unknown> | undefined;
          if (p) p.intruso = 1;
        },
      },
    ]);
    const descricoes = vs.map((v) => v.descricao);
    expect(descricoes).toEqual(
      expect.arrayContaining([
        "campo obrigatório ausente (provenance)",
        "campo obrigatório ausente (attribution)",
        "campo de tipo errado (attribution)",
      ]),
    );
    for (const v of vs) expect(v.obtido, `${v.descricao}: ${v.mensagem ?? ""}`).toBe(v.esperado);
    // Cada veredito sobe servidor + Client novos, e o Client recompila o schema
    // listado (69 tools sob o envelope comum). Já ficava no limite dos 5 s padrão;
    // com o nó opcional `field_sources` da proveniência v1.2 passou a estourar sob
    // carga — derrubou o publish da 3.14.0 (06/10/2026) e passou na re-rodada.
  }, 30_000);
});
