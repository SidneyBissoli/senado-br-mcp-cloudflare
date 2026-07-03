# e-Cidadania Coverage: the highlight-list gap and the full-corpus plan

**Date:** 2026-06-15
**Context:** While capturing real tool outputs for a demonstration video, the e-Cidadania analysis tools were found to operate over a tiny, non-representative slice of the portal (~5 consultations) rather than its full set. This document records the finding, its verified root cause in the codebase, and the decision to close the gap. It operationalizes the "e-Cidadania is the killer feature" thesis from `docs/_local/strategic-analysis.md` §3.1 (local, non-versioned planning), and supersedes the deferral noted inline in `src/scraper/pipeline.ts` ("deferred to P2.6").
**Status:** Implemented + deployed (2026-06-16), DoD verified live. Off-Worker weekly ingestion job (`scripts/ingest-ecidadania/`) + GitHub Action; status derived from `/processo` `tramitando=S`; the 2h Cron reduced to a targeted highlight metric splice (`ok-metrica`) to reconcile the two writers; analysis/list tools default to `status: aberta`. No migration. First load: **7,664 consultas** into D1; live DoD passed (`consultas_analise polarizada minimoVotos=5000 margemPolarizacao=10` → 6 cases incl. id 164804). **§5.1 unknown settled:** the `pesquisamateria` listing is **in-tramitação-only** — coverage delivered = the full set of **OPEN** consultations (not closed/historical). Consequences: `status=encerrada` returns ∅ and `todas`==`aberta` today. **Linger fix — IMPLEMENTED:** on every complete run the job re-derives status for ALL stored consultas rows against the fresh `/processo tramitando` set (membership, not listing-absence) so a matter leaving tramitação flips to `encerrada` instead of lingering as an `aberta` zombie — making the `encerrada` filter truthful going forward (`scripts/ingest-ecidadania/restatus.ts`, `selectRestatus`/`buildRestatusRecords`). Pre-ingestion historical/closed consultations remain out of scope.

### Framing and scope (read first)

- **Feature scope.** Full e-Cidadania consultation coverage is a **new MCP capability in its own right, independent of the legislative bills.** It is explicitly **not** restricted to consultations attached to bills currently in tramitação — it covers **all consultations the e-Cidadania portal exposes** (open and closed alike).
- **Ingestion mechanism (settled, see §5.1).** A TypeScript job in this repo, run by a scheduled GitHub Action, paginates the e-Cidadania consultation listing for ids + vote counts and derives each consultation's `status` from the legislative `/processo` API (open ⟺ matter in tramitação) — no per-detail HTML scraping for status. It bulk-loads D1; the Worker only reads.
- **On the R script.** A standalone R script was used during diagnosis to cross-check the size of the consultation universe. It was **diagnostic evidence only — not a blueprint, spec, or constraint** for the MCP's ingestion. It served a different purpose (a monthly research extract joining the tramitando universe with e-Cidadania) and should not be read as the intended implementation.
- **Group scope.** This concerns the e-Cidadania group only (Group G, currently 8 tools). The legislative/administrative API tools are not implicated by any evidence here.

---

## 1. The finding

The e-Cidadania **list and analysis** tools silently survey only the portal's "highlight" set — about 5 currently-open consultations — while presenting themselves as a view over the consultation universe. Any ranking, polarization, consensus, or theme-suggestion result is therefore computed over a micro-sample that is not representative of the thousands of consultations that actually exist.

### 1.1 Evidence

Captured live on 2026-06-15 via the deployed MCP (`senado.sidneybissoli.com/mcp`), and cross-checked against an independent full-listing scrape of `www12.senado.leg.br/ecidadania/pesquisamateria`:

| Source | What it sees |
|--------|--------------|
| `senado_ecidadania_listar_consultas` (`status: todas`, `limite: 100`) | **5** consultas, all `meta.fonte: "d1"` |
| `senado_ecidadania_consultas_analise` (`modo: polarizada`, `minimoVotos: 5000`, `margem: 10`) | **0** results |
| Independent full-listing scrape (same day) | **≥ 4,957** consultations carrying vote data (a lower bound: this figure counts only consultations whose matter is currently in tramitação; the full e-Cidadania set is broader — the Senate reports ~13,775 propositions have received consultation votes historically) |

Among that set, the exact filter the MCP reported as empty (≥5,000 votes, sim/não difference ≤10 pp) yields **6 real polarized consultations**, several with very high participation:

