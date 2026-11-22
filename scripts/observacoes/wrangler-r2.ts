/**
 * `ClienteR2` sobre o `wrangler r2 object` — só para rodar o reprocessador na máquina do dono, com o
 * login do wrangler, sem token S3. Lento (um processo por objeto): serve para amostras e conferência;
 * o job diário usa o cliente S3 de `r2.ts`.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { ClienteR2 } from "../ingest-ecidadania/r2.js";

const exec = promisify(execFile);

export function clienteWrangler(bucket: string): ClienteR2 {
  // O JS do wrangler direto no Node: sem shell (nada de argumento concatenado em linha de comando).
  // `bin/` não está nos "exports" do pacote: acha a raiz pelo package.json (exportado) e monta o caminho.
  const raiz = dirname(createRequire(import.meta.url).resolve("wrangler/package.json"));
  const wrangler = join(raiz, "bin", "wrangler.js");
  const rodar = (args: string[]) =>
    exec(process.execPath, [wrangler, "r2", "object", ...args, "--remote"], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });
  const ausente = (e: unknown) => /not found|does not exist|NoSuchKey|404/i.test(String((e as { stderr?: Buffer }).stderr ?? e));
  return {
    async existe(chave) {
      return (await this.ler(chave)) !== null;
    },
    async ler(chave) {
      try {
        const { stdout } = await rodar(["get", `${bucket}/${chave}`, "--pipe"]);
        return new Uint8Array(stdout);
      } catch (e) {
        if (ausente(e)) return null;
        throw e;
      }
    },
    async gravar(chave, corpo, headers) {
      const dir = mkdtempSync(join(tmpdir(), "obs-"));
      try {
        const arq = join(dir, "corpo");
        writeFileSync(arq, corpo);
        await rodar(["put", `${bucket}/${chave}`, "--file", arq, ...(headers["content-type"] ? ["--content-type", headers["content-type"]] : [])]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
