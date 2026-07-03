# Changelog — dataset de participação do e-Cidadania

Changelog do **DADO** (separado do [`CHANGELOG.md`](CHANGELOG.md), que é do código/servidor MCP).
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); o dataset segue
[Versionamento Semântico](https://semver.org/lang/pt-BR/) **próprio** (`dataset-v<X.Y.Z>`), distinto
da versão do pacote npm/servidor.

O dado é **append-only**: releases não reescrevem valores publicados — corrigem via nova versão. Cada
entrada amarra a **versão de schema** (`schemaVersion`) vigente e aponta o **version-DOI** do Zenodo.

Convenção de bump (ver `src/dataset/release.ts`):
- **MAJOR** — mudança de schema (`schemaVersion` sobe junto);
- **MINOR** — edição periódica nova (mais dado, mesmo schema) — a cadência **anual** decidida na ETAPA 2;
- **PATCH** — release extraordinário (defeito de dado corrigido), com version-DOI próprio.

O **concept-DOI** (Zenodo) é estável entre versões — é o que um paper cita para "o dataset". Cada
release tem também seu **version-DOI**. Enquanto o Zenodo não cunha, os campos aparecem como
`10.5281/zenodo.PENDENTE` (ver `docs/release-runbook.md`).

---

## [dataset-v1.0.0] — 2026-07 · Inaugural (bootstrap 2026)

- **schemaVersion:** `1.0.0`
- **concept-DOI:** `10.5281/zenodo.PENDENTE` · **version-DOI:** `10.5281/zenodo.PENDENTE`
- **Licença do dado:** Dados Abertos do Senado Federal — uso livre com atribuição da fonte
  (ver [`LICENSE-DATA.md`](LICENSE-DATA.md); separada da licença de código, MIT).

### Adicionado (primeiro corte congelado)

Corpus completo da camada de participação do e-Cidadania, num único data package, com **envelope de
proveniência por campo** (`{ value, sourceEndpoint, sourceField, retrievedAt, license, schemaVersion }`)
em cada valor de cada registro:

| Entidade | Registros | Série temporal |
|---|--:|---|
| `consultas` — Consultas públicas (Apoie) | 7.773 | first-seen (censurada à esquerda) |
| `ideias` — Ideias legislativas | 113.704 | first-seen (censurada à esquerda) |
| `eventos` — Eventos interativos (audiências) | 5.443 | first-seen (censurada à esquerda) |
| `consultas_votos` — Votos históricos por UF (acervo Arquimedes) | 15.085 | **vintage único** (série = 1) |

Dicionário de variáveis, operacionalização e proveniência campo-a-campo em
[`docs/dataset-dictionary.md`](docs/dataset-dictionary.md) (gerado da fonte única `src/dataset/schema.ts`).
Pipeline de harmonização documentado em [`docs/dataset-harmonization.md`](docs/dataset-harmonization.md).

### Resolução temporal do first-seen no bootstrap — **declaração load-bearing**

A série oficial de ritmo de entrada é o `firstSeenAt` = `MIN(scraped_at)` por registro
(`ecidadania_history`; Recon Parte III). **Antes da entrada em produção do cron de crawl diário**
(`ingest-ecidadania.yml`, `cron: 0 5 * * *`), a resolução do first-seen foi **irregular**: o corpus
completo era varrido em intervalos de **2 a 6 dias**, então o first-seen de um registro tem a
granularidade do dia em que aquele crawl completo rodou, não do dia real de entrada. Consequências,
que **fazem parte do contrato metodológico** deste release:

- **Piso duro da série = 14/06/2026** (criação da base D1). Nada encerrado e ausente da listagem atual
  antes disso é capturável.
- **Censura à esquerda, baseline por entidade:** o primeiro crawl completo de cada entidade concentra
  a grande maioria dos first-seen num único vintage de baseline, que **deve ser excluído** de análises
  de ritmo — `consultas` 16/06/2026 (98,6%; série interpretável a partir de **22/06/2026**);
  `ideias` 29/06/2026 (~99,9%; a partir de **30/06/2026**); `eventos` 29/06/2026 (~99,5%; a partir de
  **30/06/2026**).
- **Período de bootstrap (irregular):** entre o piso e a estabilização do cron diário, a série é
  **interpretável mas não uniforme** — trate a resolução como "dia do crawl", não "dia da entrada".
  A partir da produção do cron diário a resolução passa a ser de **1 dia**.
- **Falhas de crawl** (`erro` em `ecidadania_scrape_runs`) são **lacunas conhecidas** da série, nunca
  silenciadas.

### Caveats de dado herdados da harmonização (ETAPA 4 — validação de proveniência APROVADA 👤)

- **`consultas_votos` é acervo de vintage único** (profundidade de série = 1): não é série temporal;
  o único campo temporal é `referencePeriod` (carimbo "dados atualizados até" do CSV Arquimedes).
- **Não existe data de abertura de consulta upstream** (Recon Parte II) — `firstSeenAt` é o único
  sinal prospectivo de ritmo; `dataApresentacao` foi reprovado como proxy (enviesado).
- **Status de eventos** dobra `REGISTRADO`/"sem data prevista" em `agendado` (Recon §4.1) — declarado,
  não corrigido (dívida de tool, não de dataset).
- **eventos `comentarios`/`hora`/`data` são só-listagem, com caveat PROVISÓRIO (achado A3 da ETAPA 4):**
  `comentarios` recebe 0 quando ausente na listagem (indistinguível de zero real) e `hora`/`data` podem
  divergir da página de detalhe. **Não use** como medida fina de engajamento/horário antes do estudo de
  reconciliação listagem×detalhe (planejado; ver ROADMAP). Proveniência permanece fiel à listagem.
- **Codificação:** saída UTF-8; o CSV Arquimedes (`consultas_votos`), servido em windows-1252 rotulado
  como octet-stream, é transcodificado para UTF-8 na leitura.
- **Ordenação determinística:** registros por `entity_id` ascendente e chaves JSON estáveis — dois freezes
  do mesmo corpus produzem NDJSON byte-idêntico (o diff entre vintages é só mudança real de dado).

### Integridade

`SHA256SUMS` (formato coreutils) e `release.json` (manifesto com versões, DOIs, commit e contagens)
acompanham a bundle. Verifique com `sha256sum -c SHA256SUMS` após descomprimir.

---

<!-- Template para o próximo corte (não remover):

## [dataset-vX.Y.Z] — AAAA-MM · <edição>

- **schemaVersion:** `?.?.?`
- **concept-DOI:** `10.5281/zenodo.<concept>` · **version-DOI:** `10.5281/zenodo.<versão>`

### Adicionado / Alterado / Corrigido
- O que ENTROU/mudou desde o release anterior (o dado é append-only: descreva deltas, não reescritas).
-->
