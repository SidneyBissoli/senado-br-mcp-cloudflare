/**
 * Smoke-check de produção do envelope de proveniência (Vetor A).
 * Handshake MCP Streamable HTTP real: initialize → tools/call.
 * Rode: node scripts/smoke-provenance.mjs
 */

const BASE = process.env.MCP_URL || "https://senado-br-mcp.sidneybissoli.workers.dev/mcp";

let sessionId;
let id = 0;

async function rpc(method, params) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await fetch(BASE, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;

  const text = await res.text();
  // Streamable HTTP responds with SSE; pull the JSON out of the last `data:` line.
  const ct = res.headers.get("content-type") || "";
  let payload;
  if (ct.includes("text/event-stream")) {
    const dataLines = text.split("\n").filter((l) => l.startsWith("data:"));
    payload = JSON.parse(dataLines[dataLines.length - 1].slice(5).trim());
  } else {
    payload = JSON.parse(text);
  }
  if (payload.error) throw new Error(`${method} → ${JSON.stringify(payload.error)}`);
  return payload.result;
}

function structured(result) {
  // tools/call returns { content: [...], structuredContent: {...} }
  return result.structuredContent;
}

async function main() {
  console.log(`Endpoint: ${BASE}\n`);

  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke-provenance", version: "0" },
  });
  console.log(`✓ initialize (session: ${sessionId || "stateless"})`);

  // 1) search_votacoes — pega votações recentes e inspeciona a proveniência
  const search = await rpc("tools/call", {
    name: "senado_search_votacoes",
    arguments: { dias: 60 },
  });
  const s = structured(search);
  console.log(`\n■ senado_search_votacoes (dias:60) → count=${s?.count}`);
  console.log("  provenance:", JSON.stringify(s?.provenance, null, 2));
  const footer = search.content?.find((c) => c.text?.includes("Fonte:"))?.text;
  console.log("  rodapé:", footer ? footer.replace(/\n/g, " ") : "(ausente)");

  const cod = s?.votacoes?.[0]?.codigoSessao;
  if (!cod) {
    console.log("\n(sem votações no período — pulando obter_votacao)");
    return;
  }

  // 2) obter_votacao — duas chamadas: confirma retrieved_at preservado no cache-hit
  const first = structured(await rpc("tools/call", {
    name: "senado_obter_votacao",
    arguments: { codigoVotacao: cod },
  }));
  const second = structured(await rpc("tools/call", {
    name: "senado_obter_votacao",
    arguments: { codigoVotacao: cod },
  }));
  console.log(`\n■ senado_obter_votacao (codigoVotacao:${cod}) — 2 chamadas`);
  console.log("  retrieved_at #1:", first?.provenance?.retrieved_at);
  console.log("  retrieved_at #2:", second?.provenance?.retrieved_at, "(cache-hit deve = #1)");
  console.log("  source_url:", first?.provenance?.source_url);
  console.log(
    `\n  retrieved_at preservado no cache-hit: ${first?.provenance?.retrieved_at === second?.provenance?.retrieved_at ? "SIM ✓" : "NÃO ✗"}`,
  );

  // 3) Tools de busca/listagem — uma amostra de cada FONTE confirma envelope nível-1 não-vazio.
  const CORE = ["source", "source_url", "retrieved_at", "attribution"];
  const extras = [
    // Legislativo (legis.senado.leg.br)
    { name: "senado_buscar_materias", arguments: { sigla: "PEC", ano: 2023, limite: 3 } },
    { name: "senado_search_processos", arguments: { sigla: "PL", ano: 2024 } },
    { name: "senado_votacoes_senador", arguments: { codigoSenador: 5322, ano: 2024 } },
    { name: "senado_listar_senadores", arguments: { uf: "SP" } },
    { name: "senado_listar_comissoes", arguments: {} },
    { name: "senado_listar_blocos", arguments: {} },
    // Administrativo (adm.senado.gov.br)
    { name: "senado_ceaps", arguments: { ano: 2023, modo: "por-tipo" } },
    { name: "senado_contratos", arguments: { ano: 2023, limite: 3 } },
    // Execução orçamentária (Arquimedes/Financeiro)
    { name: "senado_execucao_orcamentaria", arguments: { tipo: "despesas", modo: "por-ano" } },
    // e-Cidadania (www12.senado.leg.br/ecidadania, lê do D1)
    { name: "senado_ecidadania_listar_consultas", arguments: { limite: 3 } },
  ];
  console.log("\n■ Tools expandidas — uma amostra por fonte (envelope nível-1 não-vazio):");
  for (const call of extras) {
    try {
      const p = structured(await rpc("tools/call", call))?.provenance;
      const missing = CORE.filter((k) => !p?.[k]);
      console.log(
        `  ${call.name}: ${missing.length === 0 ? "OK ✓" : "FALTANDO " + missing.join(",") + " ✗"}` +
          `  (source_url: ${p?.source_url || "—"})`,
      );
    } catch (e) {
      console.log(`  ${call.name}: ERRO — ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error("FALHA:", e.message);
  process.exit(1);
});
