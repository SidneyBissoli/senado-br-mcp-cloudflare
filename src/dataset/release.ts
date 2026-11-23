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
 *   O `release.json` carrega ambas separadamente — um patch de dado sobe a release sem tocar o
 *   schema, e o auditor nunca as confunde. Exceção registrada: o esquema 2.0.0 nunca saiu em release,
 *   e o corte do esquema 3.0.0 leva a release 3.0.0 (decisão do dono de 22/11/2026: o mesmo número
 *   do esquema, contra um dataset-v2.0.0 que um leitor tomaria pelo esquema 2.0.0).
 *
 * Desde o 3.0.0 o release congela o pacote da camada 3 (`scripts/publicacao/empacotar.ts`): só
 * Parquet, `datapackage.json` Frictionless e `dicionario.md`. O envelope por célula do 1.0.0/2.0.0
 * acabou; a proveniência vai em colunas de origem por bloco.
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
export const DATASET_RELEASE_VERSION = "3.0.0";
/** Rótulo humano da edição (aparece no manifesto e no GitHub Release). */
export const DATASET_RELEASE_EDITION = "Anual 2026 — esquema 3.0.0 (tabelas tidy em Parquet)";

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
  /** Linhas da tabela (Parquet) — omitido para metadados como datapackage.json/dicionario.md. */
  records?: number;
  /** Identidade do insumo de uma tabela (só tabelas): de onde, de que versão do código e até onde. */
  origem?: OrigemDaTabela;
}

/**
 * De onde a tabela saiu. O empacotador copia os bytes do balde sem alteração, então o `sha256` do
 * arquivo É o do objeto `chave` no balde; `leitor` + `cursor` (metadados gravados no próprio Parquet
 * pelo job das observações) dizem com que versão do código e até qual registro do arquivo de páginas
 * a tabela foi montada — o que permite refazê-la a partir do arquivo bruto (privado).
 */
export interface OrigemDaTabela {
  balde: string;
  chave: string;
  leitor: string;
  cursor: number;
  geradoEm: string;
  /** Demais metadados do Parquet (ex.: versões do corpus usadas nas séries), como gravados. */
  extras?: Record<string, string>;
}

/**
 * Lê a origem dos metadados chave-valor de um Parquet publicado. Lança se faltar leitor, cursor ou
 * geradoEm: tabela sem identidade de insumo não entra num release congelado.
 */
export function origemDosMetadados(balde: string, chave: string, kv: Record<string, string>): OrigemDaTabela {
  const { leitor, cursor, geradoEm, entidade: _entidade, ...resto } = kv;
  const n = Number(cursor);
  if (!leitor || !Number.isInteger(n) || n < 0 || !geradoEm || Number.isNaN(Date.parse(geradoEm))) {
    throw new Error(`${chave}: Parquet sem identidade do insumo (leitor="${leitor ?? ""}", cursor="${cursor ?? ""}", geradoEm="${geradoEm ?? ""}")`);
  }
  return { balde, chave, leitor, cursor: n, geradoEm, ...(Object.keys(resto).length ? { extras: resto } : {}) };
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
    format: "parquet",
    dictionary: "dicionario.md",
    totalRecords,
    files: input.files.map((f) => ({
      file: f.file,
      sha256: f.sha256,
      bytes: f.bytes,
      ...(f.records != null ? { records: f.records } : {}),
      ...(f.origem ? { origem: f.origem } : {}),
    })),
    origemNota: NOTA_DA_ORIGEM,
    changelog: "CHANGELOG-dataset.md",
    citation: "CITATION.cff",
    caveats: RELEASE_CAVEATS,
  };
}

/** Como ler `files[].origem` no `release.json`. */
export const NOTA_DA_ORIGEM =
  "Cada tabela foi copiada byte a byte do objeto `origem.chave` no balde `origem.balde`: o sha256 do arquivo é o do objeto. " +
  "`origem.leitor` (versão do código que montou a tabela) e `origem.cursor` (último registro do arquivo de páginas incluído) " +
  "identificam o insumo: com os dois, a tabela pode ser refeita a partir do arquivo de páginas, que é privado. " +
  "`origem.extras` traz os demais metadados gravados no próprio Parquet.";

