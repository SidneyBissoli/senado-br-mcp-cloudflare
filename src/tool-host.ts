/**
 * O tipo que os 20 módulos de tools realmente falam.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Até a migração para o SDK v2 os módulos
 * declaravam receber `McpServer` e chamavam `server.tool(...)` — um método que
 * a v1 expunha e a v2 NÃO expõe. O que eles sempre chamaram, na prática, foi o
 * SHIM instalado por `createServer` (src/server.ts), que aplica título,
 * anotações read-only, `outputSchema` permissivo, instrumentação e o filtro de
 * perfil antes de delegar ao `registerTool` do SDK.
 *
 * Declarar `McpServer` era, portanto, uma imprecisão que a v1 tolerava: o tipo
 * dizia "SDK" e o objeto entregava "SDK mais o shim". A v2 deixou de tolerar, e
 * a correção não é um cast — é nomear o que os módulos consomem de fato.
 *
 * Efeito colateral que vale por si: com a assinatura do callback declarada
 * aqui, o `params` de cada tool deixa de ser `any` implícito. Eram 65
 * ocorrências, todas silenciosas sob a v1.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import type { z, ZodRawShape } from "zod";

/** O que uma tool devolve — o shim normaliza para `structuredContent`. */
export type ToolResultLike = Promise<unknown> | unknown;

/**
 * `McpServer` acrescido do `tool()` que `createServer` instala. Os módulos
 * recebem isto, não o `McpServer` cru: pedir o tipo cru esconderia que a
 * chamada passa pelo shim.
 */
export interface SenadoToolHost extends McpServer {
  tool<S extends ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    cb: (params: z.infer<z.ZodObject<S>>, extra?: unknown) => ToolResultLike,
  ): void;
}
