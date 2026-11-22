/**
 * Freeze de um RELEASE congelado do dataset — OFF-Worker.
 *
 * Desde o 3.0.0 CONSOME o pacote da camada 3 (`dataset/3.0.0/`, gerado por `npm run dataset:pacote`:
 * Parquet + datapackage.json + dicionario.md) SEM reescrevê-lo. O freeze é aditivo e determinístico:
 * computa o SHA-256 de cada arquivo, confere as linhas de cada Parquet (rodapé do arquivo) contra o
 * `rows` do manifesto, grava `SHA256SUMS` (formato coreutils) e `release.json` (manifesto com as duas
 * versões, DOIs, commit e contagens) AO LADO dos dados, e copia os arquivos de citação/licença/
 * changelog para dentro da pasta — deixando a bundle self-contained e pronta para o tarball do GitHub
 * Release / depósito Zenodo (feitos pelo workflow `release-dataset.yml`).
 *
 * O checksum é do arquivo como está na pasta; o gzip/tar é transporte e fica a cargo do workflow —
 * `sha256sum -c SHA256SUMS` valida o dado independentemente de quem comprimiu.
 *
 * Uso:
 *   npm run release:dataset                       # versão = DATASET_RELEASE_VERSION, in = dataset/3.0.0
 *   npm run release:dataset -- --version 3.1.0    # corta outra edição
 *   npm run release:dataset -- --in dataset/3.0.0 --concept-doi 10.5281/zenodo.123 --version-doi 10.5281/zenodo.124
 *
 * Flags:
 *   --version <X.Y.Z>     versão SemVer do release (default: DATASET_RELEASE_VERSION)
 *   --in <dir>            pasta do pacote (default: dataset/<ESQUEMA_V3>)
 *   --concept-doi <doi>   concept-DOI Zenodo (default: placeholder)
 *   --version-doi <doi>   version-DOI Zenodo deste corte (default: placeholder)
 *   --edition <str>       rótulo humano da edição (default: DATASET_RELEASE_EDITION)
 *   --generated-at <iso>  instante do freeze (default: agora)
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { parquetMetadata } from "hyparquet";
import {
  DATASET_RELEASE_VERSION,
  DATASET_RELEASE_EDITION,
  DOI_PLACEHOLDER,
  buildReleaseManifest,
  citacaoDoCorte,
  formatSha256Sums,
  origemDosMetadados,
  validateReleaseVersion,
  type ReleaseFile,
} from "../../src/dataset/release.js";
import { BALDE_OBSERVACOES } from "../observacoes/linhas.js";
import { DICIONARIO, ESQUEMA_V3 } from "../publicacao/dicionario.js";
import { chaveNoBalde, nomeDoRecurso } from "../publicacao/pacote.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

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
  const inDir = flag("in") || join("dataset", ESQUEMA_V3);
  const conceptDoi = flag("concept-doi") || DOI_PLACEHOLDER;
  const versionDoi = flag("version-doi") || DOI_PLACEHOLDER;
  const edition = flag("edition") || DATASET_RELEASE_EDITION;
  const generatedAt = flag("generated-at") || new Date().toISOString();

  if (!existsSync(inDir)) {
    throw new Error(`pasta do pacote não encontrada: ${inDir}. Rode 'npm run dataset:pacote' antes do freeze.`);
  }

  // datapackage.json declara as tabelas do pacote — fonte da lista a hashear.
  const datapackagePath = join(inDir, "datapackage.json");
  if (!existsSync(datapackagePath)) {
    throw new Error(`datapackage.json ausente em ${inDir}; o empacotamento está incompleto.`);
  }
  const datapackage = JSON.parse(readFileSync(datapackagePath, "utf8")) as {
    schemaVersion: string;
    resources: Array<{ name: string; path: string; format: string; rows: number }>;
  };
  if (datapackage.schemaVersion !== ESQUEMA_V3) {
    throw new Error(
      `schemaVersion do pacote (${datapackage.schemaVersion}) != esperado (${ESQUEMA_V3}). Reempacote antes de congelar.`,
    );
  }

  // Tabelas (Parquet) + metadados versionados. release.json e SHA256SUMS ficam FORA (circularidade).
  const files: ReleaseFile[] = [];
  for (const r of datapackage.resources) {
    if (r.format !== "parquet") throw new Error(`recurso fora do formato do release: ${r.path} (${r.format})`);
    const path = join(inDir, r.path);
    if (!existsSync(path)) throw new Error(`tabela ausente: ${path}`);
    const bytes = new Uint8Array(readFileSync(path));
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const meta = parquetMetadata(ab);
    const linhas = Number(meta.num_rows);
    // Um Parquet trocado entre o empacotamento e o freeze não passa daqui.
    if (linhas !== r.rows) throw new Error(`${r.path}: ${linhas} linhas no arquivo ≠ ${r.rows} no datapackage.json`);
    // Identidade do insumo (D2.a): a chave no balde vem do dicionário; leitor/cursor, do próprio Parquet.
    const tabela = DICIONARIO.find((t) => nomeDoRecurso(t) === r.name);
    if (!tabela) throw new Error(`recurso fora do dicionário: ${r.name}`);
    const kv = Object.fromEntries((meta.key_value_metadata ?? []).map((e) => [e.key, e.value ?? ""]));
    const origem = origemDosMetadados(BALDE_OBSERVACOES, chaveNoBalde(tabela), kv);
    const d = sha256(bytes);
    files.push({ file: r.path, sha256: d, bytes: bytes.length, records: linhas, origem });
    console.log(`[release] ${r.path}: ${linhas} linhas, ${bytes.length} bytes, sha256=${d.slice(0, 12)}…, ${origem.leitor} cursor ${origem.cursor}`);
  }
  for (const file of ["datapackage.json", "dicionario.md"]) {
    const path = join(inDir, file);
    if (!existsSync(path)) throw new Error(`${file} ausente em ${inDir}`);
    const bytes = new Uint8Array(readFileSync(path));
    files.push({ file, sha256: sha256(bytes), bytes: bytes.length });
    console.log(`[release] ${file}: ${bytes.length} bytes`);
  }

  // ── Escreve SHA256SUMS + release.json ──────────────────────────────────────
  writeFileSync(join(inDir, "SHA256SUMS"), formatSha256Sums(files), "utf8");

  const manifest = buildReleaseManifest({
    releaseVersion: version,
    edition,
    schemaVersion: ESQUEMA_V3,
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
  for (const name of ["CHANGELOG-dataset.md", "LICENSE-DATA.md"]) {
    const src = join(repoRoot, name);
    if (existsSync(src)) {
      copyFileSync(src, join(inDir, name));
      console.log(`[release] copiado ${name} → bundle`);
    } else {
      console.warn(`[release] AVISO: ${name} não encontrado na raiz — bundle sem esse arquivo.`);
    }
  }
  // A citação da raiz descreve o último release publicado; a do pacote leva a versão e o DOI deste corte.
  const cff = citacaoDoCorte(readFileSync(join(repoRoot, "CITATION.cff"), "utf8"), {
    version,
    versionDoi,
    date: generatedAt.slice(0, 10),
  });
  writeFileSync(join(inDir, "CITATION.cff"), cff, "utf8");
  console.log(`[release] CITATION.cff do corte (v${version}) → bundle`);

  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
  console.log(
    `[release] v${version} congelado em ${inDir} (${files.length} arquivos, ${(totalBytes / 1e6).toFixed(1)} MB, ` +
      `schemaVersion ${ESQUEMA_V3}, commit ${gitCommit().slice(0, 8)}).`,
  );
  if (conceptDoi === DOI_PLACEHOLDER || versionDoi === DOI_PLACEHOLDER) {
    console.log("[release] NOTA: DOIs em placeholder — com o Zenodo ligado o workflow os reserva antes do freeze (ver docs/release-runbook.md).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