/**
 * Caveats canônicos do release do esquema 3.0.0 — a mesma substância das notas do dicionário
 * (`scripts/publicacao/dicionario.ts`), resumida para o manifesto; o detalhe fica no `dicionario.md`.
 */
export const RELEASE_CAVEATS: string[] = [
  "Piso duro da série = 14/06/2026 (criação do corpus); nada anterior é capturável.",
  "As datas de primeira observação são do robô, não do Senado, e censuradas à esquerda: a primeira varredura completa de cada entidade (16/06/2026 consultas; 29/06/2026 ideias e eventos) marca quase todo o acervo antigo — exclua essas datas de análises de ritmo de entrada.",
  "Cada linha diz, por bloco de página, de onde veio o valor (origem: arquivo de páginas ou corpus) e quando a página foi lida (coletadoEm). O arquivo de páginas começa em 30/10/2026 nas ideias e em 20/11/2026 nas demais entidades; antes disso, e para o que saiu da listagem, vale o último valor que o corpus guardou.",
  "Séries no tempo (apoios, situação, votos): entre `desde` e `ate` o valor foi visto em todas as leituras daquela série; fora delas, nada se afirma. No corpus, um ponto por mudança (`desde = ate`).",
  "Série de apoios das ideias, origem corpus: antes de 18/10/2026, apoios = 0 pode ser contagem AUSENTE lida como 0; a origem do arquivo de páginas (desde 30/10/2026) não tem essa ambiguidade.",
  "autorNome é o nome do autor da ideia como o portal o publica (já abreviado); null quando o detalhe da ideia ainda vem do corpus, que nunca guardou o nome, ou quando o titular pediu a omissão. Comentaristas de eventos seguem sem nome. Finalidade, limites de reúso e direitos do titular (LGPD): seção \"Dado pessoal\" do dicionario.md.",
  "Não existe data de abertura de consulta upstream (Recon Parte II).",
  "Status de eventos dobra REGISTRADO/'sem data prevista' em 'agendado' (Recon §4.1) — declarado, não corrigido.",
  "O acervo Arquimedes (votos por UF) é publicado em windows-1252; aqui está em UTF-8.",
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

// ── DOIs reservados ANTES do freeze ─────────────────────────────────────────────────────────────
/** Os dois DOIs de um corte: o concept (estável entre versões) e o desta versão. */
export interface DoisDoRelease {
  conceptDoi: string;
  versionDoi: string;
}

/** Forma mínima da deposição Zenodo de que os DOIs se derivam. */
export interface DeposicaoComDois {
  conceptdoi?: string;
  conceptrecid?: string;
  metadata?: { prereserve_doi?: { doi?: string } };
}

const DOI_RE = /^10\.\d{4,}\/\S+$/;
/** DOI com forma válida e que não é o placeholder (que tem forma de DOI). */
const doiReal = (doi: string): boolean => DOI_RE.test(doi) && doi !== DOI_PLACEHOLDER;

/**
 * Deriva os DOIs de um rascunho Zenodo ainda não publicado. O version-DOI é o reservado
 * (`prereserve_doi`); o concept-DOI vem da deposição ou, no 1º release (concept ainda sem DOI
 * cunhado), de `conceptrecid` sob o mesmo prefixo do version-DOI. Lança se faltar algum: o freeze
 * NÃO pode seguir com placeholder quando o Zenodo está ligado — o `release.json` de um release
 * publicado é imutável (dataset-v1.0.0 saiu com "PENDENTE" porque os DOIs vinham depois).
 */
export function doisDaDeposicao(dep: DeposicaoComDois): DoisDoRelease {
  const versionDoi = dep.metadata?.prereserve_doi?.doi ?? "";
  if (!doiReal(versionDoi)) {
    throw new Error(`deposição sem version-DOI reservado válido (prereserve_doi="${versionDoi}").`);
  }
  let conceptDoi = dep.conceptdoi ?? "";
  if (!conceptDoi && dep.conceptrecid) {
    conceptDoi = `${versionDoi.slice(0, versionDoi.lastIndexOf("."))}.${dep.conceptrecid}`;
  }
  if (!doiReal(conceptDoi)) {
    throw new Error(`deposição sem concept-DOI derivável (conceptdoi="${dep.conceptdoi ?? ""}", conceptrecid="${dep.conceptrecid ?? ""}").`);
  }
  return { conceptDoi, versionDoi };
}

/**
 * Confere que um `release.json` leva exatamente os DOIs reservados da deposição para onde vai.
 * Devolve a lista de problemas (vazia = confere). Trava do envio: um manifesto congelado antes da
 * reserva, ou de outra deposição, não sobe.
 */
export function conferirDoisDoManifesto(
  manifest: { conceptDoi?: unknown; versionDoi?: unknown },
  dois: DoisDoRelease,
): string[] {
  const problemas: string[] = [];
  for (const campo of ["conceptDoi", "versionDoi"] as const) {
    if (manifest[campo] !== dois[campo]) {
      problemas.push(`${campo} do release.json = "${String(manifest[campo])}", reservado = "${dois[campo]}"`);
    }
  }
  return problemas;
}

// ── Arquivos soltos no Zenodo ───────────────────────────────────────────────────────────────────
/** Limite do Zenodo por registro (help.zenodo.org, "Manage files", conferido em 22/11/2026). */
export const ZENODO_MAX_ARQUIVOS = 100;

/**
 * Confere a lista de nomes que vai ao rascunho do Zenodo (que não guarda pastas: o nome enviado é o
 * nome final). Devolve os problemas (vazia = confere): nome repetido (um sobrescreveria o outro), nome
 * com pasta, acima do limite de arquivos, ou sem o `datapackage.json`/`SHA256SUMS` que tornam os
 * arquivos soltos utilizáveis e verificáveis.
 */
export function conferirArquivosDoEnvio(nomes: readonly string[]): string[] {
  const problemas: string[] = [];
  const vistos = new Set<string>();
  for (const n of nomes) {
    if (/[/\\]/.test(n)) problemas.push(`nome com pasta: ${n}`);
    if (vistos.has(n)) problemas.push(`nome repetido: ${n}`);
    vistos.add(n);
  }
  if (nomes.length > ZENODO_MAX_ARQUIVOS) problemas.push(`${nomes.length} arquivos > limite do Zenodo (${ZENODO_MAX_ARQUIVOS})`);
  for (const obrigatorio of ["release.json", "SHA256SUMS", "datapackage.json"]) {
    if (!vistos.has(obrigatorio)) problemas.push(`falta ${obrigatorio}`);
  }
  return problemas;
}

// ── CITATION.cff do corte ───────────────────────────────────────────────────────────────────────
/**
 * Reescreve o `CITATION.cff` da raiz para a cópia que vai DENTRO do pacote: `version`, `date-released`
 * e o identificador do version-DOI passam a ser os deste corte (o da raiz descreve o último release
 * publicado, e o version-DOI deste só existe durante o workflow). Com DOI em placeholder, o
 * identificador do version-DOI sai (nunca vai um DOI de outra versão). Lança se o arquivo perder as
 * linhas que reescreve — o corte não segue com citação de outra versão.
 */
export function citacaoDoCorte(cff: string, corte: { version: string; versionDoi: string; date: string }): string {
  validateReleaseVersion(corte.version);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(corte.date)) throw new Error(`data do corte inválida: "${corte.date}"`);
  const versao = /^version: .*$/m;
  const data = /^date-released: .*$/m;
  // O bloco do version-DOI: `- type: doi` + `value` + `description: Version-DOI …`, no fim de `identifiers`.
  const bloco = /^ {2}- type: doi\n {4}value: "[^"]*"\n {4}description: Version-DOI[^\n]*\n?/m;
  if (!versao.test(cff) || !data.test(cff) || !bloco.test(cff)) {
    throw new Error("CITATION.cff sem `version`, `date-released` ou o identificador do version-DOI");
  }
  const novoBloco = doiReal(corte.versionDoi)
    ? `  - type: doi\n    value: "${corte.versionDoi}"\n    description: Version-DOI (dataset-v${corte.version}, snapshot de ${corte.date})\n`
    : "";
  return cff
    .replace(versao, `version: ${corte.version}`)
    .replace(data, `date-released: "${corte.date}"`)
    .replace(bloco, novoBloco);
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
