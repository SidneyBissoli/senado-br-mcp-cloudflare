// Vetor B — monthly usage spreadsheet. Queries the Analytics Engine SQL API for
// one calendar month and writes an .xlsx with one tab per query (resumo + A/B/C/D)
// to reports/usage/senado-mcp_<last-day-of-month>.xlsx (gitignored). The scheduled
// workflow runs this on the 1st for the previous month and uploads the file as a
// private artifact — it is never committed nor posted to an issue.
//
// AE SQL is a limited ClickHouse subset (no scalar subqueries, no NULLIF), so the
// adoption % (B) and cache-hit ratio (C) are computed in JS. Counts are weighted
// by `_sample_interval` because AE samples under load.
//
// Token (never committed): CF_API_TOKEN or .secrets/cf-analytics-token (gitignored).
//
// Usage:
//   node scripts/observability/monthly-spreadsheet.mjs            # previous calendar month
//   node scripts/observability/monthly-spreadsheet.mjs --month 2026-06

import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "5c499208eebced4e34bd98ffa204f2fb";
const DATASET = "senado_mcp_tool_calls";
const OUT_DIR = "reports/usage";

const clean = (s) => s.replace(/^﻿/, "").trim();
const num = (v) => (v == null || v === "" ? 0 : Number(v));
const pad = (n) => String(n).padStart(2, "0");

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
      /* try next */
    }
  }
  return null;
}

// month is 1-based. Returns SQL-ready bounds + the last-day date for the filename.
function monthBounds(year, month) {
  const start = `${year}-${pad(month)}-01 00:00:00`;
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const nextStart = `${ny}-${pad(nm)}-01 00:00:00`;
  // Date.UTC's month arg is 0-based, so passing the 1-based `month` points at the
  // next month; day 0 rolls back to the last day of the target month.
  const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start, nextStart, lastDay };
}

function previousMonth(d) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
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
  return (JSON.parse(text).data ?? []);
}

async function collect(token, where) {
  const A = (
    await runSQL(
      `SELECT toStartOfDay(timestamp) AS day, blob1 AS tool,
              SUM(_sample_interval) AS calls,
              SUM(double1 * _sample_interval) AS errors,
              round(SUM(double1 * _sample_interval) / SUM(_sample_interval), 4) AS error_rate
       FROM ${DATASET} WHERE ${where}
       GROUP BY day, tool ORDER BY day DESC, calls DESC`,
      token,
    )
  ).map((r) => ({
    day: String(r.day).slice(0, 10),
    tool: r.tool,
    calls: num(r.calls),
    errors: num(r.errors),
    error_rate: num(r.error_rate),
  }));

  const totalRows = await runSQL(
    `SELECT SUM(_sample_interval) AS total FROM ${DATASET} WHERE ${where}`,
    token,
  );
  const total = num(totalRows[0]?.total) || 1;
  const B = (
    await runSQL(
      `SELECT blob1 AS tool, SUM(_sample_interval) AS calls
       FROM ${DATASET} WHERE ${where}
       GROUP BY tool ORDER BY calls DESC LIMIT 25`,
      token,
    )
  ).map((r) => ({
    tool: r.tool,
    calls: num(r.calls),
    pct_share: Math.round((1000 * num(r.calls)) / total) / 10,
  }));

  const C = (
    await runSQL(
      `SELECT blob1 AS tool,
              SUM(_sample_interval) AS calls,
              SUM(double2 * _sample_interval) AS upstream_fetches,
              SUM(double3 * _sample_interval) AS cache_hits
       FROM ${DATASET} WHERE ${where}
       GROUP BY tool ORDER BY calls DESC`,
      token,
    )
  ).map((r) => {
    const fetches = num(r.upstream_fetches);
    return {
      tool: r.tool,
      calls: num(r.calls),
      upstream_fetches: fetches,
      cache_hits: num(r.cache_hits),
      cache_hit_ratio: fetches > 0 ? Math.round((10000 * num(r.cache_hits)) / fetches) / 10000 : "—",
    };
  });

  const D = (
    await runSQL(
      `SELECT blob1 AS tool, blob3 AS cache_class, SUM(_sample_interval) AS calls
       FROM ${DATASET} WHERE ${where}
       GROUP BY tool, cache_class ORDER BY tool, calls DESC`,
      token,
    )
  ).map((r) => ({ tool: r.tool, cache_class: r.cache_class || "(vazio)", calls: num(r.calls) }));

  return { A, B, C, D, total };
}

function addSheet(wb, name, rows) {
  const ws = wb.addWorksheet(name);
  if (!rows.length) {
    ws.addRow(["(sem dados na janela)"]);
    return;
  }
  const cols = Object.keys(rows[0]);
  ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.max(12, c.length + 2) }));
  ws.addRows(rows);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

async function main() {
  const args = process.argv.slice(2);
  const mIdx = args.indexOf("--month");
  let year, month;
  if (mIdx >= 0 && /^\d{4}-\d{2}$/.test(args[mIdx + 1] || "")) {
    [year, month] = args[mIdx + 1].split("-").map(Number);
  } else {
    ({ year, month } = previousMonth(new Date()));
  }

  const token = readToken();
  if (!token) {
    console.error(
      "Falta o token. Defina CF_API_TOKEN ou crie .secrets/cf-analytics-token\n" +
        "(token com permissão 'Account Analytics: Read').",
    );
    process.exit(2);
  }

  const { start, nextStart, lastDay } = monthBounds(year, month);
  const where = `timestamp >= toDateTime('${start}') AND timestamp < toDateTime('${nextStart}')`;
  console.error(`Coletando ${year}-${pad(month)} (${start} → ${nextStart})…`);
  const { A, B, C, D, total } = await collect(token, where);

  const wb = new ExcelJS.Workbook();
  wb.creator = "senado-br-mcp / Vetor B";
  const resumo = wb.addWorksheet("resumo");
  resumo.columns = [
    { header: "campo", key: "k", width: 38 },
    { header: "valor", key: "v", width: 56 },
  ];
  resumo.addRows([
    { k: "mês de referência", v: `${year}-${pad(month)}` },
    { k: "janela", v: `${start} → ${nextStart}` },
    { k: "dataset", v: DATASET },
    { k: "conta", v: ACCOUNT_ID },
    { k: "gerado em (UTC)", v: new Date().toISOString() },
    { k: "total de chamadas (amostra ponderada)", v: total },
    { k: "tools distintas no mês", v: new Set(A.map((r) => r.tool)).size },
    { k: "dias com tráfego", v: new Set(A.map((r) => r.day)).size },
  ]);
  resumo.getRow(1).font = { bold: true };

  addSheet(wb, "A - uso por dia", A);
  addSheet(wb, "B - ranking adocao", B);
  addSheet(wb, "C - cache vs live", C);
  addSheet(wb, "D - classe de cache", D);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `senado-mcp_${lastDay}.xlsx`);
  await wb.xlsx.writeFile(outPath);
  console.error(`OK — ${A.length} linhas em A, ${total} chamadas no mês.`);
  console.log(outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
