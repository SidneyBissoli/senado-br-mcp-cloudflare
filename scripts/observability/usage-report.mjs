// Vetor B — usage report runner. Queries the Analytics Engine SQL API for the
// per-tool usage series collected by src/instrument.ts (dataset
// `senado_mcp_tool_calls`) and prints readable tables.
//
// The collection is already deployed; this is the consumption side. Queries A/B
// have always been valid; C/D (cache-vs-live) are only meaningful for rows
// written after the fromCache capture deploy (see DEPLOY_DATE) — the runner adds
// that filter automatically. Every count is weighted by `_sample_interval`
// because AE samples under load.
//
// AE SQL is a limited ClickHouse subset: NO scalar subqueries and NO NULLIF, so
// the adoption % (B) and cache-hit ratio (C) are computed in JS from raw sums.
//
// Token (never committed): read from CF_API_TOKEN, else from
// `.secrets/cf-analytics-token` (gitignored). Needs `Account Analytics: Read`.
//
// Usage:
//   CF_API_TOKEN=… node scripts/observability/usage-report.mjs           # all queries
//   node scripts/observability/usage-report.mjs A B                       # subset
//   node scripts/observability/usage-report.mjs --selftest                # formatting only, no token
//   node scripts/observability/usage-report.mjs --days 7                  # override window (A/B)

import fs from "node:fs";
import path from "node:path";

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "5c499208eebced4e34bd98ffa204f2fb";
const DATASET = "senado_mcp_tool_calls";
// Deploy of the fromCache capture (blob3/double2/double3). Rows before this lack
// the cache dimension, so C/D filter on it. The filter is by date, so calls made
// earlier on the deploy day still leak in with an empty cache_class (known caveat).
const DEPLOY_DATE = process.env.CACHE_CAPTURE_DEPLOY || "2026-06-22";

// Strip a leading UTF-8 BOM (Windows editors like Notepad often add one) and
// surrounding whitespace/newlines, so a token pasted into a file Just Works.
const clean = (s) => s.replace(/^﻿/, "").trim();
const num = (v) => (v == null || v === "" ? 0 : Number(v));

function readToken() {
  if (process.env.CF_API_TOKEN && clean(process.env.CF_API_TOKEN)) {
    return clean(process.env.CF_API_TOKEN);
  }
  for (const f of [
    path.resolve(".secrets/cf-analytics-token"),
    path.resolve(".secrets/cf-analytics-token.txt"),
  ]) {
    try {
      const t = clean(fs.readFileSync(f, "utf8"));
      if (t) return t;
    } catch {
      /* not present — try next */
    }
  }
  return null;
}

const dayFilter = (days) => `timestamp >= NOW() - INTERVAL '${days}' DAY`;
const cacheFilter = `timestamp >= toDateTime('${DEPLOY_DATE} 00:00:00')`;

