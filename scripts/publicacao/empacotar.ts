/**
 * D2 — empacota o dataset 3.0.0: lê as tabelas da camada 3 (balde `ecidadania-observacoes`, ou uma
 * pasta local que espelhe as chaves do balde), grava cada uma em Parquet (os bytes como estão) e em
 * CSV (`pacote.ts`), e escreve o `datapackage.json` e o `dicionario.md` gerados do dicionário.
 *
 *   npx tsx scripts/publicacao/empacotar.ts [--de <pasta>] [--local] [--saida <pasta>]
 *
 * Sem `--de`, lê do balde: `--local` pelo wrangler (login do dono); senão pelas credenciais S3 do job
 * (CLOUDFLARE_ACCOUNT_ID, OBSERVACOES_R2_ACCESS_KEY_ID, OBSERVACOES_R2_SECRET_ACCESS_KEY). Saída
 * padrão: `dataset/3.0.0/`. Não grava nada no balde. Tabela ausente = erro (o pacote sai inteiro ou
 * não sai).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parquetMetadata, parquetReadObjects } from "hyparquet";
import { criarClienteR2, type ClienteR2 } from "../ingest-ecidadania/r2.js";
import { BALDE_OBSERVACOES } from "../observacoes/linhas.js";
import { clienteWrangler } from "../observacoes/wrangler-r2.js";
import { DICIONARIO, ESQUEMA_V3, dicionarioMarkdown } from "./dicionario.js";
import { chaveNoBalde, manifesto, paraCsv, type Contagem } from "./pacote.js";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function balde(): ClienteR2 {
  if (process.argv.includes("--local")) return clienteWrangler(BALDE_OBSERVACOES);
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const accessKeyId = process.env.OBSERVACOES_R2_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.OBSERVACOES_R2_SECRET_ACCESS_KEY ?? "";
  if (!accountId || !accessKeyId || !secretAccessKey) throw new Error("faltam as credenciais do balde no ambiente (ou use --local ou --de)");
  return criarClienteR2({ accountId, bucket: BALDE_OBSERVACOES, cred: { accessKeyId, secretAccessKey } });
}

async function main(): Promise<void> {
  const de = arg("--de");
  const saida = arg("--saida") ?? join("dataset", ESQUEMA_V3);
  const fonte = de ? null : balde();
  const contagens: Contagem[] = [];
  for (const t of DICIONARIO) {
    const chave = chaveNoBalde(t);
    const bytes = de ? new Uint8Array(readFileSync(join(de, chave))) : await fonte!.ler(chave);
    if (!bytes) throw new Error(`tabela ausente no balde: ${chave}`);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    // O Parquet tem de trazer exatamente as colunas do dicionário (o teste do dicionário amarra o
    // gravador; isto pega uma tabela velha no balde, gravada antes de uma mudança de colunas).
    const nomes = parquetMetadata(ab).schema.slice(1).map((s) => s.name);
    const esperados = t.colunas.map((c) => c.nome);
    if (nomes.join(",") !== esperados.join(",")) throw new Error(`${chave}: colunas ${nomes.join(",")} ≠ dicionário ${esperados.join(",")}`);
    const linhas = (await parquetReadObjects({ file: ab })) as Record<string, unknown>[];
    const csv = new TextEncoder().encode(paraCsv(linhas, t));
    const base = join(saida, t.caminho);
    mkdirSync(dirname(base), { recursive: true });
    writeFileSync(`${base}.parquet`, bytes);
    writeFileSync(`${base}.csv`, csv);
    contagens.push({ caminho: t.caminho, linhas: linhas.length, bytesCsv: csv.length, bytesParquet: bytes.length });
    console.log(`[pacote] ${t.caminho}: ${linhas.length} linhas, CSV ${(csv.length / 1048576).toFixed(2)} MB, Parquet ${(bytes.length / 1048576).toFixed(2)} MB`);
  }
  writeFileSync(join(saida, "datapackage.json"), JSON.stringify(manifesto(contagens, new Date().toISOString()), null, 2) + "\n");
  writeFileSync(join(saida, "dicionario.md"), dicionarioMarkdown());
  console.log(`[pacote] ${contagens.length} tabelas + datapackage.json + dicionario.md em ${saida}`);
}

main().catch((e) => {
  console.error(`[pacote] falhou: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
