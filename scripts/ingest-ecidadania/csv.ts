/**
 * Parser + aggregator for the e-Cidadania historical-votes CSV (Arquimedes acervo).
 *
 * Source: `senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposições-com-votos.csv`
 * (~33 MB). Shape (confirmed on a live probe):
 *   line 1            : a stamp field  `Dados atualizados até DD/MM/YYYY`  (→ reference_period)
 *   line 2            : header (`;`-separated, quoted):
 *     "CÓD. MATÉRIA";"NOME DA MATÉRIA";"EMENTA";"AUTORIA";"STATUS ATUAL";"UF DO CIDADÃO";"VOTO SIM";"VOTO NÃO";"TOTAL"
 *   lines 3..N        : ONE row per (matéria, UF) — ~149k data rows, ~15k distinct matérias.
 *
 * Two gotchas drove the design:
 *   - EMENTA contains EMBEDDED NEWLINES inside quoted fields, so a naive split('\n')/split(';') would
 *     shred records. The parser is a proper RFC-4180 state machine (quote-aware, `""` escape).
 *   - vote counts use the BR thousand separator ("1.542") → parseBrNum.
 * `STATUS ATUAL` is uniformly "Descontinuado" (the acervo is frozen) — kept verbatim, not relied on.
 *
 * Pure + fixture-testable (no network): the orchestrator does the download and calls these.
 */

import { parseBrNum, extractDate } from "../../src/scraper/ecidadania.js";

/**
 * RFC-4180 parser tolerant of embedded newlines. Default delimiter `;`, quote `"`, `""` escape.
 * Returns records as arrays of raw string cells (no trimming — callers decide). A trailing newline
 * does not produce a spurious empty record.
 */
export function parseCsv(text: string, delimiter = ";"): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // strip UTF-8 BOM

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; } // escaped quote
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === delimiter) { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; } // normalize CRLF → LF
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); } // flush last (no trailing \n)
  return rows;
}

/** One CSV data row, normalized: a single (matéria, UF) vote tally. */
export interface VotoRow {
  codigoMateria: number;
  materia: string;
  ementa: string;
  autoria: string;
  status: string;
  uf: string;
  votosSim: number;
  votosNao: number;
}

export interface ParsedVotosCsv {
  /** ISO date from the "dados atualizados até DD/MM/YYYY" stamp, or null if absent. */
  referencePeriod: string | null;
  rows: VotoRow[];
}

const HEADER_KEYS = {
  codigoMateria: ["CÓD. MATÉRIA", "COD. MATERIA", "CÓD. MATERIA"],
  materia: ["NOME DA MATÉRIA", "NOME DA MATERIA"],
  ementa: ["EMENTA"],
  autoria: ["AUTORIA"],
  status: ["STATUS ATUAL"],
  uf: ["UF DO CIDADÃO", "UF DO CIDADAO"],
  votosSim: ["VOTO SIM"],
  votosNao: ["VOTO NÃO", "VOTO NAO"],
} as const;

function norm(s: string): string {
  return s.replace(/^﻿/, "").trim().toUpperCase();
}

/** Locate each logical column by header label (robust to column reordering). */
function buildColumnIndex(header: string[]): Record<keyof typeof HEADER_KEYS, number> {
  const normed = header.map(norm);
  const idx = {} as Record<keyof typeof HEADER_KEYS, number>;
  for (const key of Object.keys(HEADER_KEYS) as Array<keyof typeof HEADER_KEYS>) {
    const i = normed.findIndex((h) => (HEADER_KEYS[key] as readonly string[]).some((cand) => h === norm(cand)));
    idx[key] = i;
  }
  return idx;
}

/**
 * Parse the full CSV text into the stamp + normalized vote rows. Throws if the header row can't be
 * located or a required column is missing (a structural change the orchestrator must treat as a
 * failed run, never a silent partial corpus).
 */
