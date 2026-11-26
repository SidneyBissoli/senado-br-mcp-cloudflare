/**
 * D3 — projeta no D1 as tabelas da camada 3 que o servidor lê (`TABELAS_C3`), gravando só o que mudou
 * desde a última projeção aplicada (núcleo e regras em `projecao.ts`).
 *
 *   npx tsx scripts/publicacao/projetar-d1.ts [--local] [--seco <pasta>] [--completo] [--tabelas a,b]
 *
 * Lê do balde `ecidadania-observacoes` as tabelas (as mesmas chaves do pacote, `chaveNoBalde`) e os
 * retratos (`projecao-d1/<tabela>.parquet`). `--local` = pelo wrangler (login do dono); senão pelas
 * credenciais S3 do job. `--seco <pasta>` grava o SQL na pasta e NÃO aplica nem regrava retrato (para
 * medir). `--completo` ignora os retratos (refaz as tabelas). `--tabelas` = caminhos do dicionário.
 *
 * Roda no job das observações, depois do reprocessamento (passo próprio do workflow). Tabela que falha
 * para o run com erro; as anteriores ficam aplicadas e com retrato novo.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parquetMetadata, parquetReadObjects } from "hyparquet";
import { applyD1File } from "../ingest-ecidadania/d1.js";
import { criarClienteR2, type ClienteR2 } from "../ingest-ecidadania/r2.js";
import { escreverTabela } from "../observacoes/parquet.js";
import { BALDE_OBSERVACOES } from "../observacoes/linhas.js";
import { clienteWrangler } from "../observacoes/wrangler-r2.js";
import { chaveNoBalde } from "./pacote.js";
import { esquemaDe, filtrar, planejar, somenteCom, PROJETADAS, projetarLinhas, type LinhaProjetada, type TabelaProjetada } from "./projecao.js";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function balde(): ClienteR2 {
  if (process.argv.includes("--local")) return clienteWrangler(BALDE_OBSERVACOES);
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const accessKeyId = process.env.OBSERVACOES_R2_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.OBSERVACOES_R2_SECRET_ACCESS_KEY ?? "";
  if (!accountId || !accessKeyId || !secretAccessKey) throw new Error("faltam as credenciais do balde no ambiente (ou use --local)");
  return criarClienteR2({ accountId, bucket: BALDE_OBSERVACOES, cred: { accessKeyId, secretAccessKey } });
}

const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const chaveDoRetrato = (t: TabelaProjetada) => `projecao-d1/${t.tabela}.parquet`;

/** O retrato da última projeção aplicada, se ainda vale para a DDL atual. */
async function lerRetrato(b: ClienteR2, t: TabelaProjetada): Promise<Map<string, string> | null> {
  const bytes = await b.ler(chaveDoRetrato(t));
  if (!bytes) return null;
  const ab = buf(bytes);
  const kv = new Map((parquetMetadata(ab).key_value_metadata ?? []).map((e) => [e.key, e.value ?? ""]));
  if (kv.get("esquema") !== esquemaDe(t)) {
    console.log(`[projecao][${t.caminho}] retrato de outra DDL (${kv.get("esquema")} ≠ ${esquemaDe(t)}): a tabela será refeita`);
    return null;
  }
  const rs = (await parquetReadObjects({ file: ab })) as Array<{ chave: string; hash: string }>;
  return new Map(rs.map((r) => [r.chave, r.hash]));
}

function retratoEmParquet(t: TabelaProjetada, linhas: readonly LinhaProjetada[], geradoEm: string | null): Uint8Array {
  return escreverTabela(
    linhas,
    [
      { nome: "chave", tipo: "texto", valor: (l) => l.chave },
      { nome: "hash", tipo: "texto", valor: (l) => l.hash },
    ],
    { tabela: t.tabela, esquema: esquemaDe(t), geradoEm: geradoEm ?? "" },
  );
}

async function projetar(b: ClienteR2, t: TabelaProjetada, o: { seco?: string; completo: boolean; aplicadoEm: string }): Promise<void> {
  const inicio = Date.now();
  const bytes = await b.ler(chaveNoBalde(t.dic));
  if (!bytes) throw new Error(`tabela ausente no balde: ${chaveNoBalde(t.dic)}`);
  const ab = buf(bytes);
  const meta = parquetMetadata(ab);
  const nomes = meta.schema.slice(1).map((s) => s.name);
  const esperados = t.dic.colunas.map((c) => c.nome);
  if (nomes.join(",") !== esperados.join(",")) throw new Error(`${t.caminho}: colunas ${nomes.join(",")} ≠ dicionário ${esperados.join(",")}`);
  const geradoEm = (meta.key_value_metadata ?? []).find((e) => e.key === "geradoEm")?.value ?? null;
  let brutas = filtrar(t, (await parquetReadObjects({ file: ab })) as Record<string, unknown>[]);
  if (t.somenteCom) {
    // A tabela de referência, com o filtro DELA: as mesmas linhas que a projeção dela leva ao D1.
    const ref = PROJETADAS.find((x) => x.caminho === t.somenteCom!.de)!;
    const rb = await b.ler(chaveNoBalde(ref.dic));
    if (!rb) throw new Error(`tabela ausente no balde: ${chaveNoBalde(ref.dic)}`);
    brutas = somenteCom(t, brutas, filtrar(ref, (await parquetReadObjects({ file: buf(rb) })) as Record<string, unknown>[]));
  }
  const linhas = projetarLinhas(t, brutas);
  const retrato = o.completo ? null : await lerRetrato(b, t);
  const plano = planejar(t, linhas, retrato, { geradoEm, aplicadoEm: o.aplicadoEm });
  const sqlBytes = plano.arquivos.reduce((s, a) => s + Buffer.byteLength(a), 0);
  const resumo =
    `${linhas.length} linhas; ${plano.completa ? "CARGA COMPLETA" : "incremental"}: ${plano.gravadas} gravadas, ${plano.removidas} removidas; ` +
    `${plano.arquivos.length} arquivo(s), ${(sqlBytes / 1048576).toFixed(2)} MB de SQL`;

  const dir = o.seco ?? mkdtempSync(join(tmpdir(), "c3-"));
  mkdirSync(dir, { recursive: true });
  const paths = plano.arquivos.map((sql, i) => {
    const p = join(dir, `${t.tabela}-${String(i + 1).padStart(3, "0")}.sql`);
    writeFileSync(p, sql);
    return p;
  });
  if (o.seco) {
    console.log(`[projecao][${t.caminho}] (seco) ${resumo} → ${dir}`);
    return;
  }
  for (const p of paths) applyD1File(p);
  // Só depois de TODO o SQL aplicado: o retrato descreve o que o D1 tem agora.
  await b.gravar(chaveDoRetrato(t), retratoEmParquet(t, linhas, geradoEm), { "content-type": "application/vnd.apache.parquet" });
  console.log(`[projecao][${t.caminho}] ${resumo}; aplicado em ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
}

async function main(): Promise<void> {
  const seco = arg("--seco");
  const filtro = arg("--tabelas")?.split(",");
  const b = balde();
  const aplicadoEm = new Date().toISOString();
  for (const t of PROJETADAS) {
    if (filtro && !filtro.includes(t.caminho)) continue;
    await projetar(b, t, { seco, completo: process.argv.includes("--completo"), aplicadoEm });
  }
}

main().catch((e) => {
  console.error(`::error title=Projeção da camada 3 no D1::${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