| Proposição | Votes | Sim / Não | Theme |
|---|---:|:---:|---|
| PL 2987/2024 | 118,449 | 46 / 54 | Amnesty for the Jan 8 events |
| PL 5595/2020 | 46,613 | 49 / 51 | In-person vs distance education |
| PEC 10/2023 | 33,730 | 52 / 48 | Monthly constitutional benefit |
| PL 6204/2019 | 12,934 | 48 / 52 | De-judicialization of civil enforcement |

The decisive cross-check: `senado_ecidadania_obter_consulta(164804)` (the amnesty consultation) **returns normally** — ~118k votes, 46/54, `status: "aberta"` — and notably **without** a `meta.fonte: "d1"` field. So the consultation exists, is open, is polarized, and is reachable by id; yet it is absent from `listar_consultas` and from `consultas_analise`.

### 1.2 Why this matters

This is a **coverage** defect, not an accuracy defect. The 5 rows the MCP serves are correct and fresh (their vote counts changed between two scrapes 2h apart — the Cron is working). The problem is that the analysis tools imply a survey of the universe while seeing a fraction of a percent of it. Per `docs/_local/strategic-analysis.md`, e-Cidadania monitoring is the project's single strongest differentiator; a differentiator that quietly under-reports its own domain undermines exactly the credibility it is meant to build.

---

## 2. Root cause (verified in code)

The split between what works and what doesn't maps cleanly onto two acquisition modes in `src/scraper/ecidadania.ts`:

- **Lists → REST "highlight" endpoints.** `listarConsultasInternal()` fetches `/restcolecaomaismateria`, which returns only the highlighted/open set (~5). The `limite: 100` argument is moot — the endpoint itself returns ~5 items.
- **Detail → live HTML scrape by id.** `obterConsultaInternal(id)` scrapes `/visualizacaomateria?id=`, independent of D1. This is why id 164804 resolves while the lists do not.

The Cron pipeline inherits the highlight-only limitation explicitly. `src/scraper/pipeline.ts`, `scrapeEntity()` comment:

> *"Scrapes the three REST 'highlight' lists (top ~5 per entity — NOT the full corpus; the full corpus would need the paginated /pesquisa* HTML pages, deferred to P2.6)."*

So the gap is a **named, already-deferred milestone**, not a newly discovered bug. The analysis tools then read whatever the Cron persisted:

- `senado_ecidadania_consultas_analise` and `senado_ecidadania_sugerir_tema_enquete` call `resolveList(db, "consultas", …)` → `readCurrent()` → `SELECT … FROM ecidadania_current WHERE entidade = 'consultas'`. They filter/sort **in memory** over whatever rows exist — currently the ~5 highlights. Once `ecidadania_current` holds the full set, these tools scale automatically: **no analysis-tool rewrite is required for them to see more data.**
- The live fallback inside `resolveList` (used when D1 is empty/stale) also calls `listarConsultasInternal()` — the same highlight endpoint. **There is no code path today that exposes the full set to any list/analysis tool.** Per-id `obter_*` is the only full-reach access.

### 2.1 A latent correctness bug to fix alongside

`listarConsultasInternal()` hardcodes `status: "aberta"` for every consultation (it never reads real status). Consequences:

- `senado_ecidadania_listar_consultas`'s `status` filter is currently inert: `status: "encerrada"` always returns 0; `aberta`/`todas` return the same set.
- If closed consultations are later loaded into `ecidadania_current`, the live-fallback path would mislabel them "aberta". Real status capture is therefore a **prerequisite** of the coverage work (see §4).

---

## 3. What already exists and is reusable

The good news that reframes the effort: the persistence and serving layers were built for exactly this, so the gap is almost entirely on the **ingestion side**.

- **Schema (`migrations/0001`, `0002`)** already models the full set: `ecidadania_current` (1 row/item, upserted) carries denormalized `status` and `metrica_principal`; `ecidadania_history` is append-on-change; `ecidadania_detalhe` holds rich detail; `ecidadania_scrape_runs` records run health. Index `idx_current_status` already exists for status-scoped queries. **No schema change is needed** to hold thousands of rows instead of five.
- **Anomaly guard (`src/scraper/anomaly.ts`, `classifyRun`)** already enforces "a run returning < `ECIDADANIA_ANOMALY_MIN_PCT`% of the last good run never overwrites `ecidadania_current`." Exactly the protection a full-set ingestion needs against a broken partial run.
- **Staleness/serving (`src/scraper/store.ts`, `resolveList` + `isStale`)** already degrades D1-first → live → flagged-stale, surfacing `possivelDesatualizacao` and `lastScrapedAt`.
- **Read path reads all rows by entity**, so analysis tools auto-scale with the data.

