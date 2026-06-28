/**
 * McpServer factory — creates a new instance per request (required by SDK 1.26.0+).
 * Registers all tools from each group module.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerReferenciaTools } from "./tools/referencia.js";
import { registerSenadoresTools } from "./tools/senadores.js";
import { registerMateriasTools } from "./tools/materias.js";
import { registerVotacoesTools } from "./tools/votacoes.js";
import { registerComissoesTools } from "./tools/comissoes.js";
import { registerPlenarioTools } from "./tools/plenario.js";
import { registerProcessosTools } from "./tools/processos.js";
import { registerECidadaniaTools } from "./tools/ecidadania.js";
import { registerDiscursosTools } from "./tools/discursos.js";
import { registerComposicaoTools } from "./tools/composicao.js";
import { registerOrcamentoTools } from "./tools/orcamento.js";
import { registerLegislacaoTools } from "./tools/legislacao.js";
import { registerVotacaoComissaoTools } from "./tools/votacao-comissao.js";
import { registerTaquigrafiaTools } from "./tools/taquigrafia.js";
import { registerSenadoresAdminTools } from "./tools/senadores-admin.js";
import { registerContratacoesTools } from "./tools/contratacoes.js";
import { registerServidoresTools } from "./tools/servidores.js";
import { registerSupridosTools } from "./tools/supridos.js";
import { registerOrcamentoSenadoTools } from "./tools/orcamento-senado.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { instrumentTool } from "./instrument.js";
import { VERSION } from "./version.js";
import {
  instructionsForProfile,
  isToolEnabledForProfile,
  minimizeToolResultForProfile,
  toolMetaForProfile,
  type CreateServerOptions,
} from "./app-surface.js";
import { registerOpenAiAppWidget } from "./openai-app-widget.js";
import type { Env } from "./types.js";

type ToolCallback = (...args: unknown[]) => Promise<unknown> | unknown;

export function createServer(env: Env, ctx?: ExecutionContext, options: CreateServerOptions = {}): McpServer {
  const toolProfile = options.toolProfile ?? "full";
  const server = new McpServer(
    {
      name: "senado-br-mcp",
      version: VERSION,
      websiteUrl: "https://github.com/SidneyBissoli/senado-br-mcp-cloudflare",
      icons: [
        {
          src: "https://senado.sidneybissoli.com/icon.jpg",
          mimeType: "image/jpeg",
          sizes: ["512x512"],
        },
      ],
    },
    { instructions: instructionsForProfile(toolProfile) },
  );

  // Every tool here only reads upstream open data — no writes, no side effects — and
  // reaches external systems (Senate APIs / e-Cidadania) whose data is an open, changing
  // set; and every tool returns a JSON object via toolResult(). Rather than repeat that
  // metadata at every call site, wrap the group modules' `server.tool(name, desc, shape, cb)`
  // calls and route them through registerTool() with shared annotations and a permissive
  // object outputSchema. toolResult() supplies the matching structuredContent. The callback
  // is also wrapped with instrumentTool() so every invocation is counted per tool.
  const outputSchema = z.object({}).passthrough();
  const registerTool = server.registerTool.bind(server);
  const analytics = env.SENADO_ANALYTICS;
  (server as { tool: unknown }).tool = (
    name: string,
    description: string,
    shape: Record<string, unknown>,
    cb: unknown,
  ) => {
    if (!isToolEnabledForProfile(name, toolProfile)) {
      return undefined;
    }

    const profiledCallback: ToolCallback = async (...args: unknown[]) =>
      minimizeToolResultForProfile(await (cb as ToolCallback)(...args), toolProfile);

    return registerTool(
      name,
      {
        description,
        inputSchema: shape as never,
        outputSchema: outputSchema as never,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        _meta: toolMetaForProfile(toolProfile),
      },
      instrumentTool(name, profiledCallback as never, analytics) as never,
    );
  };

  const baseUrl = env.SENADO_BASE_URL || "https://legis.senado.leg.br/dadosabertos";
  const admBaseUrl = env.SENADO_ADM_BASE_URL || "https://adm.senado.gov.br/adm-dadosabertos";

  // Group H — Reference/metadata (1 tool — enum `tabela`)
  registerReferenciaTools(server, baseUrl);

  // Group A — Senators (5 tools)
  registerSenadoresTools(server, baseUrl);

  // Group B — Bills (2 tools; votos_materia is registered in Group D)
  registerMateriasTools(server, baseUrl);

  // Group D — Votes (3 tools)
  registerVotacoesTools(server, baseUrl);

  // Group E — Committees (7 tools)
  registerComissoesTools(server, baseUrl);

  // Group F — Plenary (7 tools)
  registerPlenarioTools(server, baseUrl);

  // Group C — Processes (5 tools)
  registerProcessosTools(server, baseUrl);

  // Group G — e-Cidadania (9 tools) — reads from D1 (env) and write-through detail (ctx)
  registerECidadaniaTools(server, baseUrl, env, ctx);

  // Group I — Speeches (3 tools)
  registerDiscursosTools(server, baseUrl);

  // Group J — Blocs & Leadership (4 tools)
  registerComposicaoTools(server, baseUrl);

  // Group K — Budget (1 tool — enum `tipo`)
  registerOrcamentoTools(server, baseUrl);

  // Group L — Federal Law (2 tools)
  registerLegislacaoTools(server, baseUrl);

  // Group M — Committee Voting (1 tool — enum `por`)
  registerVotacaoComissaoTools(server, baseUrl);

  // Group N — Taquigrafia (2 tools)
  registerTaquigrafiaTools(server, baseUrl);

  // Group O — Senadores/Administrativo (2 tools)
  registerSenadoresAdminTools(server, admBaseUrl);

  // Group P — Servidores / Gestão de Pessoas (4 tools)
  registerServidoresTools(server, admBaseUrl);

  // Group Q — Contratações (6 tools)
  registerContratacoesTools(server, admBaseUrl);

  // Group R — Suprimento de Fundos (1 tool)
  registerSupridosTools(server, admBaseUrl);

  // Group S — Orçamento do Senado (1 tool)
  registerOrcamentoSenadoTools(server);

  // MCP prompts (4 reusable pt-BR workflow templates) and resources (5 static
  // context docs/tables) — advertised as the `prompts` and `resources` capabilities.
  registerPrompts(server);
  registerResources(server);
  if (toolProfile === "openai-app") {
    registerOpenAiAppWidget(server);
  }

  return server;
}
