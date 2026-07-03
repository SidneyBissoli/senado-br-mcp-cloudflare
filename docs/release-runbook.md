# Runbook — cortar um release do dataset (Fase 1.3)

Como congelar, versionar e arquivar (com DOI) um release do **dataset de participação do e-Cidadania**.
Cobre o corte inaugural (`dataset-v1.0.0`) e os cortes seguintes. A máquina foi montada na sessão C2;
este documento é a parte **humana** — o que só você pode/deve fazer (conta Zenodo, ORCID, decidir cortar).

> **Dois números de versão, não confundir** (ver `src/dataset/release.ts`):
> - `schemaVersion` (`1.0.0`, em `src/dataset/schema.ts`) — estrutura das variáveis/envelope. Gravado em cada registro.
> - versão do **release** (`dataset-v1.0.0`) — a edição do dado. SemVer própria, tag com prefixo `dataset-v`.
>
> **Cadência** (ETAPA 2/D2): **anual**, em janeiro, cobrindo o ano-calendário anterior (bump **MINOR**).
> Release **extraordinário** (defeito de dado / mudança de schema upstream) a qualquer momento
> (**PATCH** para dado; **MAJOR** quando o schema muda) — cada um com version-DOI próprio.

---

## Peças da máquina (o que já está no repo)

| Arquivo | Papel |
|---|---|
| `src/dataset/release.ts` | Núcleo puro: versões, manifesto (`release.json`), `SHA256SUMS`, metadata Zenodo. Testado. |
| `scripts/build-dataset/release.ts` | Freeze off-Worker: hasheia o build, grava `SHA256SUMS` + `release.json`, copia citação. `npm run release:dataset`. |
| `scripts/build-dataset/zenodo-publish.ts` | Publicação Zenodo REST (opt-in, gated por `ZENODO_TOKEN`). `npm run release:zenodo`. |
| `.github/workflows/release-dataset.yml` | Orquestra tudo ao empurrar a tag `dataset-v*`. |
| `CITATION.cff` · `.zenodo.json` · `LICENSE-DATA.md` | Metadados de citação, depósito e licença de **dado** (separada da MIT do código). |
| `CHANGELOG-dataset.md` | Changelog cumulativo do **dado** (append-only). |

---

## Pré-requisitos, uma vez (passos humanos)

1. **ORCID.** ✅ Preenchido (`0009-0001-0442-3700`) em `CITATION.cff` (`authors[0].orcid`) e
   `.zenodo.json` (`creators[0].orcid`).
