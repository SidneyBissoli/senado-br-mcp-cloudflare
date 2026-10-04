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
 * ancora: as 67 tools anunciam UM único schema permissivo
 * (`z.object({}).passthrough()`, que vai ao fio como
 * `{"type":"object","properties":{},"additionalProperties":{}}`), sem campo
 * obrigatório nenhum. Qualquer objeto JSON o satisfaz. A única forma de violá-lo
 * é devolver `structuredContent` que NÃO seja objeto — e `toolResult()` embrulha
 * array/primitivo/null em `{ result }` exatamente para isso.
 *
 * Logo, o portão tem dois dentes, e são os dois que importam:
 *   1. o schema anunciado continua permissivo e uniforme nas 67 tools — se
 *      alguém apertá-lo (campo obrigatório, `additionalProperties: false`) sem
 *      passar por uma revisão de contrato, este teste cai;
 *   2. `toolResult()` nunca produz `structuredContent` que não seja objeto.
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

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { Client } from "@modelcontextprotocol/client";
import { chamarComoCliente, conectarComoCliente, controlesNegativos } from "@sbissoli/mcp-surface/cliente";
import { createServer } from "../src/server.js";
import { toolResult, toolError } from "../src/utils/validation.js";

/** O servidor de verdade, como o Worker o monta (sem KV real: as tools daqui não tocam a rede). */
const fabricar = (toolProfile: "full" | "openai-app" = "full") =>
  createServer({ CACHE_KV: {} as never } as never, undefined, { toolProfile });

/**
 * O schema que as 67 tools publicam, como chega ao cliente — menos o `$schema`.
 *
 * O DIALETO NÃO É PINADO, e a razão foi medida: na migração para o SDK v2
 * (30/08/2026) o emissor passou de `draft-07` para `2020-12` sem que nada
 * nosso mudasse. Quem escolhe o dialeto é o SDK; pinar a string fazia este
 * teste reprovar uma troca de biblioteca como se fosse regressão do servidor.
 * O que o teste guarda é a FORMA — objeto aberto, sem propriedade nenhuma —,
 * que é o que torna a conformidade de saída automática. O `$schema` é conferido
 * à parte: tem de existir e ser um dialeto de JSON Schema, não um valor
 * específico.
 */
const SCHEMA_PERMISSIVO = {
  type: "object",
  properties: {},
  additionalProperties: {},
};

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

  it("é UM único schema permissivo, idêntico em todas — nenhuma tool pode violá-lo com um objeto", () => {
    const distintos = new Set(tools.map((t) => JSON.stringify(t.outputSchema)));
    expect(distintos.size, `schemas distintos: ${[...distintos].join(" | ")}`).toBe(1);
    const { $schema, ...forma } = tools[0]!.outputSchema as Record<string, unknown> & {
      $schema?: string;
    };
    expect(forma).toEqual(SCHEMA_PERMISSIVO);
    expect($schema, "sumiu o $schema do outputSchema publicado").toMatch(/json-schema\.org/);
  });

  it("não declara campo obrigatório nem fecha o objeto — é o que torna a conformidade automática", () => {
    for (const tool of tools) {
      const schema = tool.outputSchema as { required?: unknown; additionalProperties?: unknown };
      expect(schema.required, `${tool.name} passou a exigir campos`).toBeUndefined();
      expect(schema.additionalProperties, `${tool.name} fechou o objeto`).not.toBe(false);
    }
  });
});

describe("toolResult — a única forma de violar o schema é não devolver objeto", () => {
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
    } finally {
      await app.close();
    }
  });

  /**
   * Um teste que não pode falhar não vale nada. O SDK valida o
   * `structuredContent` contra o `outputSchema` da tool antes de devolvê-lo —
   * é esse o mecanismo em que este servidor se apoia. Aqui ele é exercido
   * contra um valor que o schema NÃO admite (não-objeto), provando que a
   * validação existe e reprova.
   */
  it("o SDK reprova structuredContent que não é objeto (prova de que a validação roda)", async () => {
    const { z } = await import("zod");
    const schema = z.object({}).passthrough();
    expect(schema.safeParse({ qualquer: "coisa" }).success).toBe(true);
    expect(schema.safeParse([1, 2, 3]).success).toBe(false);
    expect(schema.safeParse("texto").success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
  });
});

// ==================== controle negativo, no percurso do cliente ====================
//
// O teste do zod acima prova o schema; este prova o CLIENTE. O servidor responde
// certo e o resultado é quebrado NO FIO, entre servidor e cliente — como chegaria
// de um servidor com defeito. Cada quebra tem de fazer a chamada falhar. As
// quebras saem do schema listado; como ele não tem campo obrigatório, sobra uma:
// `structuredContent` ausente numa tool que anuncia `outputSchema`. Não há quebra
// de "campo a mais": o schema daqui é aberto (`additionalProperties: {}`), campo
// extra é válido por desenho. O último veredito é a armadilha: sem `tools/list`
// antes, o Client não valida — se o SDK mudar isso, o veredito acusa.

describe("o validador do cliente reprova resultado quebrado no fio", () => {
  it("senado_tabelas_referencia: toda quebra reprova, e a armadilha se confirma", async () => {
    const vs = await controlesNegativos(() => fabricar(), "senado_tabelas_referencia", { tabela: "tipos-materia" });
    expect(vs.length).toBeGreaterThanOrEqual(2);
    for (const v of vs) expect(v.obtido, `${v.descricao}: ${v.mensagem ?? ""}`).toBe(v.esperado);
  });
});