In short: the data simply isn't being **acquired and written**. Everything downstream of `ecidadania_current` is ready.

---

## 4. Decision 1 (settled) — the analytical population: full set, default `aberta`

Because the feature covers **all** e-Cidadania consultations (Framing note), the set genuinely contains two different kinds of object:

- **Open consultations** — voting is live; the numbers move; this is *current* public opinion.
- **Closed consultations** — voting ended; the numbers are frozen; this is a *historical* record.

These must not be silently blended: a 50/50 split on an open consultation means "people are divided today"; a 50/50 on a closed one means "people were divided then." Treating them as one pile makes "polarization" an uncontrolled mix of live and historical sentiment — unacceptable for a research-grade instrument.

**Status rule (authoritative).** Per the Senate's own guidance, a public consultation runs from the proposition's presentation **until the end of its tramitação**. So `status` is a function of the matter, not a scraped page attribute: **aberta ⟺ matter in tramitação; encerrada ⟺ tramitação concluded.** This is corroborated empirically — `obter_consulta` on two old bills still in tramitação (PL 5595/2020, PL 6204/2019) returns `status: "aberta"` for both, confirming age does not imply closure. The ingestion therefore derives status from the legislative `/processo` API (membership in the `tramitando=S` set), which is robust JSON — not from HTML. The detail-page `encerrada` marker remains available as a per-item fallback for edge cases.

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A. Full set, status-tagged** | Ingest all consultations into `ecidadania_current` with real `status`; analysis tools default to `status: aberta`, expose `todas` for the historical set | Flexible; uses the `status` column + `idx_current_status` as designed; one table answers both "now" and "historically" | Requires reliable per-item status capture |
| **B. Open-only in `current`** | Keep only open consultations in `current`; closed ones live in `ecidadania_history` only | Simplest analytical semantics | Loses the fast path for historical analysis; underuses the schema |

**Decision: Option A (settled 2026-06-15).** Ingest the full set with a truthful `status`; the analysis/list tools **default to `status: aberta`** (current opinion) and allow `todas` for explicit historical study. This is the only option that lets one instrument answer both questions without conflating them, and it matches the schema's existing design intent. Capturing real status is a hard prerequisite (it also fixes §2.1).

---

## 5. Decision 2 (settled) — decouple ingestion from the Worker

The original deferral implicitly assumed the full set would be scraped by paginating HTML **inside the Worker Cron**. That assumption is what made deferral the right call.

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A. In-Worker Cron HTML pagination** | The scheduled Worker paginates the full HTML listing into D1 | Single system | Fragile in the live path: Worker CPU/subrequest/time limits on a long crawl; a markup change silently degrades D1; couples brittle acquisition to the serving runtime |
| **D. Decoupled ingestion (chosen)** | A robust ingestion runs **off-Worker** and bulk-loads D1; the Worker only **reads** | Removes fragile pagination from the live path; a failed run leaves the last-good data intact; the Worker stays simple | Two systems to operate; freshness depends on the external job; needs monitoring |

**Decision: Option D.** The fragility that justified deferral is a property of *where* ingestion runs, not of *whether* coverage is complete. Moving acquisition off-Worker buys full coverage without putting a brittle crawl in the request/Cron path.

### 5.1 Decision 3 (settled) — the ingestion mechanism

