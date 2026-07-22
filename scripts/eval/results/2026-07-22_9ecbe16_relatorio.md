# Relatório da bateria dourada — 2026-07-22_9ecbe16

Fonte: `2026-07-22_9ecbe16_julgado.ndjson` · 5 conversas · modelos: claude-haiku-4-5 · sha do servidor: `9ecbe16`. Taxas ignoram métricas NA; "(n)" é o nº de linhas avaliadas/julgadas na taxa.

## Por modelo

| | n | M1 (avaliadas) | M2 (avaliadas) | M3 (avaliadas) | M4 (julgadas) | M5 médio |
|---|---:|---:|---:|---:|---:|---:|
| `claude-haiku-4-5` | 5 | 100.0% (5) | 100.0% (1) | 100.0% (1) | 100.0% (5) | 2.20 |

## Por classe de armadilha

| classe · modelo | n | M1 (avaliadas) | M2 (avaliadas) | M3 (avaliadas) | M4 (julgadas) | M5 médio |
|---|---:|---:|---:|---:|---:|---:|
| SEL · `claude-haiku-4-5` | 2 | 100.0% (2) | NA (0) | NA (0) | 100.0% (2) | 1.00 |
| PAR · `claude-haiku-4-5` | 1 | 100.0% (1) | NA (0) | NA (0) | 100.0% (1) | 1.00 |
| AGG · `claude-haiku-4-5` | 1 | 100.0% (1) | 100.0% (1) | NA (0) | 100.0% (1) | 1.00 |
| TMP · `claude-haiku-4-5` | 1 | 100.0% (1) | NA (0) | 100.0% (1) | 100.0% (1) | 7.00 |

## Por ferramenta esperada

Uma conversa conta para TODAS as ferramentas esperadas da sua pergunta.

| ferramenta · modelo | n | M1 (avaliadas) | M2 (avaliadas) | M3 (avaliadas) | M4 (julgadas) | M5 médio |
|---|---:|---:|---:|---:|---:|---:|
| `senado_agenda_comissoes` · `claude-haiku-4-5` | 1 | 100.0% (1) | NA (0) | 100.0% (1) | 100.0% (1) | 7.00 |
| `senado_licitacoes` · `claude-haiku-4-5` | 1 | 100.0% (1) | NA (0) | NA (0) | 100.0% (1) | 1.00 |
| `senado_remuneracoes_servidores` · `claude-haiku-4-5` | 1 | 100.0% (1) | 100.0% (1) | NA (0) | 100.0% (1) | 1.00 |
| `senado_terceirizados` · `claude-haiku-4-5` | 1 | 100.0% (1) | NA (0) | NA (0) | 100.0% (1) | 1.00 |
| `senado_vetos` · `claude-haiku-4-5` | 1 | 100.0% (1) | NA (0) | NA (0) | 100.0% (1) | 1.00 |

## Índice de fragilidade por ferramenta

Definição (spec 3.3): taxa de M4 no modelo forte (`claude-sonnet-4-6`) menos a taxa no fraco (`claude-haiku-4-5`), decrescente — maior índice = prioridade de redesign.

> ⚠️ Indisponível: o NDJSON julgado não contém os DOIS modelos (o índice exige forte e fraco). Rode a bateria completa.

| ferramenta | M4 forte (n) | M4 fraco (n) | índice |
|---|---:|---:|---:|
| `senado_agenda_comissoes` | NA (0) | 100.0% (1) | n/d |
| `senado_licitacoes` | NA (0) | 100.0% (1) | n/d |
| `senado_remuneracoes_servidores` | NA (0) | 100.0% (1) | n/d |
| `senado_terceirizados` | NA (0) | 100.0% (1) | n/d |
| `senado_vetos` | NA (0) | 100.0% (1) | n/d |

## Sinal R1 (agregação server-side)

Conversas não-ENC resolvidas com M5 <= 2: 4/5 · ofensores: A02 (claude-haiku-4-5, m5=7)

