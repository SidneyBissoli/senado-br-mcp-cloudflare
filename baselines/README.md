# Baselines de superfície

Dumps NORMALIZADOS de `tools/list` + resources + prompts, gerados por
`node scripts/dump-surface.mjs` (chaves ordenadas recursivamente, tools por
name / resources por uri / prompts por name, versão do servidor omitida de
propósito — mudaria a cada release e sujaria todo diff). Prática transplantada
do bcb-br-mcp, onde o dump revelou que stdio e worker haviam divergido de
verdade (contrato HTTP sem `minItems`, resources com nomes diferentes,
descrições 12× menores em produção). Nenhum teste unitário pega essa classe.

| Arquivo | Como foi capturado | O que representa |
|:--|:--|:--|
| `surface-stdio-3.6.0.json` | `--stdio` sobre `dist/cli.js` do fonte atual | o que o canal npm (`senado-br-mcp`) publica |
| `surface-http-prod-3.6.0.json` | `--url https://senado.sidneybissoli.com/mcp` | o que o endpoint hospedado serve DE FATO |

## Medição da captura inicial (2026-09-01)

**As duas superfícies são IDÊNTICAS byte a byte** — 67 tools, 5 resources,
4 prompts, mesmo `serverName`. Não é sorte: o stdio (`src/cli.ts`) roda o
MESMO `createServer` de `src/server.ts` que o handler HTTP usa, então os dois
canais partilham a superfície por construção, e a produção estava em dia
(3.6.0, deploy de 30/08). As divergências possíveis aqui são de DEPLOY (fonte
à frente da produção), não de definição dupla como era no bcb pré-fundação —
por isso o script não tem modo `--source`.

O baseline cobre o perfil DEFAULT de tools. A variante
`/mcp/openai-app-v2` serve outro `toolProfile` e não é coberta por este dump —
se ela ganhar baseline um dia, é arquivo separado, nunca misturado a este.

## Como usar no gate

Depois de qualquer mudança que possa mexer na superfície:

```bash
npm run build
node scripts/dump-surface.mjs --stdio > depois.json
# diff contra o baseline vigente (surface-stdio-3.6.0.json)
```

Toda diferença precisa ser deliberada e listada no CHANGELOG. Depois de um
deploy, recapturar `--url` e conferir que voltou a bater com o stdio (a
propagação da Cloudflare serve isolates mistos por alguns segundos — se
divergir logo após o deploy, re-sondar antes de concluir deriva).
