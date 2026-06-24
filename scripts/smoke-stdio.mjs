// Smoke test for the npm/stdio channel: spawn `node dist/cli.js`, run the MCP
// handshake over stdio, and assert (1) tools/list returns the full catalog and
// (2) stdout carries ONLY JSON-RPC — any non-JSON line means log contamination
// of the protocol stream. Run after `npm run build`.
import { spawn } from "node:child_process";

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
  console.log(`tools/list OK — ${tools.length} tools`);
  if (tools.length !== 66) fail(`expected 66 tools, got ${tools.length}`);

  // Every stdout line must have parsed as JSON-RPC (checked above on receipt).
  console.log(`stdout purity OK — ${stdoutLines.length} lines, all JSON-RPC`);

  console.log("\nSMOKE PASS");
  child.kill();
  process.exit(0);
} catch (e) {
  fail(e.message);
}
