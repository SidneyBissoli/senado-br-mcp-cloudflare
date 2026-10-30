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
 * Fluxo em DUAS etapas, porque o `release.json` (dentro e fora do tarball) leva os DOIs e um release
 * publicado no Zenodo não aceita troca de arquivo — o dataset-v1.0.0 saiu com "PENDENTE" porque os
 * DOIs só eram conhecidos depois do envio:
 *   1. `--reserve`: cria o rascunho (deposição nova no 1º release; `newversion` de --deposition nos
 *      seguintes, mantendo o concept-DOI), apaga os arquivos herdados da versão anterior, grava a
 *      metadata e devolve deposição + concept-DOI + version-DOI reservado (no GITHUB_OUTPUT, se
 *      houver). O freeze roda DEPOIS, com `--concept-doi`/`--version-doi`.
 *   2. `--draft <id>`: confere que o `release.json` enviado leva os DOIs reservados daquele rascunho
 *      (recusa senão), envia os arquivos e publica com --publish (sem ela, fica em rascunho).
 *
 * Uso:
 *   ZENODO_TOKEN=... npm run release:zenodo -- --version 1.1.0 --reserve [--deposition <recid>]
 *   ZENODO_TOKEN=... npm run release:zenodo -- --version 1.1.0 --draft <id> --file <tarball> --file <release.json> [...] [--publish]
 *   flags: --version <X.Y.Z> (obrig.) · --file <path> (repetível; um deles DEVE ser release.json)
 *          --dry-run (só imprime a metadata) · --concept-doi <doi> (isVersionOf no --dry-run)
 */

import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import {
  buildZenodoMetadata,
  conferirDoisDoManifesto,
  doisDaDeposicao,
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

interface ZenodoDepositionFile {
  id: string;
  filename: string;
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
  // DELETE responde 204 sem corpo.
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Grava `chave=valor` no GITHUB_OUTPUT (no Actions) e sempre no console. */
function emitir(chave: string, valor: string): void {
  console.log(`[zenodo] ${chave}=${valor}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${chave}=${valor}\n`);
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
  const reserve = hasFlag("reserve");
  const draft = flag("draft");
  const deposition = flag("deposition");

  // Metadata (parte pura) — sempre montável, útil no --dry-run.
  const zjPath = join(process.cwd(), ".zenodo.json");
  const zj = existsSync(zjPath) ? (JSON.parse(readFileSync(zjPath, "utf8")) as ZenodoJson) : {};

  if (dryRun) {
    console.log("[zenodo] DRY-RUN — metadata que seria enviada:");
    console.log(JSON.stringify(buildZenodoMetadata(zj, { version, conceptDoi: flag("concept-doi") || "" }), null, 2));
    console.log(`[zenodo] arquivos: ${files.join(", ") || "(nenhum)"}`);
    return;
  }

  if (!TOKEN) {
    console.log("[zenodo] ZENODO_TOKEN ausente — pulando publicação (no-op). Integração Zenodo é opt-in.");
    return;
  }
  if (reserve === Boolean(draft)) {
    throw new Error("use --reserve (antes do freeze) OU --draft <id> (envio, depois do freeze).");
  }

  if (reserve) {
    // ── Etapa 1: rascunho + DOIs, ANTES do freeze ─────────────────────────────
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
      // O rascunho de nova versão herda os arquivos da anterior; os nomes colidiriam no envio.
      const herdados = await api<ZenodoDepositionFile[]>("GET", `/api/deposit/depositions/${dep.id}/files`);
      for (const f of herdados) {
        await api("DELETE", `/api/deposit/depositions/${dep.id}/files/${f.id}`);
        console.log(`[zenodo] removido arquivo herdado ${f.filename}`);
      }
    } else {
      console.log("[zenodo] criando deposição nova (1º release → concept-DOI nasce aqui)…");
      dep = await api<ZenodoDeposition>("POST", "/api/deposit/depositions", {});
    }

    const dois = doisDaDeposicao(dep);
    await api("PUT", `/api/deposit/depositions/${dep.id}`, buildZenodoMetadata(zj, { version, conceptDoi: dois.conceptDoi }));
    console.log(`[zenodo] rascunho ${dep.id} com metadata; congele o release com estes DOIs.`);
    emitir("deposition_id", String(dep.id));
    emitir("concept_doi", dois.conceptDoi);
    emitir("version_doi", dois.versionDoi);
    return;
  }

  // ── Etapa 2: envio para o rascunho reservado ─────────────────────────────────
  if (files.length === 0) throw new Error("nenhum --file para enviar (e não é --dry-run).");
  for (const f of files) if (!existsSync(f)) throw new Error(`arquivo não encontrado: ${f}`);
  const manifestPath = files.find((f) => basename(f) === "release.json");
  if (!manifestPath) throw new Error("o envio precisa incluir o release.json (é ele que leva os DOIs).");

  const dep = await api<ZenodoDeposition>("GET", `/api/deposit/depositions/${draft}`);
  const dois = doisDaDeposicao(dep);
  const problemas = conferirDoisDoManifesto(JSON.parse(readFileSync(manifestPath, "utf8")), dois);
  if (problemas.length > 0) {
    throw new Error(`release.json não leva os DOIs do rascunho ${draft} — nada enviado:\n  ${problemas.join("\n  ")}`);
  }

  if (!dep.links.bucket) throw new Error("Zenodo não retornou bucket de upload.");
  for (const f of files) await uploadFile(dep.links.bucket, f);

  if (doPublish) {
    const published = await api<ZenodoDeposition>(
      "POST",
      `/api/deposit/depositions/${dep.id}/actions/publish`,
    );
    console.log(`[zenodo] PUBLICADO. version-DOI=${published.doi ?? "?"} concept-DOI=${published.conceptdoi ?? "?"}`);
    console.log("[zenodo] grave o version-DOI em CHANGELOG-dataset.md (runbook); o release.json já o leva.");
  } else {
    console.log(`[zenodo] deposição ${dep.id} em RASCUNHO (sem --publish). Revise e publique pela UI.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
