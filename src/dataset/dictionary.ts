/**
 * Gerador do DICIONÁRIO DE VARIÁVEIS do dataset (Fase 1.2, sessão C1).
 *
 * Deriva o dicionário inteiramente de `ENTITY_SCHEMAS` (`schema.ts`) — fonte única — para que o
 * documento nunca divirja do que o pipeline realmente emite. Puro (retorna string); o driver
 * off-Worker escreve o resultado no data package, e `npm run dataset:dictionary` grava a versão
 * committada em `docs/dataset-dictionary.md`.
 */

import {
  DATASET_LICENSE,
  DATASET_SCHEMA_VERSION,
  ENTITY_SCHEMAS,
  type EntitySchema,
  type VariableDef,
} from "./schema.js";
import type { Entidade } from "../scraper/pipeline.js";

/** Escapa `|` e quebras de linha para uma célula de tabela Markdown. */
function cell(s: string | undefined): string {
  if (!s) return "—";
  return s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

function variableRow(v: VariableDef): string {
  const tipo = v.unit ? `${v.type} (${v.unit})` : v.type;
  const derived = v.derived ? " ⚙️" : "";
  return `| \`${v.name}\`${derived} | ${cell(tipo)} | ${cell(v.description)} | \`${cell(v.sourceEndpoint)}\` | ${cell(v.sourceField)} | ${cell(v.operationalization)} | ${cell(v.caveat)} |`;
}

function entitySection(entidade: Entidade, schema: EntitySchema): string {
  const lines: string[] = [];
  lines.push(`## \`${entidade}\` — ${schema.titulo}`);
  lines.push("");
  lines.push(`**Fonte:** ${schema.fonteResumo}`);
  lines.push("");
  lines.push("| Variável | Tipo | Descrição | sourceEndpoint | sourceField | Operacionalização | Caveat |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const v of schema.variables) lines.push(variableRow(v));
  lines.push("");
  return lines.join("\n");
}

/** Gera o dicionário de variáveis em Markdown. `generatedAt` é injetado (scripts não usam Date global). */
export function buildDictionaryMarkdown(generatedAt?: string): string {
  const lines: string[] = [];
  lines.push("# Dicionário de variáveis — dataset de participação do e-Cidadania");
  lines.push("");
  lines.push(
    "> **Gerado automaticamente** a partir de `src/dataset/schema.ts` (fonte única). Não editar à mão — " +
      "rode `npm run dataset:dictionary`.",
  );
  lines.push("");
  lines.push(`- **schemaVersion:** \`${DATASET_SCHEMA_VERSION}\``);
  lines.push(`- **Licença do dado:** ${DATASET_LICENSE}`);
  if (generatedAt) lines.push(`- **Gerado em:** ${generatedAt}`);
  lines.push("");
  lines.push("Cada valor no dataset vem embrulhado no envelope de proveniência por campo:");
  lines.push("");
  lines.push("```");
  lines.push("{ value, sourceEndpoint, sourceField, retrievedAt, license, schemaVersion }");
  lines.push("```");
  lines.push("");
  lines.push("`⚙️` marca variáveis **derivadas** (`sourceEndpoint: derived:*`) — computadas em código ou");
  lines.push("observadas do nosso corpus, sem campo upstream discreto (ver convenção abaixo).");
  lines.push("");

  // ── Convenções (o que o revisor de data paper vai perguntar) ──────────────
  lines.push("## Convenções de proveniência");
  lines.push("");
  lines.push(
    "- **`retrievedAt`** = o `scraped_at` da linha do corpus (D1) que produziu o valor, i.e. o instante " +
      "real da extração no upstream — **não** o momento do build/deploy. Campos derivados herdam o mesmo " +
      "`retrievedAt` do registro. Para `consultas.status`, isso é fiel porque a derivação via " +
      "`/processo?tramitando=S` acontece **no mesmo run** do scrape da listagem.",
  );
  lines.push(
    "- **`derived:ecidadania_history`** — variável observada do nosso crawler (ex.: `firstSeenAt`), " +
      "**não** um dado do Senado. Quem audita vê de imediato que a série nasce da nossa observação.",
  );
  lines.push(
    "- **`derived:calculo-local`** — valor computado em código a partir de outros campos do mesmo " +
      "registro (somas, percentuais, URL canônica construída).",
  );
  lines.push(
    "- **Codificação:** a saída é UTF-8. O CSV Arquimedes (`consultas_votos`) é servido em " +
      "**windows-1252** (Latin-1) rotulado como octet-stream; o pipeline o **transcodifica para UTF-8** na " +
      "leitura. Decisão de encoding registrada aqui, não implícita.",
  );
  lines.push(
    "- **Ordenação:** registros ordenados por `entity_id` ascendente e chaves JSON em ordem estável — " +
      "dois runs sobre o mesmo corpus produzem NDJSON byte-idêntico (diff entre vintages = mudança real).",
  );
  lines.push("");

  // ── Caveats de cobertura temporal (Recon) ─────────────────────────────────
  lines.push("## Caveats de cobertura temporal (Recon Partes I e III)");
  lines.push("");
  lines.push(
    "- **Piso duro da série = 14/06/2026** (criação da base D1). Consultas/ideias/eventos encerrados " +
      "antes disso e ausentes da listagem atual **não são capturáveis**.",
  );
  lines.push(
    "- **`firstSeenAt` é censurado à esquerda, com baseline POR ENTIDADE:** consultas = 16/06/2026 " +
      "(98,6% do corpus; série interpretável a partir de **22/06/2026**); ideias = 29/06/2026 (~99,9%; " +
      "a partir de **30/06/2026**); eventos = 29/06/2026 (~99,5%; a partir de **30/06/2026**). O vintage " +
      "de baseline de cada entidade deve ser **excluído** de análises de ritmo de entrada. Resolução " +
      "temporal = cadência do crawl de corpus completo.",
  );
  lines.push(
    "- **Não existe data de abertura de consulta upstream** (Recon Parte II): `dataApresentacao` foi " +
      "reprovado como proxy (enviesado); `firstSeenAt` é o único sinal prospectivo de ritmo.",
  );
  lines.push(
    "- **`consultas_votos` é acervo de vintage único** (profundidade de série = 1): não é série temporal. " +
      "O único campo temporal é `referencePeriod` (carimbo do CSV).",
  );
  lines.push(
    "- **Fidelidade conhecida (não corrigida nesta fase — é dívida de tool, não de dataset):** o status " +
      "de eventos dobra `REGISTRADO`/\"sem data prevista\" em `agendado` (Recon §4.1).",
  );
  lines.push("");

  for (const entidade of Object.keys(ENTITY_SCHEMAS) as Entidade[]) {
    lines.push(entitySection(entidade, ENTITY_SCHEMAS[entidade]));
  }

  return lines.join("\n");
}
