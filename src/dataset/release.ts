/**
 * Máquina de RELEASES do dataset de participação do e-Cidadania (Fase 1.3, sessão C2).
 *
 * Núcleo PURO (Node- e Worker-safe, sem I/O): tudo que decide *o que* um release congelado é —
 * versão, edição, manifesto (`release.json`), checksum file (`SHA256SUMS`) e o mapeamento dos
 * metadados de citação (`.zenodo.json`) para uma deposição Zenodo. O I/O real (ler o dataset,
 * hashear arquivos, escrever a bundle, falar com a API do Zenodo) vive no driver off-Worker
 * `scripts/build-dataset/release.ts`, seguindo a mesma separação da Fase 1.2 (pure core em `src/`,
 * driver em `scripts/`).
 *
 * DUAS VERSÕES, DESACOPLADAS de propósito:
 *   - `schemaVersion` (`DATASET_SCHEMA_VERSION`, em `schema.ts`): estrutura das variáveis + envelope.
 *     Só muda quando o esquema muda; gravada em CADA registro.
 *   - `DATASET_RELEASE_VERSION` (aqui): a EDIÇÃO do dado congelado. SemVer própria, com tag
 *     `dataset-v<versão>` (o prefixo separa das tags de código `v3.x`). Convenção de bump:
 *       · MAJOR  → mudança de schema (schemaVersion sobe junto);
 *       · MINOR  → edição periódica nova (mais dado, mesmo schema) — a cadência anual da ETAPA 2;
 *       · PATCH  → release extraordinário (defeito de dado corrigido), version-DOI próprio (ETAPA 2/D2).
 *   Hoje as duas coincidem em 1.0.0, mas o `release.json` carrega ambas separadamente — um patch de
 *   dado sobe a release sem tocar o schema, e o auditor nunca as confunde.
 *
 * DOIs: o concept-DOI é estável entre versões (o que um paper cita para "o dataset"); cada release
 * ganha um version-DOI próprio. Ambos são cunhados pelo Zenodo na primeira publicação (passo humano,
 * ver `docs/release-runbook.md`); até lá ficam como placeholder marcado.
 */

import {
  DATASET_LICENSE,
  DATASET_SCHEMA_VERSION,
  type EntitySchema,
  ENTITY_SCHEMAS,
} from "./schema.js";
import type { Entidade } from "../scraper/pipeline.js";

// ── Versão/edição do release (bumpar por corte; referida no changelog e no manifesto) ──────────
/** Versão SemVer da EDIÇÃO congelada. Tag = `dataset-v${DATASET_RELEASE_VERSION}`. */
export const DATASET_RELEASE_VERSION = "1.0.0";
/** Rótulo humano da edição (aparece no manifesto e no GitHub Release). */
export const DATASET_RELEASE_EDITION = "Inaugural — bootstrap 2026 (piso 14/06/2026)";

/** Placeholder de DOI até o Zenodo cunhar (ver runbook). Detectável em teste e em revisão. */
export const DOI_PLACEHOLDER = "10.5281/zenodo.PENDENTE";

/** URL canônica dos termos da licença de DADO (separada da licença de código, MIT). */
export const DATASET_LICENSE_URL = "https://www12.senado.leg.br/dados-abertos";

/** Nome/título canônicos do data package (espelham `datapackage.json` da Fase 1.2). */
export const DATASET_NAME = "ecidadania-participacao";
export const DATASET_TITLE = "Dataset de participação do e-Cidadania (Senado Federal)";

// ── SemVer mínimo (sem dependência externa; Workers-safe) ──────────────────────────────────────
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export type Bump = "major" | "minor" | "patch";

