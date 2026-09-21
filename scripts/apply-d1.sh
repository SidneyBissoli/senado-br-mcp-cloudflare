#!/usr/bin/env bash
#
# Aplica um ou mais arquivos .sql no D1, com retry.
#
# POR QUE EXISTE, medido em 21/09/2026. A ingestao semanal de consultas_votos falhou com
#
#   ✘ [ERROR] D1 DB storage operation exceeded timeout which caused object to be reset.
#
# no PRIMEIRO lote, e a rodada inteira se perdeu — proxima tentativa so na semana seguinte.
# Nao era tamanho: o corpus tinha crescido 0,08% em relacao a semana anterior (15.260 materias
# contra 15.248; 150.822 linhas materia×UF contra 150.703), e o MESMO lote 001 havia sido
# aplicado em 9 segundos sete dias antes. Estourou em 42 s desta vez. Isso e blip do D1, e a
# cura de blip e repetir.
#
# Repetir e seguro POR DESENHO, e o proprio wrangler diz isso em toda execucao:
#   "Note: if the execution fails to complete, your DB will return to its original state and
#    you can safely retry."
# `--file` roda o arquivo inteiro atomicamente do lado do servidor. Ainda assim os arquivos
# emitidos aqui sao upserts idempotentes, entao reaplicar um lote que talvez tenha passado
# tambem nao faz estrago.
#
# Os sete pontos de escrita no D1 (dois workflows, quatro entidades + consultas_votos) passaram
# a chamar este script em vez de invocar o wrangler cru, para a resiliencia nao depender de quem
# lembrou de copiar o laco.
#
# Env:
#   D1_DATABASE        nome do banco (default: senado-ecidadania)
#   D1_APPLY_ATTEMPTS  tentativas por arquivo (default: 4)
#   D1_APPLY_DELAY_S   base da espera linear entre tentativas (default: 15 -> 15s, 30s, 45s)

set -euo pipefail

DB="${D1_DATABASE:-senado-ecidadania}"
MAX_ATTEMPTS="${D1_APPLY_ATTEMPTS:-4}"
BASE_DELAY_S="${D1_APPLY_DELAY_S:-15}"

if [ "$#" -eq 0 ]; then
  echo "uso: apply-d1.sh <arquivo.sql> [arquivo.sql ...]" >&2
  exit 2
fi

apply_one() {
  local f="$1"
  local attempt=1
  local wait_s

  if [ ! -f "$f" ]; then
    echo "::error::arquivo nao encontrado: $f" >&2
    return 1
  fi

  while :; do
    echo "Applying $f (tentativa $attempt/$MAX_ATTEMPTS)"
    if npx wrangler d1 execute "$DB" --remote --file="$f"; then
      return 0
    fi
    if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
      echo "::error::$f nao aplicou em $MAX_ATTEMPTS tentativa(s)" >&2
      return 1
    fi
    wait_s=$(( BASE_DELAY_S * attempt ))
    echo "falhou; nova tentativa em ${wait_s}s"
    sleep "$wait_s"
    attempt=$(( attempt + 1 ))
  done
}

for f in "$@"; do
  apply_one "$f"
done