export function parseVotosCsv(text: string): ParsedVotosCsv {
  const records = parseCsv(text);
  if (records.length === 0) throw new Error("CSV vazio");

  // The stamp is the first record's first cell ("Dados atualizados até DD/MM/YYYY"). extractDate
  // pulls the DD/MM/YYYY → ISO; null if this file ever ships without the stamp line.
  const stampCell = records[0]?.[0] ?? "";
  const referencePeriod = extractDate(stampCell);

  // Header is the first record carrying the matéria-code column; scan a few in case of preamble lines.
  let headerIdx = -1;
  for (let r = 0; r < Math.min(records.length, 5); r++) {
    if (records[r].map(norm).some((h) => (HEADER_KEYS.codigoMateria as readonly string[]).some((c) => h === norm(c)))) {
      headerIdx = r;
      break;
    }
  }
  if (headerIdx < 0) throw new Error("cabeçalho do CSV não encontrado (coluna CÓD. MATÉRIA ausente)");

  const col = buildColumnIndex(records[headerIdx]);
  for (const key of Object.keys(col) as Array<keyof typeof HEADER_KEYS>) {
    if (col[key] < 0) throw new Error(`coluna obrigatória ausente no CSV: ${key}`);
  }

  const rows: VotoRow[] = [];
  for (let r = headerIdx + 1; r < records.length; r++) {
    const rec = records[r];
    const codigoMateria = parseInt((rec[col.codigoMateria] ?? "").replace(/\D/g, ""), 10);
    if (!Number.isFinite(codigoMateria) || codigoMateria <= 0) continue; // skip blank/garbage lines
    rows.push({
      codigoMateria,
      materia: (rec[col.materia] ?? "").trim(),
      ementa: (rec[col.ementa] ?? "").replace(/\s+/g, " ").trim(),
      autoria: (rec[col.autoria] ?? "").trim(),
      status: (rec[col.status] ?? "").trim(),
      uf: (rec[col.uf] ?? "").trim().toUpperCase(),
      votosSim: parseBrNum(rec[col.votosSim] ?? "0"),
      votosNao: parseBrNum(rec[col.votosNao] ?? "0"),
    });
  }
  return { referencePeriod, rows };
}

/** Aggregated tally for one matéria across all its UF rows. */
export interface ConsultaVotoAgg {
  id: number;
  materia: string;
  ementa: string;
  autoria: string;
  status: string;
  votosSim: number;
  votosNao: number;
  votosPorUf: Record<string, { sim: number; nao: number }>;
}

/** Sort an object's keys (deterministic JSON → stable contentHash). */
function sortKeys<T>(obj: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

/**
 * Collapse the one-row-per-(matéria, UF) listing into one record per matéria, summing VOTO SIM/NÃO
 * and keeping the per-UF breakdown (the regional differential). First row of a matéria wins for the
 * descriptive fields (materia/ementa/autoria/status are constant across its UF rows). UF keys are
 * sorted so the resulting JSON — and thus the contentHash — is stable run to run.
 */
export function aggregateByMateria(rows: VotoRow[]): ConsultaVotoAgg[] {
  const byId = new Map<number, ConsultaVotoAgg>();
  for (const r of rows) {
    let agg = byId.get(r.codigoMateria);
    if (!agg) {
      agg = {
        id: r.codigoMateria,
        materia: r.materia,
        ementa: r.ementa,
        autoria: r.autoria,
        status: r.status,
        votosSim: 0,
        votosNao: 0,
        votosPorUf: {},
      };
      byId.set(r.codigoMateria, agg);
    }
    agg.votosSim += r.votosSim;
    agg.votosNao += r.votosNao;
    const uf = r.uf || "??";
    const cur = agg.votosPorUf[uf] ?? { sim: 0, nao: 0 };
    cur.sim += r.votosSim;
    cur.nao += r.votosNao;
    agg.votosPorUf[uf] = cur;
  }
  const out: ConsultaVotoAgg[] = [];
  for (const agg of byId.values()) {
    agg.votosPorUf = sortKeys(agg.votosPorUf);
    out.push(agg);
  }
  return out;
}
