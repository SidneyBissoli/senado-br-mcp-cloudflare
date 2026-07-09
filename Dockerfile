# Dockerfile para o registro Glama (glama.ai).
#
# Sem este arquivo, a Glama auto-gera um Dockerfile pesado (Debian trixie +
# NodeSource + pnpm + uv/Python 3.14 preview) que nada tem a ver com este
# projeto — Node/TypeScript puro, gerenciado por npm. Cada passo extra é mais
# um pull de rede que pode estourar o timeout do builder da Glama. Este
# Dockerfile enxuto reduz a superfície de falha e usa o npm/package-lock.json
# reais em vez de `pnpm install` sem pnpm-lock.
#
# O CMD é mantido idêntico ao que a Glama espera: o mcp-proxy expõe o servidor
# stdio (dist/cli.js) como endpoint HTTP/SSE para o testador da Glama conectar.

FROM node:22-bookworm-slim

# Proxy stdio→HTTP usado pelo harness da Glama (mesma versão do Dockerfile auto).
RUN npm install -g mcp-proxy@6.4.3

WORKDIR /app

# Camada de dependências cacheável: só invalida quando os manifestos mudam.
COPY package.json package-lock.json ./
# Inclui devDependencies (typescript, tsx etc.) — necessárias para `npm run build`.
RUN npm ci

# Código-fonte + build do pacote stdio (tsc -p tsconfig.build.json → dist/).
COPY . .
RUN npm run build

CMD ["mcp-proxy", "--", "node", "dist/cli.js"]
