/**
 * McpServer factory — creates a new instance per request (required by SDK 1.26.0+).
 * Registers all tools from each group module.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
import type { Env } from "./types.js";

export function createServer(env: Env): McpServer {
  const server = new McpServer({
    name: "senado-br-mcp",
    version: "2.0.0",
  });

  const baseUrl = env.SENADO_BASE_URL || "https://legis.senado.leg.br/dadosabertos";

  // Group H — Reference/metadata (4 tools)
  registerReferenciaTools(server, baseUrl);

  // Group A — Senators (5 tools)
  registerSenadoresTools(server, baseUrl);

  // Group B — Bills (4 tools; votos_materia is registered in Group D)
  registerMateriasTools(server, baseUrl);

  // Group D — Votes (5 tools)
  registerVotacoesTools(server, baseUrl);

  // Group E — Committees (5 tools)
  registerComissoesTools(server, baseUrl);

  // Group F — Plenary (1 tool)
  registerPlenarioTools(server, baseUrl);

  // Group C — Processes (2 tools)
  registerProcessosTools(server, baseUrl);

  // Group G — e-Cidadania (11 tools)
  registerECidadaniaTools(server, baseUrl);

  // Group I — Speeches (4 tools)
  registerDiscursosTools(server, baseUrl);

  // Group J — Blocs & Leadership (5 tools)
  registerComposicaoTools(server, baseUrl);

  // Group K — Budget (2 tools)
  registerOrcamentoTools(server, baseUrl);

  // Group L — Federal Law (3 tools)
  registerLegislacaoTools(server, baseUrl);

  // Group M — Committee Voting (2 tools)
  registerVotacaoComissaoTools(server, baseUrl);

  return server;
}
