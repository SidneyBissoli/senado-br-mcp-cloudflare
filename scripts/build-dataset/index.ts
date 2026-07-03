/**
 * Build do dataset de participação do e-Cidadania (Fase 1.2, sessão C1) — OFF-Worker.
 *
 * Lê o corpus soberano do D1 (`ecidadania_current` + first-seen do `_history`), harmoniza cada
 * entidade no esquema documentado e emite, num diretório local:
 *   - <entidade>.ndjson   — 1 HarmonizedRecord por linha (envelope de proveniência por campo), UTF-8,
 *                           ordenado por entity_id;
 *   - datapackage.json    — manifesto leve (schemaVersion, entidades, contagens, licença, caveats);
 *   - dictionary.md        — dicionário de variáveis gerado de src/dataset/schema.ts.
 *
 * ESCOPO (Fase 1.2): só harmonização + envelope + dicionário. NÃO congela release, NÃO gera DOI/Zenodo,
 * NÃO empacota Parquet nem sobe pra R2 — isso é a máquina de releases (sessão C2). A saída é NDJSON
 * local, legível e diffável, exatamente o que a ETAPA 4 (validação de proveniência à mão) precisa.
 *
 * Flags:
 *   --entidade <e>       só uma entidade (consultas|ideias|eventos|consultas_votos)
 *   --limit <n>          amostra: só as N primeiras linhas (por entity_id) — para a ETAPA 4
 *   --out <dir>          diretório de saída (default: dataset/<schemaVersion>)
 *   --dictionary-only    só (re)gera o dicionário em <out ou docs/dataset-dictionary.md> e sai
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATASET_SCHEMA_VERSION, DATASET_LICENSE, ENTITY_SCHEMAS } from "../../src/dataset/schema.js";
import { buildDictionaryMarkdown } from "../../src/dataset/dictionary.js";
import { harmonizeEntity, type CorpusRow } from "../../src/dataset/harmonize.js";
import type { HarmonizedRecord } from "../../src/dataset/provenance.js";
import type { Entidade } from "../../src/scraper/pipeline.js";
import { readCurrent, readFirstSeen, countCurrent } from "./d1-read.js";

const ALL_ENTITIES: Entidade[] = ["consultas", "ideias", "eventos", "consultas_votos"];
/** Entidades vivas têm first-seen; consultas_votos é acervo de vintage único (série = 1). */
const LIVE_ENTITIES = new Set<Entidade>(["consultas", "ideias", "eventos"]);

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

function toNdjson(records: HarmonizedRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
}

function main(): void {
  const generatedAt = new Date().toISOString();

  // ── Modo dicionário-só ────────────────────────────────────────────────────
  // O dicionário committado (docs/) é gerado SEM carimbo de tempo, de propósito: assim ele é
  // determinístico e o drift-check da sessão C3 vira um `git diff --exit-code` após regenerar.
  // (A cópia dentro do data package — abaixo — mantém o generatedAt, que ali é informação de vintage.)
  if (hasFlag("dictionary-only")) {
    const out = flag("out") || "docs/dataset-dictionary.md";
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, buildDictionaryMarkdown(), "utf8");
    console.log(`[dataset] dicionário (determinístico) escrito em ${out}`);
    return;
  }

  const only = flag("entidade") as Entidade | undefined;
  if (only && !ALL_ENTITIES.includes(only)) {
    throw new Error(`--entidade inválida: ${only} (use ${ALL_ENTITIES.join("|")})`);
  }
  const entities = only ? [only] : ALL_ENTITIES;
  const limit = flag("limit") ? Number(flag("limit")) : undefined;
  const outDir = flag("out") || join("dataset", DATASET_SCHEMA_VERSION);
  mkdirSync(outDir, { recursive: true });

  const manifestEntities: Array<{
    entidade: Entidade;
    titulo: string;
    file: string;
    recordCount: number;
    corpusTotal: number;
    hasFirstSeen: boolean;
  }> = [];

  for (const entidade of entities) {
    console.log(`[dataset] ${entidade}: lendo corpus…`);
    const rows: CorpusRow[] = readCurrent(entidade, limit);

    if (LIVE_ENTITIES.has(entidade) && rows.length > 0) {
      const ids = limit != null ? rows.map((r) => r.entityId) : undefined;
      const firstSeen = readFirstSeen(entidade, ids);
      for (const r of rows) r.firstSeenAt = firstSeen.get(r.entityId) ?? null;
      console.log(`[dataset] ${entidade}: first-seen resolvido p/ ${firstSeen.size} ids`);
    }

    const records = harmonizeEntity(entidade, rows);
    const file = `${entidade}.ndjson`;
    writeFileSync(join(outDir, file), toNdjson(records), "utf8");
    const corpusTotal = limit != null ? countCurrent(entidade) : records.length;
    console.log(`[dataset] ${entidade}: ${records.length} registros → ${file}` + (limit != null ? ` (amostra de ${corpusTotal})` : ""));

    manifestEntities.push({
      entidade,
      titulo: ENTITY_SCHEMAS[entidade].titulo,
      file,
      recordCount: records.length,
      corpusTotal,
      hasFirstSeen: LIVE_ENTITIES.has(entidade),
    });
  }

  // ── Manifesto + dicionário ──────────────────────────────────────────────────
  const manifest = {
    name: "ecidadania-participacao",
    title: "Dataset de participação do e-Cidadania (Senado Federal)",
    schemaVersion: DATASET_SCHEMA_VERSION,
    license: DATASET_LICENSE,
    source: "Senado Federal — Portal e-Cidadania (www12.senado.leg.br/ecidadania) + acervo Arquimedes",
    generatedAt,
    sample: limit != null ? { limit } : null,
    envelope: ["value", "sourceEndpoint", "sourceField", "retrievedAt", "license", "schemaVersion"],
    entities: manifestEntities,
    caveats: [
      "Piso duro da série = 14/06/2026 (criação da base D1).",
      "firstSeenAt censurado à esquerda, baseline por entidade: consultas 16/06/2026 (98,6%; série interpretável a partir de 22/06/2026), ideias 29/06/2026 (~99,9%; a partir de 30/06/2026), eventos 29/06/2026 (~99,5%; a partir de 30/06/2026); o vintage de baseline deve ser excluído de análises de ritmo.",
      "consultas_votos é acervo de vintage único (série = 1); único campo temporal = referencePeriod.",
      "Não existe data de abertura de consulta upstream (Recon Parte II).",
      "Status de eventos dobra REGISTRADO/'sem data prevista' em 'agendado' (Recon §4.1) — declarado, não corrigido.",
      "CSV Arquimedes transcodificado de windows-1252 para UTF-8 na leitura.",
    ],
  };
  writeFileSync(join(outDir, "datapackage.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  writeFileSync(join(outDir, "dictionary.md"), buildDictionaryMarkdown(generatedAt), "utf8");
  console.log(`[dataset] manifesto + dicionário escritos em ${outDir}`);
}

main();