- **Runtime:** a scheduled **GitHub Action** (not the maintainer's machine) — runs unattended, leaves a visible run history for monitoring, zero cost.
- **Implementation:** a **TypeScript job inside this repo** (not R/Python), so it imports the MCP's own `contentHash` and `ConsultaResumo` normalization directly — satisfying the consistency constraints in §6 by construction rather than by hand.
- **Source (discovery + votes):** the paginated HTML listing `www12.senado.leg.br/ecidadania/pesquisamateria?p=N` — the only full-coverage source (no REST endpoint lists the full set; the REST `/restcolecaomais*` returns only highlights).
- **Source (status):** derived from the legislative `/processo` API via `tramitando=S` set membership (§4) — not scraped.
- **Cadence:** weekly for the full set (closed metrics are frozen; the 2h REST Cron keeps the open/highlight items fresh).

**One unknown to settle on first run, not a blocker:** whether the HTML listing enumerates closed consultations too, or only those in andamento. Indirect evidence suggests it returns both (the portal's search form filters by keyword/author/type/number, not by status; closed consultations have been extracted from the portal in published studies), but the job's first run confirms it directly by logging the open/closed split.

**End-user impact: none.** The ingestion is build-time infrastructure on the maintainer's side. MCP users never run anything locally — they call the same HTTP endpoint and read the same D1-backed rows.

---

## 6. Constraints any ingestion must honor

Whatever source/method is later chosen, to extend coverage without breaking what already works it must conform to the existing contracts:

1. **Identical content hashing.** Reuse `contentHash()` from `pipeline.ts` (FNV-1a + length suffix) over the same normalized payload. A different hash makes every row read as "changed" forever, bloating `ecidadania_history` and defeating change detection.
2. **Truthful `status` per item** (consequence of Decision 1 and §2.1): derive aberta/encerrada from `/processo` `tramitando` membership (§4); do not inherit the `status: "aberta"` hardcode.
3. **Set `metrica_principal` = `total_votos`** so `idx_current_metrica` sort paths stay correct.
4. **Respect the never-overwrite-good discipline.** Replicate `classifyRun` thresholds, or stage into a temp table and swap atomically, so a truncated run cannot clobber good data.
5. **Reconcile two writers into `ecidadania_current`.** If the 2h REST Cron is kept, it owns the hot/open highlights (frequent metric refresh) while the full-set ingestion owns the long tail (mostly frozen metrics); document the two cadences as intentional. Because the Cron re-touches hot items every 2h, any `scraped_at` regression on those self-heals within one cycle.
6. **Bulk-load mechanism.** Thousands of rows are trivial for D1: generate `INSERT … ON CONFLICT DO UPDATE` batches (mirroring `SQL.upsert`/`SQL.history` in `pipeline.ts`) and apply via `wrangler d1 execute --file=…` or the D1 HTTP `/query` API.

---

## 7. Tool-contract honesty (interim)

Until the full set is ingested, three tools overpromise their scope: `senado_ecidadania_consultas_analise`, `senado_ecidadania_sugerir_tema_enquete`, and `senado_ecidadania_listar_consultas` describe themselves as analyzing/listing "as consultas do e-Cidadania" — true only of the highlight set.

Two honest resolutions, in priority order: **(i)** ship the coverage (§8), after which the descriptions become accurate; **(ii)** if any window remains before that, scope the descriptions to "consultas em destaque / abertas" and lean on the existing `meta.possivelDesatualizacao`. Do not promote the analytical capability externally (including in the demo video) while it computes over the micro-sample.

---

## 8. Implementation handoff (Claude Code)

Mechanism settled in §5.1. Follow the repo's Phase 0 discipline: **first read and map the affected code, present a plan, and get approval before writing anything.** Keep artifacts in English; tool-facing strings stay pt-BR (`CLAUDE.md`). Reuse existing functions rather than re-implementing them.

**Phase 0 — inventory (no code yet).** Read `src/scraper/{ecidadania,pipeline,store,anomaly}.ts`, `migrations/0001_*.sql`, `migrations/0002_*.sql`, `wrangler.toml`, and `CLAUDE.md`. Confirm the exact `ConsultaResumo` shape, the `contentHash` implementation, the `SQL.upsert`/`SQL.history` statements, and the `ECIDADANIA_DB` binding (database `senado-ecidadania`, id in `wrangler.toml`). Produce a short plan and stop for approval.

**Step 1 — job skeleton.** Add a TypeScript job under `scripts/ingest-ecidadania/` (outside the Worker bundle) and an npm script (e.g. `ingest:ecidadania`, run via `tsx`). It **imports — does not copy** — `contentHash`, the `ConsultaResumo` type, and parse helpers (`parseBrNum`, …) from `src/scraper/`.

**Step 2 — listing scraper (discovery + votes).** Implement a pure, exported parser `parseConsultaListingPage(html) -> Array<{ codigoMateria, votosSim, votosNao }>` keyed on the stable pattern (anchors to `visualizacaomateria?id=` plus the SIM/NÃO vote block), independent of div/class structure. Drive it over `pesquisamateria?p=1..N` (discover the last page from the pagination links; throttle politely with retry). Add a fixture-based unit test (save one sample page under `tests/fixtures/`), per the repo's pure-parser test convention. **On the first run, log the total and the open/closed split** — this settles the §5.1 unknown.

**Step 3 — status (no scraping).** Fetch the `tramitando=S` universe from `/processo` (per sigla, as JSON), build a `Set<codigoMateria>`, and set `status = aberta` if the consultation's id is in the set, else `encerrada` (§4). Take `identificacao`/`ementa` for normalization from the listing item when present, else from `/processo`.

**Step 4 — normalize + hash.** Map each consultation to the **exact `ConsultaResumo` shape the Cron produces** (so the hash and the read path stay consistent), compute `contentHash(JSON.stringify(item))` with the imported function, and set `metrica_principal = totalVotos`.

**Step 5 — load D1.** Generate batched `INSERT … ON CONFLICT DO UPDATE` mirroring `SQL.upsert`, plus append-on-change `SQL.history`, plus one `ecidadania_scrape_runs` row. Guard against a truncated crawl: either replicate `classifyRun`'s "≥ `ECIDADANIA_ANOMALY_MIN_PCT`% of last good" rule, or load into a staging table and swap atomically. Apply with `wrangler d1 execute senado-ecidadania --remote --file=out.sql`.

**Step 6 — GitHub Action.** Add `.github/workflows/ingest-ecidadania.yml`: `schedule` weekly + `workflow_dispatch`; steps `checkout` → `setup-node` → `npm ci` → `npm run ingest:ecidadania` → `wrangler d1 execute … --remote`. Authenticate with a `CLOUDFLARE_API_TOKEN` repo secret scoped to D1 edit. Do not commit the token.

**Step 7 — correctness fixes.** In `listarConsultasInternal`, stop hardcoding `status: "aberta"` on the live-fallback path so closed items aren't mislabeled (the 2h highlight Cron may keep "aberta", since highlights are active by definition). Ensure `metrica_principal` is populated everywhere consultas are written.

**Step 8 — tool scoping.** Default the `status` filter of `consultas_analise` / `listar_consultas` to `aberta` (current opinion), keep `todas` available, and reconcile the three tool descriptions (§7) now that they survey the full set.

**Step 9 — QA (falsifiable).** After the first load: `senado_ecidadania_consultas_analise modo=polarizada minimoVotos=5000 margemPolarizacao=10` must surface the amnesty consultation (id 164804) and ≈6 cases; `listar_consultas status=todas` count must approximate the ingested set; confirm id 164804 is present in `ecidadania_current`.

**Step 10 — docs.** Update `README.md` inventory + counts (verify against `server.tool(` occurrences per `CLAUDE.md`), document the GitHub Action ingestion path, and set this document's Status to implemented.

---

## 9. Impact on distribution and the demo video

- **The video must not feature the e-Cidadania *analytical/ranking* capability** until step 9 passes — promoting it now would showcase a capability that effectively does not exist yet, on the project's most public surface. **Point-lookup (`obter_consulta`) is honest today** and can carry a single vivid, citable e-Cidadania case (e.g. the amnesty consultation) without any pipeline change.
- **Separately, a prior distribution question stands** (`docs/_local/strategic-analysis.md` §4): the target audience (Senate staff) is steered to Microsoft 365 Copilot, which does not support MCP. A Claude-MCP screencast demonstrates value the audience cannot adopt as-is. This bears on whether the video's purpose is awareness or adoption. Flagged here, not resolved.

---

## 10. Key takeaways

1. **The gap is coverage, not accuracy.** The rows served are correct and fresh; the analysis tools just see ~5 of thousands. The failure mode was generalizing an empty tool result into a claim about the portal.
2. **Everything downstream of `ecidadania_current` is already built** — schema, anomaly guard, staleness handling, and an analysis read path that auto-scales. The work is ingestion-side.
3. **The feature is independent of the bills** and covers **all** e-Cidadania consultations, not only those tied to currently-tramitando matters.
4. **Ingestion is settled:** decoupled (Decision 2), implemented as a TypeScript job in this repo run by a scheduled GitHub Action, with status derived from the `/processo` API (open ⟺ in tramitação) rather than scraped (§5.1). The R script that surfaced the gap was diagnostic evidence, not a design input.
5. **Population is settled (Decision 1): full set; analysis defaults to `aberta`, with `todas` exposed for historical study.** Status must be captured per item, never inferred from age — verified by open consultations on bills from 2019–2020. The `status` column exists for exactly this but is currently hardcoded.
6. **Promote only what is true.** Until coverage ships, scope the analytical tools' claims; keep the video on point-lookup and the sound API tools.
