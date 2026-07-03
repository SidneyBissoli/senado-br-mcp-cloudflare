# Pipeline de harmonização do dataset e-Cidadania (Fase 1.2)

Camada que transforma o **corpus soberano** (D1) no **dataset de participação** citável — o ativo
científico do projeto (ROADMAP CIENTÍFICO, sessão C1). Cada variável de cada registro sai embrulhada
no **envelope de proveniência por campo**:

```
{ value, sourceEndpoint, sourceField, retrievedAt, license, schemaVersion }
```

> **Escopo (Fase 1.2):** só harmonização + envelope + dicionário + `schemaVersion` por registro. **Não**
> congela release, **não** gera DOI/Zenodo, **não** empacota Parquet nem sobe pra R2 — isso é a máquina
> de releases (sessão C2), que **consome** este pipeline sem reescrevê-lo.

## Arquitetura

Núcleo **puro** em `src/dataset/` (Node- e Worker-safe; não é importado por `src/index.ts`, some do
bundle do Worker) + **driver off-Worker** em `scripts/build-dataset/` (I/O de D1 via `wrangler`).

| Arquivo | Papel |
|---|---|
| `src/dataset/schema.ts` | **Fonte única.** `DATASET_SCHEMA_VERSION`, `DATASET_LICENSE` e, por variável, tipo + descrição + `sourceEndpoint`/`sourceField`/operacionalização/caveat. Alimenta o envelope **e** o dicionário. |
| `src/dataset/provenance.ts` | Envelope de 6 campos (ordem fixa) + `assembleRecord` (percorre o esquema na ordem declarada). |
| `src/dataset/harmonize.ts` | `harmonizeRow` / `harmonizeEntity` (puros; ordena por `entity_id`). |
| `src/dataset/dictionary.ts` | `buildDictionaryMarkdown()` — gera o dicionário a partir do esquema. |
| `scripts/build-dataset/d1-read.ts` | Leitura paginada do D1 (`ORDER BY entity_id` obrigatório) + first-seen. |
| `scripts/build-dataset/index.ts` | Orquestra: lê D1 → harmoniza → emite NDJSON + `datapackage.json` + `dictionary.md`. |

## Convenções (o que a ETAPA 4 e um revisor de data paper conferem)

- **`sourceField` aponta para o campo UPSTREAM verdadeiro** (seletor HTML, coluna do CSV, parâmetro
  GET) — não para o payload já normalizado. É isso que a **ETAPA 4** valida à mão.
- **`retrievedAt`** = `scraped_at` da linha do corpus que produziu o valor (instante real da extração,
  não o build). Campos derivados herdam o mesmo `retrievedAt`; para `consultas.status` isso é fiel
  porque a derivação via `/processo?tramitando=S` ocorre **no mesmo run** do scrape.
- **`derived:` para variáveis sem fonte upstream discreta** (honestidade de proveniência):
  `derived:ecidadania_history` (observação do crawler, ex.: `firstSeenAt`) e `derived:calculo-local`
  (soma/percentual/URL construída). Variáveis transformadas mas com fonte upstream (ex.: `status`)
  mantêm o endpoint real e anotam a derivação no `sourceField`.
- **Determinismo:** saída UTF-8, registros por `entity_id` e chaves JSON estáveis ⇒ dois runs sobre o
  mesmo corpus produzem NDJSON byte-idêntico (diff entre vintages = mudança real). O CSV Arquimedes é
  transcodificado de **windows-1252 → UTF-8** na leitura (declarado no dicionário).

Caveats de cobertura temporal (piso 14/06/2026, censura à esquerda do `firstSeenAt`, `consultas_votos`
como acervo de vintage único) estão no `docs/dataset-dictionary.md` e no `datapackage.json`.

## Uso

```bash
# (re)gera o dicionário committado — não precisa de D1:
npm run dataset:dictionary                       # → docs/dataset-dictionary.md

# build completo do dataset (precisa de CLOUDFLARE_API_TOKEN para ler o D1 remoto):
npm run build:dataset                            # → dataset/<schemaVersion>/{*.ndjson, datapackage.json, dictionary.md}

# amostra para a validação à mão da ETAPA 4:
npm run build:dataset -- --entidade consultas --limit 50
```

Flags do `build:dataset`: `--entidade <e>`, `--limit <n>` (amostra), `--out <dir>`, `--dictionary-only`.
O diretório `dataset/` de saída é artefato de build (não versionar; o congelamento é da sessão C2).

`docs/dataset-dictionary.md` é **committado e determinístico** (gerado sem carimbo de tempo). O
**drift-check** (garantir que o dicionário committado não divergiu de `schema.ts`) fica para a **sessão
C3** (Fase 2.1): basta `npm run dataset:dictionary && git diff --exit-code docs/dataset-dictionary.md`.

## Saída

- `<entidade>.ndjson` — um `HarmonizedRecord` por linha: `{ entidade, entityId, fields: { <var>: envelope } }`.
- `datapackage.json` — manifesto leve: `schemaVersion`, licença, `generatedAt`, contagens por entidade,
  os 6 campos do envelope e os caveats.
- `dictionary.md` — cópia do dicionário de variáveis gerado do esquema.

## Testes

`tests/dataset/` (puros, sem rede/D1): forma do envelope (6 campos), `sourceField`/`sourceEndpoint`
corretos por entidade, convenção `derived:`, ordenação determinística, `consultas_votos` sem
`firstSeenAt` e com `referencePeriod`, e cobertura de 100% das variáveis no dicionário.
