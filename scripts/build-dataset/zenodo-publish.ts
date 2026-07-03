/**
 * Publicação de um release do dataset no Zenodo via REST API (Fase 1.3, sessão C2) — OFF-Worker, OPT-IN.
 *
 * GATED: sem `ZENODO_TOKEN` no ambiente, sai 0 imediatamente (no-op) — o workflow segue sem falhar.
 * Assim a máquina de releases funciona ponta a ponta (freeze + GitHub Release) mesmo antes de o
 * maintainer configurar o Zenodo; a integração DOI é aditiva.
 *
 * ⚠️ Este orquestrador HTTP NÃO é exercitado por testes (precisa de token/serviço). A parte PURA — o
 * mapeamento `.zenodo.json` → metadata da deposição — está em `src/dataset/release.ts`
 * (`buildZenodoMetadata`) e é testada. Rode SEMPRE com `--dry-run` primeiro, e a primeira publicação
 * real contra `https://sandbox.zenodo.org` (ZENODO_URL). Ver docs/release-runbook.md.
 *
 * Fluxo:
 *   - 1º release (sem --deposition): cria deposição nova → concept-DOI + version-DOI nascem juntos.
 *   - releases seguintes (--deposition <recid do concept OU da última versão>): usa a ação
 *     `newversion` para manter a continuidade sob o mesmo concept-DOI.
 *
 * Uso:
 *   ZENODO_TOKEN=... npm run release:zenodo -- --version 1.0.0 --file <tarball> [--file <sha> ...] [--publish]
 *   flags: --version <X.Y.Z> (obrig.) · --file <path> (repetível, ≥1) · --deposition <recid>
 *          --dry-run (só imprime a metadata) · --publish (publica; sem ela, deixa em rascunho)
 *          --concept-doi <doi> (para gravar isVersionOf quando já conhecido)
 */

import { readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import {
  buildZenodoMetadata,
  validateReleaseVersion,
  type ZenodoJson,
} from "../../src/dataset/release.js";

const ZENODO_URL = process.env.ZENODO_URL || "https://zenodo.org";
const TOKEN = process.env.ZENODO_TOKEN || "";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);
function flags(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}

interface ZenodoDeposition {
  id: number;
  links: { bucket?: string; self?: string; publish?: string; latest_draft?: string };
  metadata?: { prereserve_doi?: { doi?: string } };
  conceptrecid?: string;
  conceptdoi?: string;
  doi?: string;
}

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const full = url.startsWith("http") ? url : `${ZENODO_URL}${url}`;
  const res = await fetch(full, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zenodo ${method} ${full} → ${res.status}: ${text.slice(0, 800)}`);
  }
  return (await res.json()) as T;
}

async function uploadFile(bucketUrl: string, path: string): Promise<void> {
  const name = basename(path);
  const data = readFileSync(path);
  const res = await fetch(`${bucketUrl}/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: data,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zenodo upload ${name} → ${res.status}: ${text.slice(0, 500)}`);
  }
  console.log(`[zenodo] enviado ${name} (${data.length} bytes)`);
}

async function main(): Promise<void> {
  const version = flag("version");
  if (!version) throw new Error("--version <X.Y.Z> é obrigatório.");
  validateReleaseVersion(version);

  const files = flags("file");
  const dryRun = hasFlag("dry-run");
  const doPublish = hasFlag("publish");
  const deposition = flag("deposition");
  const conceptDoi = flag("concept-doi") || "";

  // Metadata (parte pura) — sempre montável, útil no --dry-run.
  const zjPath = join(process.cwd(), ".zenodo.json");
  const zj = existsSync(zjPath) ? (JSON.parse(readFileSync(zjPath, "utf8")) as ZenodoJson) : {};
  const meta = buildZenodoMetadata(zj, { version, conceptDoi });

  if (dryRun) {
    console.log("[zenodo] DRY-RUN — metadata que seria enviada:");
    console.log(JSON.stringify(meta, null, 2));
    console.log(`[zenodo] arquivos: ${files.join(", ") || "(nenhum)"}`);
    return;
  }

  if (!TOKEN) {
    console.log("[zenodo] ZENODO_TOKEN ausente — pulando publicação (no-op). Integração Zenodo é opt-in.");
    return;
  }
  if (files.length === 0) throw new Error("nenhum --file para enviar (e não é --dry-run).");
  for (const f of files) if (!existsSync(f)) throw new Error(`arquivo não encontrado: ${f}`);

  // ── Cria a deposição (nova ou nova versão) ─────────────────────────────────
  let dep: ZenodoDeposition;
  if (deposition) {
    console.log(`[zenodo] nova versão a partir da deposição ${deposition}…`);
    const parent = await api<ZenodoDeposition>(
      "POST",
      `/api/deposit/depositions/${deposition}/actions/newversion`,
    );
    const draftUrl = parent.links.latest_draft;
    if (!draftUrl) throw new Error("Zenodo não retornou latest_draft para a nova versão.");
    dep = await api<ZenodoDeposition>("GET", draftUrl);
  } else {
    console.log("[zenodo] criando deposição nova (1º release → concept-DOI nasce aqui)…");
    dep = await api<ZenodoDeposition>("POST", "/api/deposit/depositions", {});
  }

  if (!dep.links.bucket) throw new Error("Zenodo não retornou bucket de upload.");
  for (const f of files) await uploadFile(dep.links.bucket, f);

  await api("PUT", `/api/deposit/depositions/${dep.id}`, meta);
  console.log(`[zenodo] metadata gravada na deposição ${dep.id}.`);

  const reservedDoi = dep.metadata?.prereserve_doi?.doi;
  if (reservedDoi) console.log(`[zenodo] DOI reservado desta versão: ${reservedDoi}`);

  if (doPublish) {
    const published = await api<ZenodoDeposition>(
      "POST",
      `/api/deposit/depositions/${dep.id}/actions/publish`,
    );
    console.log(`[zenodo] PUBLICADO. version-DOI=${published.doi ?? "?"} concept-DOI=${published.conceptdoi ?? "?"}`);
    console.log("[zenodo] grave esses DOIs em CITATION.cff / CHANGELOG-dataset.md / release.json (runbook).");
  } else {
    console.log(`[zenodo] deposição ${dep.id} em RASCUNHO (sem --publish). Revise e publique pela UI ou re-rode com --publish.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
