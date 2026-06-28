/**
 * Smoke test for the OpenAI / ChatGPT app MCP surface.
 *
 * Exercises the real Streamable HTTP route:
 *   initialize -> tools/list on /mcp/openai-app
 *
 * Defaults to the hosted endpoint. For local Wrangler:
 *   MCP_URL=http://127.0.0.1:8787/mcp/openai-app node scripts/smoke-openai-app.mjs
 */

const BASE = process.env.MCP_URL || "https://senado.sidneybissoli.com/mcp/openai-app";
const ORIGIN = new URL(BASE).origin;
const WIDGET_URI = "ui://senado-br-mcp/openai-app-dashboard-v1.html";
const WIDGET_DOMAIN = "https://senado.sidneybissoli.com";
const WIDGET_MIME_TYPE = "text/html;profile=mcp-app";
const EXPECTED_TOOLS = [
  "senado_agenda_plenario",
  "senado_buscar_materias",
  "senado_ceaps",
  "senado_contratacao_detalhe",
  "senado_contratos",
  "senado_ecidadania_consultas_analise",
  "senado_ecidadania_listar_consultas",
  "senado_ecidadania_listar_ideias",
  "senado_ecidadania_obter_consulta",
  "senado_ecidadania_obter_ideia",
  "senado_encontro_plenario",
  "senado_listar_comissoes",
  "senado_listar_senadores",
  "senado_notas_taquigraficas",
  "senado_obter_comissao",
  "senado_obter_materia",
  "senado_obter_senador",
  "senado_obter_votacao",
  "senado_resultado_plenario",
  "senado_reuniao_comissao",
  "senado_reunioes_comissao",
  "senado_search_votacoes",
  "senado_videos_taquigrafia",
  "senado_votos_materia",
  "senado_votacoes_senador",
].sort();

let id = 0;
let sessionId;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function parseRpcResponse(response, text) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    const dataLines = text.split("\n").filter((line) => line.startsWith("data:"));
    if (dataLines.length === 0) fail(`SSE response without data line: ${text}`);
    return JSON.parse(dataLines[dataLines.length - 1].slice(5).trim());
  }
  return JSON.parse(text);
}

async function rpc(method, params) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
  }

  const response = await fetch(BASE, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });

  const nextSessionId = response.headers.get("mcp-session-id");
  if (nextSessionId) {
    sessionId = nextSessionId;
  }

  const text = await response.text();
  if (!response.ok) {
    fail(`${method} returned HTTP ${response.status}: ${text}`);
  }

  const payload = parseRpcResponse(response, text);
  if (payload.error) {
    fail(`${method} returned JSON-RPC error: ${JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

console.log(`Endpoint: ${BASE}`);

async function checkLegalPage(path, expectedText) {
  const url = `${ORIGIN}${path}`;
  const response = await fetch(url);
  const text = await response.text();
  if (response.status !== 200) {
    fail(`${path} returned HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  if (!response.headers.get("content-type")?.includes("text/html")) {
    fail(`${path} did not return HTML`);
  }
  if (!text.includes(expectedText)) {
    fail(`${path} did not contain expected text: ${expectedText}`);
  }
  console.log(`${path} OK`);
}

await checkLegalPage("/privacy", "Privacy Policy");
await checkLegalPage("/terms", "Terms of Use");

const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke-openai-app", version: "0" },
});

if (init.serverInfo?.name !== "senado-br-mcp") {
  fail(`unexpected server name: ${init.serverInfo?.name}`);
}
if (!init.instructions?.includes("superfície reduzida para ChatGPT Apps")) {
  fail("initialize did not return the OpenAI app server instructions");
}
if (
  !init.instructions?.includes("senado_listar_senadores") ||
  !init.instructions?.includes("emExercicio: true")
) {
  fail("initialize did not return the current-senators tool-selection instruction");
}
console.log(`initialize OK - ${init.serverInfo.name} v${init.serverInfo.version}`);

const list = await rpc("tools/list");
const tools = list.tools ?? [];
const names = tools.map((tool) => tool.name).sort();

if (tools.length !== EXPECTED_TOOLS.length) {
  fail(`expected ${EXPECTED_TOOLS.length} OpenAI app tools, got ${tools.length}`);
}

for (const name of EXPECTED_TOOLS) {
  if (!names.includes(name)) {
    fail(`missing OpenAI app tool: ${name}`);
  }
}
for (const name of names) {
  if (!EXPECTED_TOOLS.includes(name)) {
    fail(`unexpected tool in OpenAI app profile: ${name}`);
  }
}

const badAnnotations = tools.filter(
  (tool) =>
    tool.annotations?.readOnlyHint !== true ||
    tool.annotations?.destructiveHint !== false ||
    tool.annotations?.idempotentHint !== true ||
    tool.annotations?.openWorldHint !== true,
);
if (badAnnotations.length > 0) {
  fail(`tools missing read-only/non-destructive/idempotent/open-world annotations: ${badAnnotations.map((tool) => tool.name).join(", ")}`);
}

if (names.includes("senado_suprimento_fundos")) {
  fail("full-catalog-only tool leaked into OpenAI app surface");
}

const toolsMissingWidget = tools.filter(
  (tool) =>
    tool._meta?.ui?.resourceUri !== WIDGET_URI ||
    tool._meta?.["openai/outputTemplate"] !== WIDGET_URI,
);
if (toolsMissingWidget.length > 0) {
  fail(`tools missing OpenAI app widget template: ${toolsMissingWidget.map((tool) => tool.name).join(", ")}`);
}

const resources = await rpc("resources/list");
const widget = resources.resources?.find((resource) => resource.uri === WIDGET_URI);
if (!widget) {
  fail(`missing OpenAI app widget resource: ${WIDGET_URI}`);
}
if (widget.mimeType !== WIDGET_MIME_TYPE) {
  fail(`unexpected widget mime type: ${widget.mimeType}`);
}

const widgetRead = await rpc("resources/read", { uri: WIDGET_URI });
const widgetContent = widgetRead.contents?.[0];
if (widgetContent?.mimeType !== WIDGET_MIME_TYPE) {
  fail(`resources/read returned unexpected widget mime type: ${widgetContent?.mimeType}`);
}
if (!widgetContent?.text?.includes("window.openai")) {
  fail("widget HTML does not include the Apps SDK bridge");
}
if (widgetContent?._meta?.ui?.domain !== WIDGET_DOMAIN) {
  fail(`widget domain metadata must be ${WIDGET_DOMAIN}`);
}

console.log(`tools/list OK - ${tools.length} curated tools`);
console.log("annotations OK - all tools are read-only/non-destructive/idempotent/open-world");
console.log(`widget OK - ${WIDGET_URI}`);
console.log("\nSMOKE PASS");