/** Valida uma versão SemVer estrita `X.Y.Z` (sem pré-release/metadata). Lança em formato inválido. */
export function validateReleaseVersion(v: string): [number, number, number] {
  const m = SEMVER_RE.exec(v);
  if (!m) throw new Error(`versão de release inválida: "${v}" (esperado SemVer X.Y.Z)`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Próxima versão dado o tipo de bump. Puro; usado pelo runbook/automação para o próximo corte. */
export function nextVersion(current: string, bump: Bump): string {
  const [maj, min, pat] = validateReleaseVersion(current);
  switch (bump) {
    case "major":
      return `${maj + 1}.0.0`;
    case "minor":
      return `${maj}.${min + 1}.0`;
    case "patch":
      return `${maj}.${min}.${pat + 1}`;
  }
}

/** Deriva a versão de release a partir da tag `dataset-v<X.Y.Z>` (usado pelo workflow). */
export function versionFromTag(tag: string): string {
  const prefix = "dataset-v";
  if (!tag.startsWith(prefix)) {
    throw new Error(`tag de release inválida: "${tag}" (esperado ${prefix}<X.Y.Z>)`);
  }
  const v = tag.slice(prefix.length);
  validateReleaseVersion(v);
  return v;
}

// ── Manifesto do release (`release.json`) ───────────────────────────────────────────────────────
/** Um arquivo de dado congelado, com seu checksum canônico (do conteúdo NÃO comprimido). */
export interface ReleaseFile {
  file: string;
  /** SHA-256 hex (minúsculo) do conteúdo do arquivo como está na bundle (canônico, sem gzip). */
  sha256: string;
  bytes: number;
  /** Registros na entidade (NDJSON) — omitido para metadados como datapackage.json/dictionary.md. */
  records?: number;
}

export interface ReleaseManifestInput {
  releaseVersion: string;
  edition: string;
  schemaVersion: string;
  conceptDoi: string;
  versionDoi: string;
  /** SHA do commit que produziu o corte (freeze reproduzível ⇒ commit + build determinístico). */
  gitCommit: string;
  /** ISO-8601 do instante do freeze (injeta-se de fora; scripts não usam Date global). */
  generatedAt: string;
  files: ReleaseFile[];
}

/**
 * Monta o `release.json` — o cartão de identidade do congelado. Ordem de chaves fixa (contrato
 * estável/diffável). NÃO inclui a si mesmo nem o `SHA256SUMS` na lista `files` (evita circularidade
 * de checksum); esses dois são metadados do release, não dado. Os `caveats` vêm do próprio esquema
 * já documentado, então o manifesto nunca contradiz o dicionário.
 */
export function buildReleaseManifest(input: ReleaseManifestInput): Record<string, unknown> {
  validateReleaseVersion(input.releaseVersion);
  validateReleaseVersion(input.schemaVersion);
  const totalRecords = input.files.reduce((n, f) => n + (f.records ?? 0), 0);
  return {
    name: DATASET_NAME,
    title: DATASET_TITLE,
    releaseVersion: input.releaseVersion,
    edition: input.edition,
    schemaVersion: input.schemaVersion,
    conceptDoi: input.conceptDoi,
    versionDoi: input.versionDoi,
    license: DATASET_LICENSE,
    licenseUrl: DATASET_LICENSE_URL,
    source:
      "Senado Federal — Portal e-Cidadania (www12.senado.leg.br/ecidadania) + acervo Arquimedes",
    gitCommit: input.gitCommit,
    generatedAt: input.generatedAt,
    envelope: ["value", "sourceEndpoint", "sourceField", "retrievedAt", "license", "schemaVersion"],
    totalRecords,
    files: input.files.map((f) => ({
      file: f.file,
      sha256: f.sha256,
      bytes: f.bytes,
      ...(f.records != null ? { records: f.records } : {}),
    })),
    changelog: "CHANGELOG-dataset.md",
    citation: "CITATION.cff",
    caveats: RELEASE_CAVEATS,
  };
}

/** Caveats canônicos do release (mesma substância do dicionário/manifesto da Fase 1.2). */
export const RELEASE_CAVEATS: string[] = [
  "Piso duro da série = 14/06/2026 (criação da base D1); nada anterior é capturável.",
  "firstSeenAt é censurado à esquerda, baseline por entidade (consultas 16/06/2026; ideias/eventos 29/06/2026) — o vintage de baseline deve ser excluído de análises de ritmo; série interpretável a partir de 22/06/2026 (consultas) / 30/06/2026 (ideias, eventos).",
  "Antes da entrada em produção do cron diário, a resolução do first-seen foi IRREGULAR (gaps de 2–6 dias): a série é interpretável, não uniforme, no período de bootstrap — ver CHANGELOG-dataset.md.",
  "consultas_votos é acervo de vintage único (série = 1); único campo temporal = referencePeriod.",
  "Não existe data de abertura de consulta upstream (Recon Parte II).",
  "Status de eventos dobra REGISTRADO/'sem data prevista' em 'agendado' (Recon §4.1) — declarado, não corrigido.",
  "eventos: comentarios/hora/data são só-listagem, com caveat PROVISÓRIO (A3) até o estudo de reconciliação listagem×detalhe.",
  "CSV Arquimedes transcodificado de windows-1252 para UTF-8 na leitura.",
];

// ── SHA256SUMS (formato coreutils: `<hash>  <arquivo>`) ─────────────────────────────────────────
/**
 * Serializa o arquivo `SHA256SUMS` no formato do coreutils (`sha256sum -c` valida). Ordena por nome
 * para saída determinística. Duas hashes separadas do nome por DOIS espaços (modo binário/texto).
 */
export function formatSha256Sums(files: ReleaseFile[]): string {
  return (
    [...files]
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
      .map((f) => `${f.sha256}  ${f.file}`)
      .join("\n") + "\n"
  );
}

// ── Metadados Zenodo (a partir do `.zenodo.json` + o release corrente) ──────────────────────────
/** Forma mínima do `.zenodo.json` que consumimos (o arquivo pode ter mais campos). */
export interface ZenodoJson {
  title?: string;
  description?: string;
  upload_type?: string;
  creators?: Array<{ name: string; orcid?: string; affiliation?: string }>;
  keywords?: string[];
  license?: string;
  access_right?: string;
  notes?: string;
  related_identifiers?: Array<{ identifier: string; relation: string; scheme?: string }>;
}

export interface ZenodoDepositionMetadata {
  metadata: Record<string, unknown>;
}

/**
 * Deriva a `metadata` de uma deposição Zenodo a partir do `.zenodo.json` committado + a versão/DOI
 * do release corrente. PURO: o driver faz o PUT. `version` sempre vem do release (não do arquivo),
 * e o concept-DOI entra como `isVersionOf` em `related_identifiers` quando já existir (após o 1º
 * release), para o Zenodo manter a continuidade de versões sob o mesmo concept.
 */
export function buildZenodoMetadata(
  zj: ZenodoJson,
  release: { version: string; conceptDoi: string },
): ZenodoDepositionMetadata {
  validateReleaseVersion(release.version);
  const related = [...(zj.related_identifiers ?? [])];
  const hasConcept =
    release.conceptDoi &&
    release.conceptDoi !== DOI_PLACEHOLDER &&
    !related.some((r) => r.relation === "isVersionOf");
  if (hasConcept) {
    related.push({ identifier: release.conceptDoi, relation: "isVersionOf", scheme: "doi" });
  }
  return {
    metadata: {
      upload_type: zj.upload_type ?? "dataset",
      title: zj.title ?? DATASET_TITLE,
      description: zj.description ?? DATASET_TITLE,
      creators: (zj.creators ?? []).map((c) => ({
        name: c.name,
        ...(c.orcid ? { orcid: c.orcid } : {}),
        ...(c.affiliation ? { affiliation: c.affiliation } : {}),
      })),
      version: release.version,
      access_right: zj.access_right ?? "open",
      ...(zj.license ? { license: zj.license } : {}),
      ...(zj.keywords ? { keywords: zj.keywords } : {}),
      ...(zj.notes ? { notes: zj.notes } : {}),
      ...(related.length ? { related_identifiers: related } : {}),
    },
  };
}

// ── Reexports de conveniência para o driver ─────────────────────────────────────────────────────
export { DATASET_LICENSE, DATASET_SCHEMA_VERSION };
export const ENTITY_TITLES: Record<Entidade, string> = Object.fromEntries(
  (Object.keys(ENTITY_SCHEMAS) as Entidade[]).map((e) => [e, (ENTITY_SCHEMAS[e] as EntitySchema).titulo]),
) as Record<Entidade, string>;
