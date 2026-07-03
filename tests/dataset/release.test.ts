import { describe, it, expect } from "vitest";
import {
  DATASET_RELEASE_VERSION,
  DOI_PLACEHOLDER,
  buildReleaseManifest,
  buildZenodoMetadata,
  formatSha256Sums,
  nextVersion,
  validateReleaseVersion,
  versionFromTag,
  type ReleaseFile,
} from "../../src/dataset/release.js";
import { DATASET_SCHEMA_VERSION } from "../../src/dataset/schema.js";

describe("validateReleaseVersion", () => {
  it("aceita SemVer estrito X.Y.Z", () => {
    expect(validateReleaseVersion("1.0.0")).toEqual([1, 0, 0]);
    expect(validateReleaseVersion("12.3.45")).toEqual([12, 3, 45]);
  });
  it("rejeita formatos não-estritos", () => {
    for (const bad of ["1.0", "v1.0.0", "1.0.0-rc1", "1.0.0.0", "", "abc"]) {
      expect(() => validateReleaseVersion(bad)).toThrow();
    }
  });
});

describe("nextVersion", () => {
  it("bumpa major/minor/patch conforme a convenção", () => {
    expect(nextVersion("1.2.3", "major")).toBe("2.0.0");
    expect(nextVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(nextVersion("1.2.3", "patch")).toBe("1.2.4");
  });
});

describe("versionFromTag", () => {
  it("extrai a versão da tag dataset-v<X.Y.Z>", () => {
    expect(versionFromTag("dataset-v1.0.0")).toBe("1.0.0");
  });
  it("rejeita tags sem o prefixo ou com versão inválida", () => {
    expect(() => versionFromTag("v1.0.0")).toThrow();
    expect(() => versionFromTag("dataset-v1.0")).toThrow();
  });
});

describe("buildReleaseManifest", () => {
  const files: ReleaseFile[] = [
    { file: "consultas.ndjson", sha256: "aa", bytes: 10, records: 3 },
    { file: "datapackage.json", sha256: "bb", bytes: 5 },
  ];
  const manifest = buildReleaseManifest({
    releaseVersion: "1.0.0",
    edition: "Inaugural",
    schemaVersion: DATASET_SCHEMA_VERSION,
    conceptDoi: DOI_PLACEHOLDER,
    versionDoi: DOI_PLACEHOLDER,
    gitCommit: "deadbeef",
    generatedAt: "2026-07-03T00:00:00.000Z",
    files,
  });

  it("mantém as duas versões separadas e o commit/geração", () => {
    expect(manifest.releaseVersion).toBe("1.0.0");
    expect(manifest.schemaVersion).toBe(DATASET_SCHEMA_VERSION);
    expect(manifest.gitCommit).toBe("deadbeef");
    expect(manifest.generatedAt).toBe("2026-07-03T00:00:00.000Z");
  });

  it("soma totalRecords só dos arquivos com records", () => {
    expect(manifest.totalRecords).toBe(3);
  });

  it("preserva o envelope de 6 campos e os caveats", () => {
    expect(manifest.envelope).toEqual([
      "value",
      "sourceEndpoint",
      "sourceField",
      "retrievedAt",
      "license",
      "schemaVersion",
    ]);
    expect(Array.isArray(manifest.caveats)).toBe(true);
    expect((manifest.caveats as string[]).join(" ")).toMatch(/14\/06\/2026/);
    // A declaração load-bearing do bootstrap irregular tem de estar no manifesto.
    expect((manifest.caveats as string[]).join(" ")).toMatch(/IRREGULAR/i);
  });

  it("é determinístico e diffável (ordem de chaves estável)", () => {
    const again = buildReleaseManifest({
      releaseVersion: "1.0.0",
      edition: "Inaugural",
      schemaVersion: DATASET_SCHEMA_VERSION,
      conceptDoi: DOI_PLACEHOLDER,
      versionDoi: DOI_PLACEHOLDER,
      gitCommit: "deadbeef",
      generatedAt: "2026-07-03T00:00:00.000Z",
      files,
    });
    expect(JSON.stringify(manifest)).toBe(JSON.stringify(again));
  });

  it("rejeita versão de release inválida", () => {
    expect(() =>
      buildReleaseManifest({
        releaseVersion: "1.0",
        edition: "x",
        schemaVersion: DATASET_SCHEMA_VERSION,
        conceptDoi: DOI_PLACEHOLDER,
        versionDoi: DOI_PLACEHOLDER,
        gitCommit: "x",
        generatedAt: "x",
        files: [],
      }),
    ).toThrow();
  });
});

describe("formatSha256Sums", () => {
  it("emite formato coreutils, ordenado por nome, com dois espaços", () => {
    const out = formatSha256Sums([
      { file: "b.ndjson", sha256: "22", bytes: 1 },
      { file: "a.ndjson", sha256: "11", bytes: 1 },
    ]);
    expect(out).toBe("11  a.ndjson\n22  b.ndjson\n");
  });
});

describe("buildZenodoMetadata", () => {
  const zj = {
    title: "T",
    description: "D",
    creators: [{ name: "Bissoli, Sidney", orcid: "0000-0000-0000-0000", affiliation: "Independent researcher" }],
    keywords: ["e-Cidadania"],
  };

  it("usa a versão do release e mapeia creators", () => {
    const m = buildZenodoMetadata(zj, { version: "1.2.0", conceptDoi: DOI_PLACEHOLDER });
    expect((m.metadata as { version: string }).version).toBe("1.2.0");
    const creators = (m.metadata as { creators: Array<Record<string, string>> }).creators;
    expect(creators[0]).toMatchObject({ name: "Bissoli, Sidney", orcid: "0000-0000-0000-0000" });
  });

  it("NÃO adiciona isVersionOf quando o concept-DOI é placeholder", () => {
    const m = buildZenodoMetadata(zj, { version: "1.0.0", conceptDoi: DOI_PLACEHOLDER });
    expect((m.metadata as Record<string, unknown>).related_identifiers).toBeUndefined();
  });

  it("adiciona isVersionOf quando o concept-DOI é real", () => {
    const m = buildZenodoMetadata(zj, { version: "1.1.0", conceptDoi: "10.5281/zenodo.123" });
    const rel = (m.metadata as { related_identifiers: Array<Record<string, string>> }).related_identifiers;
    expect(rel).toContainEqual({ identifier: "10.5281/zenodo.123", relation: "isVersionOf", scheme: "doi" });
  });

  it("default upload_type=dataset e access_right=open", () => {
    const m = buildZenodoMetadata({}, { version: "1.0.0", conceptDoi: DOI_PLACEHOLDER });
    expect(m.metadata).toMatchObject({ upload_type: "dataset", access_right: "open" });
  });
});

describe("constantes de release", () => {
  it("DATASET_RELEASE_VERSION é SemVer válido", () => {
    expect(() => validateReleaseVersion(DATASET_RELEASE_VERSION)).not.toThrow();
  });
});
