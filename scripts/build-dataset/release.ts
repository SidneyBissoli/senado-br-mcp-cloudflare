/**
 * Freeze de um RELEASE congelado do dataset (Fase 1.3, sessão C2) — OFF-Worker.
 *
 * CONSOME o build da Fase 1.2 (`dataset/<schemaVersion>/` com NDJSON + datapackage.json + dictionary.md)
 * SEM reescrevê-lo. O freeze é aditivo e determinístico: computa o SHA-256 canônico de cada arquivo de
 * dado, grava `SHA256SUMS` (formato coreutils) e `release.json` (manifesto com as duas versões, DOIs,
 * commit e contagens) AO LADO dos dados, e copia os arquivos de citação/licença/changelog para dentro
 * da pasta — deixando a bundle self-contained e pronta para o tarball do GitHub Release / depósito
 * Zenodo (feitos pelo workflow `release-dataset.yml`).
 *
 * O checksum é do conteúdo NÃO comprimido (o artefato científico canônico). O gzip/tar é transporte e
 * fica a cargo do workflow — assim `sha256sum -c SHA256SUMS` valida o dado independentemente do nível
 * de compressão de quem baixou.
 *
 * Uso:
 *   npm run release:dataset                       # versão = DATASET_RELEASE_VERSION, in = dataset/<schemaVersion>
 *   npm run release:dataset -- --version 1.1.0    # corta outra edição
 *   npm run release:dataset -- --in dataset/1.0.0 --concept-doi 10.5281/zenodo.123 --version-doi 10.5281/zenodo.124
 *
 * Flags:
 *   --version <X.Y.Z>     versão SemVer do release (default: DATASET_RELEASE_VERSION)
 *   --in <dir>            pasta do build da Fase 1.2 (default: dataset/<DATASET_SCHEMA_VERSION>)
 *   --concept-doi <doi>   concept-DOI Zenodo (default: placeholder)
 *   --version-doi <doi>   version-DOI Zenodo deste corte (default: placeholder)
 *   --edition <str>       rótulo humano da edição (default: DATASET_RELEASE_EDITION)
 *   --generated-at <iso>  instante do freeze (default: agora)
 */

import { createReadStream, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { join } from "node:path";
import {
  DATASET_RELEASE_VERSION,
  DATASET_RELEASE_EDITION,
  DATASET_SCHEMA_VERSION,
  DOI_PLACEHOLDER,
  buildReleaseManifest,
  formatSha256Sums,
  validateReleaseVersion,
  type ReleaseFile,
} from "../../src/dataset/release.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** SHA-256 hex + bytes + (para .ndjson) contagem de registros, num único passe streamado. */
function digestFile(path: string, countLines: boolean): Promise<{ sha256: string; bytes: number; records?: number }> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let bytes = 0;
    let newlines = 0;
    let lastByte = -1;
    const stream = createReadStream(path);
    stream.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      bytes += chunk.length;
      if (countLines) {
        for (let i = 0; i < chunk.length; i++) if (chunk[i] === 0x0a) newlines++;
        if (chunk.length > 0) lastByte = chunk[chunk.length - 1];
      }
    });
    stream.on("end", () => {
      const out: { sha256: string; bytes: number; records?: number } = {
        sha256: hash.digest("hex"),
        bytes,
      };
      if (countLines) {
        // 1 registro por '\n'. Se o arquivo não termina em '\n' há um registro final sem newline.
        const trailing = bytes > 0 && lastByte !== 0x0a ? 1 : 0;
        out.records = newlines + trailing;
      }
      resolve(out);
    });
    stream.on("error", reject);
  });
}

