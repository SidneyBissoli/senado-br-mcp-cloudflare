/**
 * Liga o arquivo bruto (fase B) a um job de ingestão: monta o cliente R2 a partir do ambiente,
 * registra o observador de respostas em `http.ts` e devolve `fechar()`, que descarrega o índice
 * pendente e a última parte do manifesto. Todo caminho de saída do job chama `fechar()` antes de
 * `process.exit` — a linha do índice ainda não descarregada seria a única coisa a se perder.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Arquivo, configDoAmbiente } from "./arquivo.js";
import { applyD1File } from "./d1.js";
import { observarRespostas } from "./http.js";
import { criarClienteR2 } from "./r2.js";

export interface ArquivoLigado {
  fechar(): Promise<void>;
}

export function ligarArquivo(o: { job: string; entidade: string; outDir: string }): ArquivoLigado {
  const cfg = configDoAmbiente(process.env);
  if (!cfg) {
    console.log(`[${o.job}][arquivo] desligado (sem credenciais do R2 ou ECIDADANIA_ARQUIVO=desligado)`);
    return { fechar: async () => {} };
  }
  const rodada = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`
    : `local-${new Date().toISOString().replace(/[:.]/g, "")}`;
  const leitor = `${o.job}@${(process.env.GITHUB_SHA ?? "local").slice(0, 7)}`;
  const arquivo = new Arquivo({
    cliente: criarClienteR2({
      accountId: cfg.accountId,
      bucket: cfg.bucket,
      cred: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    }),
    entidade: o.entidade,
    job: o.job,
    rodada,
    leitor,
    aplicarSql: (sql, n) => {
      const path = join(o.outDir, `out-${o.job}-arquivo-${String(n).padStart(3, "0")}.sql`);
      writeFileSync(path, sql);
      applyD1File(path);
    },
  });
  observarRespostas((url, status, body) => arquivo.guardar(url, status, body));
  console.log(`[${o.job}][arquivo] ligado: balde ${cfg.bucket}, rodada ${rodada}, leitor ${leitor}`);

  let fechado = false;
  return {
    async fechar() {
      if (fechado) return;
      fechado = true;
      observarRespostas(null);
      try {
        await arquivo.descarregar();
      } catch (e) {
        console.error(`[${o.job}][arquivo] índice final não descarregado: ${e instanceof Error ? e.message : String(e)}`);
      }
      const r = arquivo.resumo();
      console.log(
        `[${o.job}][arquivo] ${r.leituras} leituras guardadas (${r.novas} páginas novas, ${r.repetidas} repetidas); ` +
          `${(r.bytesOriginais / 1048576).toFixed(1)} MB originais, ${(r.bytesGravados / 1048576).toFixed(1)} MB gravados em gzip`,
      );
    },
  };
}
