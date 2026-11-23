# Licença do DADO

Este arquivo cobre o **dataset** de participação do e-Cidadania (as tabelas `*.parquet` — `*.ndjson`
na versão 1.0.0 —, `datapackage.json`, `dicionario.md` — `dictionary.md` na 1.0.0 — e o data package
congelado publicado no Zenodo). A licença do
**código** deste repositório é a MIT ([`LICENSE`](LICENSE)) e é **separada** desta.

## Fonte e termos

O dado deriva de fontes públicas do Senado Federal do Brasil:

- Portal **e-Cidadania** — `https://www12.senado.leg.br/ecidadania` (consultas públicas, ideias
  legislativas, eventos/audiências);
- **Dados Abertos do Senado Federal** — `https://legis.senado.leg.br/dadosabertos` e o acervo
  "Arquimedes" (CSV de votos por UF);

publicadas sob a política de **Dados Abertos do Senado Federal**:

> **Dados Abertos do Senado Federal — uso livre com atribuição da fonte.**

Termos oficiais: <https://www12.senado.leg.br/dados-abertos>.

## O que isso implica para quem usa o dataset

- **Uso livre**, inclusive comercial, acadêmico e derivado.
- **Atribuição obrigatória** da fonte original (Senado Federal) e recomendada deste dataset (cite o
  version-DOI do snapshot; ver [`CITATION.cff`](CITATION.cff) e [`CHANGELOG-dataset.md`](CHANGELOG-dataset.md)).
- **Dado pessoal (a partir da versão 3.0.0):** o nome do autor de cada ideia legislativa, como o
  portal o publica. Quem o usa também trata dado pessoal e responde pela própria finalidade (LGPD).
  Finalidade, limites de reúso e como o titular pede a omissão: seção "Dado pessoal" do
  [`docs/dataset-dictionary-v3.md`](docs/dataset-dictionary-v3.md) (`dicionario.md` no pacote).
- **Sem garantia.** O dataset é uma coleta independente, **não** afiliada nem endossada pelo Senado
  Federal. Cobertura, caveats temporais e limitações estão declarados em
  [`docs/dataset-dictionary-v3.md`](docs/dataset-dictionary-v3.md) (esquema 3.0.0;
  [`docs/dataset-dictionary.md`](docs/dataset-dictionary.md) para a 1.0.0) e no changelog.

## Nota de compatibilidade (Zenodo / SPDX)

A licença "Dados Abertos do Senado Federal" não tem identificador SPDX. Ao depositar no Zenodo, se um
identificador de licença for exigido, use o equivalente mais próximo — **CC-BY-4.0** (uso livre com
atribuição) — e preserve os termos exatos acima na descrição/nota do depósito. Esta escolha é de
mapeamento de vocabulário, não de re-licenciamento.
