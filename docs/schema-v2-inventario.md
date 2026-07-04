# Inventário de campos → schema-alvo v2 (enriquecimento por detalhe)

> **Escopo.** Desenho do dataset v2, decorrente do estudo A3 (`docs/estudo-a3-reconciliacao-eventos.md`)
> e da decisão 👤 de que o dataset é bem público citável → deve ser o mais fiel e completo que a fonte
> permite, servindo o **máximo de perguntas de terceiros**. Este doc **enumera e propõe**; não altera
> `src/dataset/schema.ts`, não coleta em produção, não publica. **A aprovação do schema-alvo é 👤**,
> guardrail no espírito da ETAPA 4. Depois de aprovado: implementação → **v2.0.0** pela máquina da Fase 1.3.

- **Data:** 2026-07-04. **Base:** sondagem viva de detalhe/AJAX (04/07) + parsers reais
  `obterEventoInternal`/`obterConsultaInternal`/`obterIdeiaInternal` (`src/scraper/ecidadania.ts`).

## Decisões travadas 👤 (entrada deste desenho)

1. **Dois níveis para eventos:** (a) tabela **nível-evento** — a atual, com a contagem de comentários
   **corrigida**; (b) nova tabela **nível-comentário** — linha = comentário.
2. **Nível-comentário guarda texto + UF + timestamp (+ afins); NÃO guarda nome.**
3. **Reabrir os campos detail-only** de ideias e consultas (hoje `null` por design).
4. **Postura de privacidade por origem do dado** (detalhada abaixo).
5. É mudança de schema com campos novos → **v2.0.0**.

## Postura de privacidade (regra que rege os campos de pessoas)

| Origem do dado | Exemplos | Postura no dataset |
|---|---|---|
| **Conteúdo de cidadão** | comentário de audiência; autor de ideia legislativa | **sem nome**; mantém **UF**; mantém **texto** (comentário) |
| **Autoria/atuação de agente público** | autoria e relatoria de consulta (matéria); convidados de audiência | **nome mantido** (informação pública por função) |

Nota factual: o portal já exibe o comentarista semi-anonimizado ("RODRIGO M. (RS)" = 1º nome + inicial +
UF). Ainda assim, **descartamos o nome na origem** (não o coletamos) — a UF basta para o sinal regional e
elimina o principal reidentificador. Assimetria de reversibilidade: dá para *adicionar* um campo num
release futuro; não dá para *despublicar* um snapshot com DOI.

---

## 1. EVENTOS — nível-evento (tabela existente, corrigida + enriquecida)

Fonte hoje = só listagem `principalaudiencia`. v2 = listagem + **detalhe** `visualizacaoaudiencia?id=`
+ **AJAX** de comentários. Mutabilidade: *imutável* (pós-evento) = backfill único; *volátil* = re-crawl.

| Campo | Hoje | Fonte v2 | Mutab. | Ação v2 |
|---|---|---|---|---|
| `titulo` | ok | listagem | imut. | manter |
| `data` | listagem (1,1% diverge) | **detalhe** `audiencia-data` | imut. | **corrigir do detalhe** (canônico) |
| `hora` | listagem (57% diverge) | **detalhe** `audiencia-data` | imut. | **corrigir do detalhe** (canônico) |
| `comissao` (sigla) | ok | listagem/detalhe | imut. | manter |
| `comissaoNomeCompleto` | — | **detalhe** `audiencia-comissao` | imut. | **novo** |
| `local` | — | **detalhe** `audiencia-local` | imut. | **novo** |
| `descricao`/finalidade | — | **detalhe** `audiencia-finalidade` | imut. | **novo** |
| `pauta` | — | **detalhe** `audiencia-pauta` (lista) | imut. | **novo** |
| `convidados` | — | **detalhe** `titulo-convidados` (nomes; públicos) | imut. | **novo** (nome mantido) |
| `videoUrl` | — | **detalhe** embed YouTube | ~imut. | **novo** (nulo até haver vídeo) |
| `comentarios` (contagem) | listagem (0-espúrio 82%) | **AJAX** `ajaxcolecaocomentarioaudiencia` (nº de blocos) | **volátil** | **corrigir p/ contagem canônica** |
| `status` | listagem (classe) | listagem; detalhe confirma | — | manter (fold REGISTRADO segue caveat) |
| `url`, `firstSeenAt` | ok | derivado | — | manter |

## 2. EVENTOS — nível-comentário (tabela NOVA)

Linha = um comentário de audiência. Fonte = fragmento `GET /ajaxcolecaocomentarioaudiencia?audienciaId=<id>`
(sem paginação; `<div class="comentario" id="comentario-N">`). **Volátil** (comentários acumulam) → cadência.

| Campo | Fonte | Observação |
|---|---|---|
| `eventoId` | FK (audienciaId da chamada) | liga à tabela nível-evento |
| `comentarioId` | `data-id` do bloco | id estável do comentário |
| `uf` | `titulo-comentarios`, parte "(XX)" | **só a UF** — o nome antes do "(" é descartado |
| `texto` | `texto-comentarios` | verbatim (conteúdo deliberativo) |
| `data` | `horadata-comentarios` (parte DD/MM/AAAA) | — |
| `hora` | `horadata-comentarios` (parte HHhMM) | — |
| `momentoVideoUrl` *(quando houver)* | `momento-comentario`/`momento-por-link` | subconjunto: comentário ancorado a um momento do vídeo |
| `convidadoAssociado` *(quando houver)* | `momento-convidado-nome`/`-cargo` | convidado a quem o comentário se dirige (público) |

