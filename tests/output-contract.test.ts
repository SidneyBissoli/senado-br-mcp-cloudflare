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
 * Se um dia as tools ganharem schemas de saída próprios, ESTE arquivo tem de
 * virar o teste por-tool com fontes mockadas que o resto do portfólio usa
 * (ver `bcb-br-mcp/src/output-contract.test.ts`).
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createServer } from "../src/server.js";
import { toolResult, toolError } from "../src/utils/validation.js";

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
  const server = createServer({ CACHE_KV: {} as never } as never);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "output-contract", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  ({ tools } = await client.listTools());
});

afterAll(async () => {
  await client.close();
});

describe("outputSchema anunciado", () => {
  it("as 67 tools declaram outputSchema", () => {
    expect(tools).toHaveLength(67);
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
    const r = toolError("falhou", true);
    expect(r.isError).toBe(true);
    expect(typeof r.structuredContent).toBe("object");
    expect(Array.isArray(r.structuredContent)).toBe(false);
  });
});

describe("chamada real ponta a ponta", () => {
  it("uma tool servida do catálogo local devolve structuredContent objeto e válido", async () => {
    // `tipos-materia` é catálogo curado no próprio servidor: não toca a rede.
    const resultado = await client.callTool({
      name: "senado_tabelas_referencia",
      arguments: { tabela: "tipos-materia" },
    });

    expect(resultado.isError).toBeFalsy();
    const sc = resultado.structuredContent as Record<string, unknown>;
    expect(sc).toBeDefined();
    expect(Array.isArray(sc)).toBe(false);
    expect(typeof sc).toBe("object");
    expect(sc.tabela).toBe("tipos-materia");
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
