/**
 * McpServer factory — creates a new instance per request (required by SDK 1.26.0+).
 * Registers all tools from each group module.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ConciseBlockSchema } from "@sbissoli/mcp-provenance";
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
import { registerEstruturaTools } from "./tools/estrutura.js";
import { registerDeepResearchToolsSenado } from "./tools/deep-research.js";
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
import { titleForTool } from "./tool-titles.js";
import type { Env } from "./types.js";
import type { SenadoToolHost } from "./tool-host.js";
import { announceServedVersions } from "./discover.js";

type ToolCallback = (...args: unknown[]) => Promise<unknown> | unknown;

/**
 * O esquema de entrada RECUSA parâmetro que não existe.
 *
 * Todas as tools do senado passam por um funil só (`host.tool` abaixo), que
 * recebia a shape crua e a entregava ao SDK como objeto ABERTO. Aberto, o zod
 * descarta a chave desconhecida em silêncio, o parâmetro que o chamador queria
 * usar fica com o default e a ferramenta responde OUTRA pergunta com cara de
 * resposta. Medido no irmão ibge-br-mcp em 11/09/2026: `periodo` no singular,
 * que o esquema não tem, devolveu a população de 2026 para uma pergunta sobre
 * 2023, com nenhum aviso. Resposta errada é pior que erro — erro o modelo
 * corrige na chamada seguinte, resposta errada vira número em relatório. Aqui
 * o campo minado é grande: 67 ferramentas, muitas com pares quase homônimos
 * (`codigoSenador`/`codigoParlamentar`, `sigla`/`siglaComissao`).
 *
 * `.strict()` publica `additionalProperties: false` e faz o SDK responder
 * `Unrecognized key: "<nome>"`, que NOMEIA a chave.
 *
 * Vale para TODAS, `search` e `fetch` inclusive. Até a 3.11.0 as duas ficavam
 * abertas por serem contrato da OpenAI; desde o `@sbissoli/mcp-search` 0.9.0
 * o próprio contrato do portfólio é estrito (`z.strictObject`), e as duas
 * entram por este funil (registerDeepResearchToolsSenado passa a shape) —
 * sem o `.strict()` aqui, a estrição do pacote se perderia na passagem.
 */
