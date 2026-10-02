/**
 * O pacote do npm leva UM README só — o `README.md`, em inglês.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Em 2026-10-02 a página do `senado-br-mcp` no
 * npm mostrava o README em PORTUGUÊS (`readmeFilename: README.pt-BR.md` no
 * registro). O npm empacota SEMPRE todo `README*` da raiz, ignorando o campo
 * `files` — inclusive a negação `!README.pt-BR.md`, testada —, e entre dois
 * escolheu o par traduzido. A mesma classe estava em seis dos oito pacotes do
 * portfólio (a referência é o `uis-mcp-server`). O par em português agora se
 * chama `LEIA-ME.md`, fora do padrão; este teste prende o pacote real
 * (`npm pack --dry-run`), não a convenção de nome.
 */

import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("README no pacote do npm", () => {
  it("o tarball leva exatamente um README, e é o README.md", () => {
    // O npm 12 mudou a forma de `npm pack --json`: era uma lista, virou um
    // objeto indexado pelo nome do pacote. O CI de publicação instala o
    // `npm@latest` e roda este teste no `prepublishOnly` — foi lá que a 3.12.1
    // quebrou ("object is not iterable", 2026-10-02). Aceitar as duas formas.
    const saida = execSync("npm pack --dry-run --json --ignore-scripts", {
      cwd: raiz,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const json: unknown = JSON.parse(saida);
    const lista = (Array.isArray(json) ? json : Object.values(json as object)) as Array<{
      files?: Array<{ path: string }>;
    }>;
    const arquivos = lista[0]?.files;
    if (!arquivos) throw new Error(`npm pack --json devolveu forma inesperada: ${saida.slice(0, 300)}`);
    const readmes = arquivos.map((f) => f.path).filter((p) => /^readme/i.test(p));
    expect(readmes, "o npm exibe um README só; com dois, escolheu o traduzido").toEqual(["README.md"]);
  }, 60_000);
});