**Sem nome do comentarista.** UF é o ativo regional (espelha `votosPorUf` das consultas, mas para
deliberação em audiências — dado que ninguém mais publica versionado).

## 3. IDEIAS — reabrir detail-only

Fonte hoje = listagem `pesquisaideia` (título, apoios, status). Detalhe = `visualizacaoideia?id=`.
**Sem sistema de comentários** (sondado: não há coleção de comentário na ideia). Autor = **cidadão**.

| Campo | Hoje | Fonte v2 | Postura | Ação v2 |
|---|---|---|---|---|
| `titulo`, `apoios`, `status` | ok | listagem | — | manter |
| `dataPublicacao` | **null** | **detalhe** "Data limite p/ 20.000 apoios" | — | **reabrir** — hoje ideias não têm NENHUMA data real (só `firstSeenAt` censurado); esta é uma âncora temporal upstream genuína |
| `autorUf` | — (`autor`=null) | **detalhe** "Ideia proposta por … (UF)" | cidadão → **só UF, sem nome** | **reabrir como UF** |
| `descricao` | — | **detalhe** corpo da ideia | — | **novo** (texto do cidadão; conteúdo, não identidade) |
| `plConvertido` | — | **detalhe** (SUG/PL nº) | — | **novo** |

⚠️ **Custo — o item caro desta leva.** O corpus de ideias tem **~113,7k** registros. Reabrir campos de
detalhe exige **um fetch de detalhe por ideia** → **~113,7k requisições** no backfill único (a ~0,8 s/req
educado ≈ ~25 h de crawl off-Worker, chunkável/resumível na Action) + incremento por ideias novas no crawl
diário. Compare: eventos ~5,4k, consultas ~7,8k. **Justificativa:** entrega `dataPublicacao` (a única data
real de ideias) para a maior entidade do pacote. **Decisão 👤:** (a) backfill completo agora; (b) só
prospectivo (detalhe nas ideias vistas de agora em diante; históricas ficam com detalhe nulo — reintroduz
censura à esquerda nesses campos); (c) adiar ideias-detalhe para leva posterior. **Recomendo (a)**: é
imutável, então o custo amortiza a zero e o campo de data é grande demais para deixar de fora de um dataset
citável — mas é a mudança operacional mais pesada e precisa do seu aval explícito.

## 4. CONSULTAS — reabrir detail-only

Fonte hoje = listagem `pesquisamateria` (matéria, ementa, votos agregados) + status via `/processo`.
Detalhe = `visualizacaomateria?id=`. Autoria/relatoria = **agentes públicos** (nome mantido).

| Campo | Hoje | Fonte v2 | Postura | Ação v2 |
|---|---|---|---|---|
| `materia`, `ementa`, `votosSim/Nao`, `status` | ok | listagem/`/processo` | — | manter |
| `autoria` | — | **detalhe** `materia-autor` "Autoria:" | público → **nome mantido** | **reabrir** |
| `relator` | — | **detalhe** "Relator(a):" | público → **nome mantido** | **reabrir** |
| votos por UF (ao vivo) | — | **não disponível** no detalhe (só gráfico agregado) | — | não coletável; per-UF só existe no acervo Arquimedes congelado (`consultas_votos`) — registrar como negativa checada |

Custo: **~7,8k** fetches de detalhe (backfill único, imutável para consultas encerradas; as abertas
re-verificadas na cadência normal).

---

## Resumo de custo / arquitetura

| Leva | Fetches backfill único | Volátil (cadência) |
|---|--:|---|
| Eventos detalhe (data/hora/local/…) | ~5,4k | — (imutável) |
| Eventos comentários (contagem + tabela) | ~5,4k | **sim** — re-crawl de comentários dos eventos ativos |
| Consultas detalhe (autoria/relator) | ~7,8k | abertas na cadência normal |
| Ideias detalhe (dataPublicacao/UF/descrição) | **~113,7k** | ideias novas no crawl diário |
| **Total one-time** | **~132k req** | |

A arquitetura de ingest passa de "só-listagem" para **listagem + detalhe (+ AJAX de comentários em
eventos)**. Isso muda o contrato que a **C3** (contract tests) precisa cobrir → confirma a inversão de
ordem: **v2.0.0 antes da C3**.

## Perguntas resolvidas 👤 (04/07/2026) — schema-alvo APROVADO

1. **Ideias-detalhe (~113,7k):** ✅ **backfill completo**.
2. **Contagem de comentários (volátil):** ✅ **re-crawl de comentários de TODOS os eventos por ciclo**
   (não só os ativos).
3. **`convidados` e `momento/convidadoAssociado`:** ✅ **entram na v2.0.0**.
4. **Nomes das tabelas:** ✅ **`eventos` (nível-evento) + `eventos_comentarios` (nível-comentário)**.

Postura de privacidade confirmada (cidadão → sem nome + UF; agente público → nome mantido). Inversão de
ordem confirmada: **v2.0.0 antes da C3**.

**Próximo passo:** a implementação é uma **sessão dedicada/limpa** (Sessão C2b no ROADMAP, ETAPA 5.5) —
núcleo puro em `src/dataset` + coleta em `scripts/ingest-ecidadania` + `src/scraper/ecidadania`, sem tocar
na máquina de releases; o corte v2.0.0 vem depois, pela Fase 1.3.