/** SHA do commit corrente (freeze reproduzível ancora no commit). Env tem prioridade (CI). */
function gitCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
  const version = flag("version") || DATASET_RELEASE_VERSION;
  validateReleaseVersion(version);
  const inDir = flag("in") || join("dataset", DATASET_SCHEMA_VERSION);
  const conceptDoi = flag("concept-doi") || DOI_PLACEHOLDER;
  const versionDoi = flag("version-doi") || DOI_PLACEHOLDER;
  const edition = flag("edition") || DATASET_RELEASE_EDITION;
  const generatedAt = flag("generated-at") || new Date().toISOString();

  if (!existsSync(inDir)) {
    throw new Error(
      `pasta de build não encontrada: ${inDir}. Rode 'npm run build:dataset' antes do freeze.`,
    );
  }

  // datapackage.json declara os arquivos de dado da Fase 1.2 — fonte da lista a hashear.
  const datapackagePath = join(inDir, "datapackage.json");
  if (!existsSync(datapackagePath)) {
    throw new Error(`datapackage.json ausente em ${inDir}; o build da Fase 1.2 está incompleto.`);
  }
  const datapackage = JSON.parse(readFileSync(datapackagePath, "utf8")) as {
    schemaVersion: string;
    entities: Array<{ file: string }>;
  };
  if (datapackage.schemaVersion !== DATASET_SCHEMA_VERSION) {
    throw new Error(
      `schemaVersion do build (${datapackage.schemaVersion}) != esperado (${DATASET_SCHEMA_VERSION}). ` +
        `Rebuild o dataset antes de congelar.`,
    );
  }

  // Arquivos a incluir no checksum: os NDJSON (dado) + datapackage.json + dictionary.md (metadados
  // versionados). release.json e SHA256SUMS são metadados do release e ficam FORA (circularidade).
  const dataFiles = datapackage.entities.map((e) => e.file);
  const metaFiles = ["datapackage.json", "dictionary.md"].filter((f) => existsSync(join(inDir, f)));

  const files: ReleaseFile[] = [];
  for (const file of dataFiles) {
    const path = join(inDir, file);
    if (!existsSync(path)) throw new Error(`arquivo de dado ausente: ${path}`);
    const d = await digestFile(path, /* countLines */ true);
    files.push({ file, sha256: d.sha256, bytes: d.bytes, records: d.records });
    console.log(`[release] ${file}: ${d.records} registros, ${d.bytes} bytes, sha256=${d.sha256.slice(0, 12)}…`);
  }
  for (const file of metaFiles) {
    const d = await digestFile(join(inDir, file), /* countLines */ false);
    files.push({ file, sha256: d.sha256, bytes: d.bytes });
    console.log(`[release] ${file}: ${d.bytes} bytes, sha256=${d.sha256.slice(0, 12)}…`);
  }

  // ── Escreve SHA256SUMS + release.json ──────────────────────────────────────
  writeFileSync(join(inDir, "SHA256SUMS"), formatSha256Sums(files), "utf8");

  const manifest = buildReleaseManifest({
    releaseVersion: version,
    edition,
    schemaVersion: DATASET_SCHEMA_VERSION,
    conceptDoi,
    versionDoi,
    gitCommit: gitCommit(),
    generatedAt,
    files,
  });
  writeFileSync(join(inDir, "release.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  // ── Copia arquivos de citação/licença/changelog para a bundle (self-contained) ──
  // repo root = cwd (os npm scripts rodam da raiz do pacote), robusto a --in de qualquer profundidade.
  const repoRoot = process.cwd();
  for (const name of ["CHANGELOG-dataset.md", "CITATION.cff", "LICENSE-DATA.md"]) {
    const src = join(repoRoot, name);
    if (existsSync(src)) {
      copyFileSync(src, join(inDir, name));
      console.log(`[release] copiado ${name} → bundle`);
    } else {
      console.warn(`[release] AVISO: ${name} não encontrado na raiz — bundle sem esse arquivo.`);
    }
  }

  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
  console.log(
    `[release] v${version} congelado em ${inDir} (${files.length} arquivos, ${(totalBytes / 1e6).toFixed(1)} MB, ` +
      `schemaVersion ${DATASET_SCHEMA_VERSION}, commit ${gitCommit().slice(0, 8)}).`,
  );
  if (conceptDoi === DOI_PLACEHOLDER || versionDoi === DOI_PLACEHOLDER) {
    console.log("[release] NOTA: DOIs em placeholder — cunhe no Zenodo e re-rode com --concept-doi/--version-doi (ver docs/release-runbook.md).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