2. **Conta Zenodo** (<https://zenodo.org>). Para ensaiar sem sujar o registro real, use o
   **sandbox** (<https://sandbox.zenodo.org>) — DOIs de teste, mesma API.
3. **Token Zenodo:** *Applications → Personal access tokens →* crie um com escopos
   `deposit:write` e `deposit:actions`. Guarde como **secret** do repositório: `ZENODO_TOKEN`.
   (Sandbox tem token próprio; para mirar o sandbox, defina também a variável `ZENODO_URL=https://sandbox.zenodo.org`.)
4. **Segredos/variáveis de CI já usados pelo ingest** (o build lê o D1): confirme que
   `secrets.CLOUDFLARE_API_TOKEN` e `vars.CLOUDFLARE_ACCOUNT_ID` existem (o workflow de ingest já os usa).

> Sem `ZENODO_TOKEN`, a máquina roda inteira mesmo assim: gera o freeze e o **GitHub Release** com o
> tarball + `SHA256SUMS` + `release.json`. O passo Zenodo vira no-op. Você pode subir o tarball ao
> Zenodo à mão nesse caso (ver "Fallback manual").

---

## Corte inaugural — `dataset-v1.0.0`

O primeiro corte **cunha o concept-DOI** (estável para sempre) e o primeiro version-DOI. Faça-o
**semi-manual** na primeira vez, para conferir cada passo antes de automatizar os seguintes.

1. **Ensaie local (sem tocar em nada remoto):**
   ```bash
   npm run build:dataset            # lê o D1 → dataset/1.0.0/*.ndjson + datapackage.json + dictionary.md
   npm run release:dataset -- --version 1.0.0
   (cd dataset/1.0.0 && sha256sum -c SHA256SUMS)   # tem de dar OK em todos
   npm run release:zenodo -- --version 1.0.0 --dry-run   # confira a metadata
   ```
2. **Publique no Zenodo** (recomendado: sandbox primeiro). Duas opções:
   - **Automática (helper):** empacote e rode o helper contra o sandbox:
     ```bash
     tar --sort=name --mtime='@0' --owner=0 --group=0 -czf ecidadania-participacao-1.0.0.tar.gz -C dataset 1.0.0
     ZENODO_URL=https://sandbox.zenodo.org ZENODO_TOKEN=<seu-token-sandbox> \
       npm run release:zenodo -- --version 1.0.0 \
         --file ecidadania-participacao-1.0.0.tar.gz \
         --file dataset/1.0.0/SHA256SUMS --file dataset/1.0.0/release.json --publish
     ```
     O helper imprime o **version-DOI** e o **concept-DOI**. Anote os dois.
   - **Manual (UI):** *New upload* no Zenodo, arraste o tarball + `SHA256SUMS` + `release.json`, cole os
     metadados de `.zenodo.json`, escolha a licença (CC-BY-4.0 como equivalente — ver `LICENSE-DATA.md`),
     e publique. Anote os DOIs.
3. **Grave os DOIs de volta** (isto fecha a citabilidade):
   - `CITATION.cff` → `identifiers[0].value` = **concept-DOI**;
   - `CHANGELOG-dataset.md` → entrada `dataset-v1.0.0`: concept-DOI + version-DOI;
   - guarde o **recid da deposição** como variável de repositório `ZENODO_DEPOSITION` (para a
     continuidade de concept-DOI nos próximos cortes).
   Commite essas edições.
4. **Empurre a tag** para registrar o release no GitHub (e disparar o workflow, que reproduz o freeze e
   anexa os assets):
   ```bash
   git tag dataset-v1.0.0 && git push origin dataset-v1.0.0
   ```

> Por que semi-manual no v1: o concept-DOI é irreversível e o helper HTTP **não** é coberto por testes
> (só a montagem de metadata é). Depois de validado uma vez, os cortes seguintes podem ir 100% pelo CI.

---

## Cortes seguintes (anual, ou extraordinário)

1. Decida o bump: **MINOR** (edição anual), **PATCH** (defeito de dado), **MAJOR** (mudança de schema —
   suba também `DATASET_SCHEMA_VERSION`). Atualize `DATASET_RELEASE_VERSION`/`DATASET_RELEASE_EDITION`
   em `src/dataset/release.ts`.
2. **Adicione a entrada no `CHANGELOG-dataset.md`** descrevendo o **delta** desde o release anterior
   (o dado é append-only: descreva o que entrou/mudou, não reescreva histórico). Amarre o `schemaVersion`.
3. Confirme que `vars.ZENODO_DEPOSITION` aponta para a deposição-pai (continuidade do concept-DOI).
4. Empurre a tag `dataset-v<X.Y.Z>` — o workflow builda, congela, verifica, cria o GitHub Release e
   (com `ZENODO_TOKEN`) deposita uma **nova versão** no Zenodo. Para publicar automaticamente em vez de
   deixar rascunho, use *Run workflow* (dispatch) com `zenodo_publish=true`.
5. Grave o novo version-DOI na entrada do changelog.

---

## Fallback manual (sem automação Zenodo)

Se preferir não configurar o token: rode `npm run build:dataset && npm run release:dataset -- --version <v>`,
empurre a tag (o GitHub Release sai com os assets), baixe o tarball do release e suba-o à mão no Zenodo
pela UI, usando `.zenodo.json` como roteiro dos metadados. Grave os DOIs de volta como acima.

---

## Checklist de corte (copie por release)

- [ ] `DATASET_RELEASE_VERSION`/edição atualizados (e `schemaVersion` se o schema mudou)
- [ ] Entrada nova no `CHANGELOG-dataset.md` (delta + schemaVersion + DOIs)
- [ ] `npm run build:dataset` && `npm run release:dataset -- --version <v>`
- [ ] `sha256sum -c SHA256SUMS` = OK em todos os arquivos
- [ ] `npm test` && `npm run typecheck` verdes
- [ ] Depósito Zenodo publicado; version-DOI + concept-DOI anotados
- [ ] DOIs gravados em `CITATION.cff` (concept) e `CHANGELOG-dataset.md` (ambos)
- [ ] Tag `dataset-v<v>` empurrada; GitHub Release com tarball + `SHA256SUMS` + `release.json`