function esquemaDeEntrada(shape: Record<string, unknown>) {
  return z.object(shape as z.ZodRawShape).strict();
}
export function createServer(env: Env, ctx?: ExecutionContext, options: CreateServerOptions = {}): McpServer {
  const toolProfile = options.toolProfile ?? "full";
  const server = new McpServer(
    {
      name: "senado-br-mcp",
      version: VERSION,
      // `title` no serverInfo do handshake: existia no `server.json` — o que os
      // diretórios leem — mas não no que o cliente recebe ao conectar, e o
      // mcpscore mede o handshake (`server_title_present`).
      title: "Dados Abertos Senado BR MCP",
      // O DOMÍNIO PRÓPRIO, não o repositório: é o que o `server.json` declara e
      // é quem serve o ícone logo abaixo. O par estava desalinhado.
      websiteUrl: "https://senado.sidneybissoli.com",
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
  // calls and route them through registerTool() with shared annotations and ONE shared
  // outputSchema. The callback is also wrapped with instrumentTool() so every invocation
  // is counted per tool.
  //
  // O schema de saída é o ENVELOPE COMUM (decisão do dono, 04/10/2026): aberto — a forma
  // dos dados de cada tool segue sem contrato, como decidido em
  // docs/_local/_checklist-melhorias-arquiteturais.pt-BR.md ("passthrough foi decisão
  // deliberada") —, mas com o que TODA resposta de sucesso das 69 carrega obrigatório:
  // `provenance` + `attribution`, que `resultWithProvenance`/`provenanceExtras` sempre
  // montam. O bloco é o schema IMPORTADO do @sbissoli/mcp-provenance, nunca transcrito:
  // a cópia à mão de um bloco selado derrubou quatro irmãos quando o contrato ganhou
  // `retrieval`. `provenance` é objeto com uma fonte e LISTA quando a chamada passa
  // várias (o índice do Deep Research), então os dois.
  const outputSchema = z.looseObject({
    provenance: z.union([ConciseBlockSchema, z.array(ConciseBlockSchema).min(1)]),
    attribution: z.array(z.string()),
  });
  const registerTool = server.registerTool.bind(server);
  const analytics = env.SENADO_ANALYTICS;
  // O shim é instalado sobre a instância e o resultado é NOMEADO: os módulos de
  // grupo recebem `host`, não `server`. Até a migração v2 eles declaravam
  // `McpServer` e chamavam `.tool()` — método que a v1 expunha e a v2 não —, uma
  // imprecisão que o tipo antigo tolerava. Ver src/tool-host.ts.
  const host = server as unknown as SenadoToolHost;
  (host as { tool: unknown }).tool = (
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
        title: titleForTool(name),
        description,
        inputSchema: esquemaDeEntrada(shape) as never,
        outputSchema: outputSchema as never,
        annotations: {
          title: titleForTool(name),
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
        _meta: toolMetaForProfile(toolProfile),
      },
      instrumentTool(name, profiledCallback as never, analytics, options.requestTag, options.gravados) as never,
    );
  };

  const baseUrl = env.SENADO_BASE_URL || "https://legis.senado.leg.br/dadosabertos";
  const admBaseUrl = env.SENADO_ADM_BASE_URL || "https://adm.senado.gov.br/adm-dadosabertos";

  // Group H — Reference/metadata (1 tool — enum `tabela`)
  registerReferenciaTools(host, baseUrl);

  // Group A — Senators (5 tools)
  registerSenadoresTools(host, baseUrl);

  // Group B — Bills (2 tools; votos_materia is registered in Group D)
  registerMateriasTools(host, baseUrl);

  // Group D — Votes (3 tools)
  registerVotacoesTools(host, baseUrl);

  // Group E — Committees (7 tools)
  registerComissoesTools(host, baseUrl);

  // Group F — Plenary (7 tools)
  registerPlenarioTools(host, baseUrl);

  // Group C — Processes (5 tools)
  registerProcessosTools(host, baseUrl);

  // Group G — e-Cidadania (9 tools) — reads from D1 (env) and write-through detail (ctx)
  registerECidadaniaTools(host, baseUrl, env, ctx);

  // Group I — Speeches (3 tools)
  registerDiscursosTools(host, baseUrl);

  // Group J — Blocs & Leadership (4 tools)
  registerComposicaoTools(host, baseUrl);

  // Group K — Budget (1 tool — enum `tipo`)
  registerOrcamentoTools(host, baseUrl);

  // Group L — Federal Law (2 tools)
  registerLegislacaoTools(host, baseUrl);

  // Group M — Committee Voting (1 tool — enum `por`)
  registerVotacaoComissaoTools(host, baseUrl);

  // Group N — Taquigrafia (2 tools)
  registerTaquigrafiaTools(host, baseUrl);

  // Group O — Senadores/Administrativo (2 tools)
  registerSenadoresAdminTools(host, admBaseUrl);

  // Group P — Servidores / Gestão de Pessoas (4 tools)
  registerServidoresTools(host, admBaseUrl);

  // Group Q — Contratações (6 tools)
  registerContratacoesTools(host, admBaseUrl);

  // Group R — Suprimento de Fundos (1 tool)
  registerSupridosTools(host, admBaseUrl);

  // Group S — Orçamento do Senado (1 tool)
  registerOrcamentoSenadoTools(host);

  // Group T — Estrutura Organizacional (1 tool — árvore de órgãos, snapshot bundlado)
  registerEstruturaTools(host);

  // Group U — Deep Research (2 tools: `search`/`fetch`, o contrato OpenAI — os únicos
  // nomes sem o prefixo `senado_`; passam pelo mesmo shim que os outros)
  registerDeepResearchToolsSenado(host, baseUrl);

  // MCP prompts (4 reusable pt-BR workflow templates) and resources (5 static
  // context docs/tables) — advertised as the `prompts` and `resources` capabilities.
  registerPrompts(server);
  registerResources(server);
  if (toolProfile === "openai-app") {
    registerOpenAiAppWidget(server);
  }

  // `server/discover` anuncia TODAS as revisões atendidas, não só as modernas
  // que o SDK filtra — ver src/discover.ts.
  announceServedVersions(server);
  return server;
}
