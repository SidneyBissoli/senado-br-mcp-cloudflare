/**
 * Reprocessador da fase C (C2 + C1 das ideias): arquivo bruto (fase B) → observações (camada 2).
 *
 *   1. relê a cópia anterior no balde `ecidadania-observacoes` (`ideias/observacoes.parquet`); se o
 *      leitor mudou (outra `versaoDoLeitor()`) ou com `--completo`, começa do zero;
 *   2. percorre o `ecidadania_arquivo_indice` a partir do cursor da cópia, em ordem de id, em lotes;
 *   3. abre cada página no balde `ecidadania-arquivos` (só leitura), confere o sha, extrai os fatos
 *      (`fatos.ts`) e funde (`fundir.ts`);
 *   4. grava a cópia inteira de volta, com o cursor novo nos metadados do próprio Parquet.
 *
 * Não acessa o portal. Desenho e decisões: ROADMAP, "Desenho da fase C".
 *
 * Opções: `--completo` (ignora a cópia), `--limite N` (para depois de N linhas do índice — amostra),
 * `--local` (clientes pelo `wrangler r2 object`, login do dono), `--saida <arquivo>` (grava a cópia
 * no disco em vez do balde), `--paralelo N` (páginas abertas ao mesmo tempo; padrão 16), `--desde N`
 * (amostra a partir da linha N do índice, sem cópia anterior; exige `--saida`).
 * Ambiente do job: CLOUDFLARE_ACCOUNT_ID, OBSERVACOES_R2_ACCESS_KEY_ID, OBSERVACOES_R2_SECRET_ACCESS_KEY
 * (token que LÊ o `ecidadania-arquivos` e grava o `ecidadania-observacoes`), CLOUDFLARE_API_TOKEN (D1).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BALDE_PADRAO, autoprovaZstd } from "../ingest-ecidadania/arquivo.js";
import { queryD1 } from "../ingest-ecidadania/d1.js";
import { criarClienteR2, type ClienteR2 } from "../ingest-ecidadania/r2.js";
import { fonteDaUrl, statusObservavel, versaoDoLeitor } from "./fatos.js";
import { fundir, ForaDeOrdemError, type Leitura, type Observacao } from "./fundir.js";
import { BALDE_OBSERVACOES, CHAVE_DA_COPIA, CHAVE_DOS_INVARIANTES, ENTIDADE, LOTE, leiturasDaLinha, sqlDoLote, type Contagem, type LinhaDoIndice } from "./linhas.js";
import { separarConhecidas, verificarInvariantes, type Conhecida, type Violacao } from "./invariantes.js";
import { AbridorDePaginas, emParalelo } from "./paginas.js";
import { escreverCopia, lerCopia } from "./parquet.js";
import { clienteWrangler } from "./wrangler-r2.js";

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function clientes(local: boolean): { arquivo: ClienteR2; observacoes: ClienteR2 } {
  if (local) return { arquivo: clienteWrangler(BALDE_PADRAO), observacoes: clienteWrangler(BALDE_OBSERVACOES) };
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const accessKeyId = process.env.OBSERVACOES_R2_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.OBSERVACOES_R2_SECRET_ACCESS_KEY ?? "";
  const faltam = Object.entries({ CLOUDFLARE_ACCOUNT_ID: accountId, OBSERVACOES_R2_ACCESS_KEY_ID: accessKeyId, OBSERVACOES_R2_SECRET_ACCESS_KEY: secretAccessKey })
    .filter(([, v]) => !v).map(([k]) => k);
  if (faltam.length) throw new Error(`faltam no ambiente: ${faltam.join(", ")} (ou use --local)`);
  const cred = { accessKeyId, secretAccessKey };
  return {
    arquivo: criarClienteR2({ accountId, bucket: BALDE_PADRAO, cred }),
    observacoes: criarClienteR2({ accountId, bucket: BALDE_OBSERVACOES, cred }),
  };
}

async function main(): Promise<void> {
  const completo = process.argv.includes("--completo");
  const local = process.argv.includes("--local");
  const limite = arg("--limite") ? Number(arg("--limite")) : Infinity;
  const paralelo = Number(arg("--paralelo") ?? 16);
  const saida = arg("--saida");
  const leitor = versaoDoLeitor();
  // As páginas desde 15/11/2026 estão em zstd com dicionário: sem Node ≥ 24.6 para aqui, não lê lixo.
  autoprovaZstd();
  const { arquivo, observacoes } = clientes(local);
  const abridor = new AbridorDePaginas(arquivo);
  const decodificar = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

  let obs: Observacao[] = [];
  let cursor = 0;
  const desde = arg("--desde");
  // Amostra a partir de um ponto do índice: só para conferência, nunca vira a cópia do balde.
  if (desde !== undefined && !saida) throw new Error("--desde exige --saida (amostra não substitui a cópia)");
  const anterior = completo || desde !== undefined ? null : await observacoes.ler(CHAVE_DA_COPIA);
  if (desde !== undefined) {
    cursor = Number(desde);
    console.log(`[observacoes] amostra a partir do índice ${cursor} (sem cópia anterior)`);
  } else if (anterior) {
    const copia = await lerCopia(anterior);
    if (copia.meta.leitor === leitor) {
      obs = copia.obs;
      cursor = copia.meta.cursor;
      console.log(`[observacoes] cópia anterior: ${obs.length} linhas, cursor ${cursor} (${copia.meta.geradoEm})`);
    } else {
      console.log(`[observacoes] leitor mudou (${copia.meta.leitor} → ${leitor}): reprocessamento completo`);
    }
  } else {
    console.log(`[observacoes] ${completo ? "--completo" : "sem cópia anterior"}: reprocessamento completo`);
  }

  const c: Contagem = { linhasDoIndice: 0, ignoradas: 0, detalhe: 0, listagem: 0, leiturasDeSerie: 0, erroLeitura: 0, listagemForaDoMolde: 0 };
  const inicio = Date.now();
  while (c.linhasDoIndice < limite) {
    const lote = queryD1<LinhaDoIndice>(sqlDoLote(cursor, Math.min(LOTE, limite - c.linhasDoIndice)));
    if (lote.length === 0) break;
    const uteis = lote.filter((l) => {
      const fonte = fonteDaUrl(l.url);
      return fonte !== null && statusObservavel(fonte, l.status_http);
    });
    const htmls = await emParalelo(uteis, paralelo, async (l) =>
      decodificar.decode(await abridor.abrir({ sha256: l.sha256, formato: (l.formato as never) ?? null, referencia: l.referencia })),
    );
    const leituras: Leitura[] = [];
    uteis.forEach((l, i) => {
      if (fonteDaUrl(l.url) === "detalhe") c.detalhe++;
      else c.listagem++;
      leituras.push(...leiturasDaLinha(l, htmls[i], c));
    });
    c.linhasDoIndice += lote.length;
    c.ignoradas += lote.length - uteis.length;
    c.leiturasDeSerie += leituras.length;
    obs = fundir(obs, leituras);
    cursor = lote[lote.length - 1].id;
    console.log(`[observacoes][andamento] ${c.linhasDoIndice} linhas do índice (cursor ${cursor}), ${obs.length} observações, ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
  }

  const bytes = escreverCopia(obs, { cursor, leitor, entidade: ENTIDADE, geradoEm: new Date().toISOString() });
  if (saida) writeFileSync(saida, bytes);
  else await observacoes.gravar(CHAVE_DA_COPIA, bytes, { "content-type": "application/vnd.apache.parquet" });
  console.log(
    `[observacoes] ${leitor}: ${c.linhasDoIndice} linhas do índice (${c.detalhe} detalhes, ${c.listagem} listagens, ` +
      `${c.ignoradas} sem observação: 5xx ou tipo fora do escopo) → ${c.leiturasDeSerie} leituras de série; ` +
      `${c.erroLeitura} detalhes que o leitor recusou, ${c.listagemForaDoMolde} listagens fora do molde; ` +
      `${obs.length} observações, ${(bytes.length / 1048576).toFixed(2)} MB em Parquet → ${saida ?? `${BALDE_OBSERVACOES}/${CHAVE_DA_COPIA}`}; cursor ${cursor}`,
  );

  // C4 — invariantes sobre o conjunto. A cópia já está gravada: um alerta nunca custa o dado.
  const conhecidas = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "invariantes-conhecidas.json"), "utf8")) as Conhecida[];
  const violacoes = verificarInvariantes(obs);
  const { novas, conhecidas: explicadas } = separarConhecidas(violacoes, conhecidas);
  const relatorio = JSON.stringify({ geradoEm: new Date().toISOString(), leitor, cursor, novas, conhecidas: explicadas }, null, 1);
  if (saida) writeFileSync(saida.replace(/\.parquet$/, "") + "-invariantes.json", relatorio);
  else await observacoes.gravar(CHAVE_DOS_INVARIANTES, new TextEncoder().encode(relatorio), { "content-type": "application/json" });
  const porRegra = (vs: Violacao[]) => [...new Set(vs.map((v) => v.regra))].map((r) => `${r} ${vs.filter((v) => v.regra === r).length}`).join(", ") || "nenhuma";
  console.log(`[observacoes][invariantes] ${violacoes.length} violação(ões): ${novas.length} nova(s) (${porRegra(novas)}), ${explicadas.length} conhecida(s)`);
  for (const v of novas.slice(0, 50)) {
    // Anotação do GitHub: aparece no resumo do run.
    console.log(`::warning title=Invariante ${v.regra}::${v.entidade} ${v.entityId} (${v.fonte}): ${v.detalhe} — páginas ${v.paginas.map((p) => p.slice(0, 12)).join(", ")}`);
  }
  if (novas.length > 0) {
    console.error(`[observacoes][invariantes] violação nova: conferir na fonte e explicar em invariantes-conhecidas.json (chave, motivo, conferidaEm)`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  // Fora de ordem = o índice deixou de crescer junto com o tempo (medido 0 casos em 21/11/2026):
  // nada é gravado, e a causa precisa ser olhada antes de qualquer --completo.
  if (e instanceof ForaDeOrdemError) console.error(`[observacoes] ordem do índice quebrada, nada gravado: ${e.message}`);
  else console.error(`[observacoes] falhou: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
