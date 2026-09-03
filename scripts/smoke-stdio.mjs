// Smoke test for the npm/stdio channel: spawn `node dist/cli.js`, run the MCP
// handshake over stdio, and assert (1) tools/list returns the full catalog —
// the expected count is DERIVED from the newest `baselines/surface-stdio-<v>.json`
// (`toolCount`), never pinned here (the literal 66 this file carried had gone
// stale unnoticed) — (2) `search` → `fetch` (the Deep Research contract) round-trip
// against the live upstream, with an unknown id answering isError, and (3) stdout
// carries ONLY JSON-RPC — any non-JSON line means log contamination of the
// protocol stream. Run after `npm run build`.
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

/** `toolCount` of the newest stdio baseline (highest version in the file name). */
function expectedToolCount() {
  const versao = (f) => f.match(/^surface-stdio-(\d+)\.(\d+)\.(\d+)\.json$/)?.slice(1).map(Number);
  const baselines = readdirSync("baselines")
    .filter((f) => versao(f))
    .sort((a, b) => {
      const [va, vb] = [versao(a), versao(b)];
      return va[0] - vb[0] || va[1] - vb[1] || va[2] - vb[2];
    });
  if (baselines.length === 0) throw new Error("no baselines/surface-stdio-<v>.json to derive the tool count from");
  const ultimo = baselines[baselines.length - 1];
  const { toolCount } = JSON.parse(readFileSync(`baselines/${ultimo}`, "utf8"));
  if (!Number.isInteger(toolCount)) throw new Error(`${ultimo} has no integer toolCount`);
  return { toolCount, baseline: ultimo };
}

const child = spawn(process.execPath, ["dist/cli.js"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let stdoutBuf = "";
const stdoutLines = [];
const responses = new Map();

child.stdout.on("data", (chunk) => {
  stdoutBuf += chunk.toString();
  let nl;
  while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
    const line = stdoutBuf.slice(0, nl).trim();
    stdoutBuf = stdoutBuf.slice(nl + 1);
    if (!line) continue;
    stdoutLines.push(line);
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      fail(`Non-JSON line on stdout (protocol corruption): ${line}`);
    }
    if (msg.id != null) responses.set(msg.id, msg);
  }
});

let stderrBuf = "";
child.stderr.on("data", (c) => (stderrBuf += c.toString()));

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + "\n");
}
function fail(why) {
  console.error("FAIL:", why);
  if (stderrBuf) console.error("--- child stderr ---\n" + stderrBuf);
  child.kill();
  process.exit(1);
}
const waitFor = (id, ms = 8000) =>
  new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (responses.has(id)) {
        clearInterval(iv);
        res(responses.get(id));
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv);
        rej(new Error(`timeout waiting for id ${id}`));
      }
    }, 25);
  });

try {
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "smoke-stdio", version: "0" },
    },
  });
  const init = await waitFor(1);
  if (!init.result?.serverInfo?.name) fail("initialize returned no serverInfo");
  console.log(
    `initialize OK — ${init.result.serverInfo.name} v${init.result.serverInfo.version}`,
  );

  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const list = await waitFor(2);
  const tools = list.result?.tools ?? [];
  const { toolCount, baseline } = expectedToolCount();
  console.log(`tools/list OK — ${tools.length} tools (baseline ${baseline}: ${toolCount})`);
  if (tools.length !== toolCount) fail(`expected ${toolCount} tools (from ${baseline}), got ${tools.length}`);

  // Deep Research round-trip: search → fetch on the first hit, then an unknown id.
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search", arguments: { query: "CCJ" } } });
  const search = await waitFor(3, 30000);
  if (search.result?.isError) fail(`search isError: ${search.result.content?.[0]?.text}`);
  const results = search.result?.structuredContent?.results ?? [];
  if (results.length === 0) fail("search returned no results for 'CCJ'");
  const texto = JSON.parse(search.result.content[0].text);
  if (JSON.stringify(texto.results) !== JSON.stringify(results)) fail("search: content JSON differs from structuredContent");
  console.log(`search OK — ${results.length} results, first ${results[0].id} (${results[0].title})`);

  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "fetch", arguments: { id: results[0].id } } });
  const fetched = await waitFor(4, 30000);
  if (fetched.result?.isError) fail(`fetch isError: ${fetched.result.content?.[0]?.text}`);
  const doc = fetched.result?.structuredContent;
  if (!doc?.text || doc.id !== results[0].id || !doc.url) fail("fetch: document lacks id/text/url");
  console.log(`fetch OK — ${doc.title} (${doc.text.length} chars, ${doc.url})`);

  send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "fetch", arguments: { id: "xyz:0" } } });
  const desconhecido = await waitFor(5, 30000);
  if (desconhecido.result?.isError !== true) fail("fetch of an unknown id did not answer isError");
  console.log("fetch unknown id OK — isError");

  // Every stdout line must have parsed as JSON-RPC (checked above on receipt).
  console.log(`stdout purity OK — ${stdoutLines.length} lines, all JSON-RPC`);

  console.log("\nSMOKE PASS");
  child.kill();
  process.exit(0);
} catch (e) {
  fail(e.message);
}