const reports = {
  A: {
    title: "A) Uso por tool por dia + taxa de erro",
    run: (token, { days }) =>
      runSQL(
        `SELECT toStartOfDay(timestamp) AS day, blob1 AS tool,
                SUM(_sample_interval) AS calls,
                SUM(double1 * _sample_interval) AS errors,
                round(SUM(double1 * _sample_interval) / SUM(_sample_interval), 4) AS error_rate
         FROM ${DATASET} WHERE ${dayFilter(days)}
         GROUP BY day, tool ORDER BY day DESC, calls DESC`,
        token,
      ),
  },
  B: {
    title: "B) Ranking de adoção + participação % (top 25)",
    // No scalar subquery in AE SQL → fetch the grand total separately, divide in JS.
    run: async (token, { days }) => {
      const totalRows = await runSQL(
        `SELECT SUM(_sample_interval) AS total FROM ${DATASET} WHERE ${dayFilter(days)}`,
        token,
      );
      const total = num(totalRows[0]?.total) || 1;
      const rows = await runSQL(
        `SELECT blob1 AS tool, SUM(_sample_interval) AS calls
         FROM ${DATASET} WHERE ${dayFilter(days)}
         GROUP BY tool ORDER BY calls DESC LIMIT 25`,
        token,
      );
      return rows.map((r) => ({
        ...r,
        pct_share: Math.round((1000 * num(r.calls)) / total) / 10,
      }));
    },
  },
  C: {
    title: `C) Cache-vs-live por tool (rows >= ${DEPLOY_DATE})`,
    // No NULLIF in AE SQL → compute the ratio in JS, guarding divide-by-zero.
    run: async (token) => {
      const rows = await runSQL(
        `SELECT blob1 AS tool,
                SUM(_sample_interval) AS calls,
                SUM(double2 * _sample_interval) AS upstream_fetches,
                SUM(double3 * _sample_interval) AS cache_hits
         FROM ${DATASET} WHERE ${cacheFilter}
         GROUP BY tool ORDER BY calls DESC`,
        token,
      );
      return rows.map((r) => {
        const fetches = num(r.upstream_fetches);
        return {
          ...r,
          cache_hit_ratio:
            fetches > 0 ? Math.round((10000 * num(r.cache_hits)) / fetches) / 10000 : "—",
        };
      });
    },
  },
  D: {
    title: `D) Distribuição de classe de cache (rows >= ${DEPLOY_DATE})`,
    run: (token) =>
      runSQL(
        `SELECT blob1 AS tool, blob3 AS cache_class, SUM(_sample_interval) AS calls
         FROM ${DATASET} WHERE ${cacheFilter}
         GROUP BY tool, cache_class ORDER BY tool, calls DESC`,
        token,
      ),
  },
};

function printTable(rows) {
  if (!rows || rows.length === 0) {
    console.log("  (sem dados na janela)");
    return;
  }
  const cols = Object.keys(rows[0]);
  const width = (c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length));
  const w = Object.fromEntries(cols.map((c) => [c, width(c)]));
  const line = (vals) =>
    "  " + cols.map((c) => String(vals[c] ?? "").padEnd(w[c])).join("  ");
  console.log(line(Object.fromEntries(cols.map((c) => [c, c]))));
  console.log("  " + cols.map((c) => "-".repeat(w[c])).join("  "));
  for (const r of rows) console.log(line(r));
}

async function runSQL(sql, token) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: sql },
  );
  const text = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? " — token inválido ou sem permissão 'Account Analytics: Read'"
        : "";
    throw new Error(`HTTP ${res.status}${hint}\n${text.slice(0, 400)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Resposta não-JSON: ${text.slice(0, 400)}`);
  }
  return json.data ?? [];
}

function selftest() {
  console.log("[selftest] formatação de tabela (sem token):\n");
  printTable([
    { tool: "senado_ceaps", calls: 1234, pct_share: 18.7 },
    { tool: "senado_listar_senadores", calls: 980, pct_share: 14.9 },
    { tool: "senado_obter_votacao", calls: 12, pct_share: 0.18 },
  ]);
  console.log("\n[selftest] tabela vazia:");
  printTable([]);
  console.log("\n[selftest] OK");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) return selftest();

  const daysIdx = args.indexOf("--days");
  const days = daysIdx >= 0 ? String(args[daysIdx + 1]) : "30";
  const picked = args.filter((a) => /^[A-D]$/.test(a));
  const toRun = picked.length ? picked : ["A", "B", "C", "D"];

  const token = readToken();
  if (!token) {
    console.error(
      "Falta o token. Defina CF_API_TOKEN ou crie .secrets/cf-analytics-token\n" +
        "(token com permissão 'Account Analytics: Read').",
    );
    process.exit(2);
  }

  console.log(
    `Analytics Engine — dataset ${DATASET} — conta ${ACCOUNT_ID.slice(0, 8)}… — janela ${days}d (A/B)\n`,
  );
  for (const key of toRun) {
    const r = reports[key];
    console.log(`\n=== ${r.title} ===`);
    try {
      printTable(await r.run(token, { days }));
    } catch (e) {
      // console.log (not error) so it stays ordered under its header.
      console.log(`  ERRO: ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
