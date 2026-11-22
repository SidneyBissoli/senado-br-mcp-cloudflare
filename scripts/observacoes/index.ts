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
 * (amostra a partir da linha N do índice, sem cópia anterior; exige `--saida`), `--sem-series` (pula a C3).
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
import { gravarSeries } from "./series-run.js";
import { ENTIDADES_C5, decodificarC5, fonteC5, leiturasC5, sqlDoLoteC5, statusObservavelC5, versaoDoLeitorC5, type ContagemC5 } from "./fatos-c5.js";
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

interface ConfigDaEntidade {
  entidade: string;
  chave: string;
  leitor: string;
  sql: (cursor: number, lote: number) => string;
  /** Fonte da página, ou null quando a linha não vira observação (tipo fora do escopo ou 5xx). */
  fonte: (l: LinhaDoIndice) => string | null;
  leituras: (l: LinhaDoIndice, bytes: Uint8Array) => Leitura[];
}

interface Opcoes {
  completo: boolean;
  limite: number;
  paralelo: number;
  saida?: string;
  desde?: string;
}

/** O laço incremental comum: cópia anterior → lotes do índice → páginas → fatos → fusão → cópia. */
async function reprocessar(cfg: ConfigDaEntidade, o: Opcoes, abridor: AbridorDePaginas, balde: ClienteR2): Promise<{ obs: Observacao[]; cursor: number }> {
  const rotulo = `[observacoes][${cfg.entidade}]`;
  let obs: Observacao[] = [];
  let cursor = 0;
  // Amostra a partir de um ponto do índice: só para conferência, nunca vira a cópia do balde.
  if (o.desde !== undefined && !o.saida) throw new Error("--desde exige --saida (amostra não substitui a cópia)");
  const anterior = o.completo || o.desde !== undefined ? null : await balde.ler(cfg.chave);
  if (o.desde !== undefined) {
    cursor = Number(o.desde);
    console.log(`${rotulo} amostra a partir do índice ${cursor} (sem cópia anterior)`);
  } else if (anterior) {
    const copia = await lerCopia(anterior);
    if (copia.meta.leitor === cfg.leitor) {
      obs = copia.obs;
      cursor = copia.meta.cursor;
      console.log(`${rotulo} cópia anterior: ${obs.length} linhas, cursor ${cursor} (${copia.meta.geradoEm})`);
    } else {
      console.log(`${rotulo} leitor mudou (${copia.meta.leitor} → ${cfg.leitor}): reprocessamento completo`);
    }
  } else {
    console.log(`${rotulo} ${o.completo ? "--completo" : "sem cópia anterior"}: reprocessamento completo`);
  }

  const porFonte = new Map<string, number>();
  let linhas = 0;
  let ignoradas = 0;
  let leiturasDeSerie = 0;
  const inicio = Date.now();
  while (linhas < o.limite) {
    const lote = queryD1<LinhaDoIndice>(cfg.sql(cursor, Math.min(LOTE, o.limite - linhas)));
    if (lote.length === 0) break;
    const uteis = lote.filter((l) => cfg.fonte(l) !== null);
    const paginas = await emParalelo(uteis, o.paralelo, (l) => abridor.abrir({ sha256: l.sha256, formato: (l.formato as never) ?? null, referencia: l.referencia }));
    const leituras: Leitura[] = [];
    uteis.forEach((l, i) => {
      const f = cfg.fonte(l)!;
      porFonte.set(f, (porFonte.get(f) ?? 0) + 1);
      leituras.push(...cfg.leituras(l, paginas[i]));
    });
    linhas += lote.length;
    ignoradas += lote.length - uteis.length;
    leiturasDeSerie += leituras.length;
    obs = fundir(obs, leituras);
    cursor = lote[lote.length - 1].id;
    console.log(`${rotulo}[andamento] ${linhas} linhas do índice (cursor ${cursor}), ${obs.length} observações, ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
  }

  const bytes = escreverCopia(obs, { cursor, leitor: cfg.leitor, entidade: cfg.entidade, geradoEm: new Date().toISOString() });
  const destino = o.saida ? (cfg.entidade === ENTIDADE ? o.saida : o.saida.replace(/\.parquet$/, "") + `-${cfg.entidade}.parquet`) : `${BALDE_OBSERVACOES}/${cfg.chave}`;
  if (o.saida) writeFileSync(destino, bytes);
  else await balde.gravar(cfg.chave, bytes, { "content-type": "application/vnd.apache.parquet" });
  const fontes = [...porFonte].map(([f, n]) => `${n} ${f}`).join(", ") || "nenhuma página";
  console.log(
    `${rotulo} ${cfg.leitor}: ${linhas} linhas do índice (${fontes}; ${ignoradas} sem observação: 5xx ou tipo fora do escopo) → ` +
      `${leiturasDeSerie} leituras de série; ${obs.length} observações, ${(bytes.length / 1048576).toFixed(2)} MB em Parquet → ${destino}; cursor ${cursor}`,
  );
  return { obs, cursor };
}

async function main(): Promise<void> {
  const o: Opcoes = {
    completo: process.argv.includes("--completo"),
    limite: arg("--limite") ? Number(arg("--limite")) : Infinity,
    paralelo: Number(arg("--paralelo") ?? 16),
    saida: arg("--saida"),
    desde: arg("--desde"),
  };
  const entidades = (arg("--entidades") ?? [ENTIDADE, ...ENTIDADES_C5].join(",")).split(",");
  const saida = o.saida;
  // As páginas desde 15/11/2026 estão em zstd com dicionário: sem Node ≥ 24.6 para aqui, não lê lixo.
  autoprovaZstd();
  const { arquivo, observacoes } = clientes(process.argv.includes("--local"));
  const abridor = new AbridorDePaginas(arquivo);
  const utf8 = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

  // C5 primeiro? Não: ideias primeiro, porque C3/C4 dependem delas e é a série mais antiga.
  let falhouInvariante = false;
  if (entidades.includes(ENTIDADE)) {
    const c: Contagem = { linhasDoIndice: 0, ignoradas: 0, detalhe: 0, listagem: 0, leiturasDeSerie: 0, erroLeitura: 0, listagemForaDoMolde: 0 };
    const leitor = versaoDoLeitor();
    const { obs, cursor } = await reprocessar({
      entidade: ENTIDADE, chave: CHAVE_DA_COPIA, leitor, sql: sqlDoLote,
      fonte: (l) => {
        const f = fonteDaUrl(l.url);
        return f !== null && statusObservavel(f, l.status_http) ? f : null;
      },
      leituras: (l, bytes) => leiturasDaLinha(l, utf8.decode(bytes), c),
    }, o, abridor, observacoes);
    console.log(`[observacoes][${ENTIDADE}] ${c.erroLeitura} detalhes que o leitor recusou, ${c.listagemForaDoMolde} listagens fora do molde`);
    falhouInvariante = await invariantesESeries(obs, cursor, leitor, observacoes, saida);
  }

  for (const entidade of ENTIDADES_C5) {
    if (!entidades.includes(entidade)) continue;
    const c: ContagemC5 = { foraDoMolde: 0 };
    await reprocessar({
      entidade, chave: `${entidade}/observacoes.parquet`, leitor: versaoDoLeitorC5(entidade),
      sql: (cursor, lote) => sqlDoLoteC5(entidade, cursor, lote),
      fonte: (l) => {
        const f = fonteC5(entidade, l.url);
        return f !== null && statusObservavelC5(f, l.status_http) ? f : null;
      },
      leituras: (l, bytes) => leiturasC5(entidade, l, decodificarC5(fonteC5(entidade, l.url)!, bytes), c),
    }, o, abridor, observacoes);
    console.log(`[observacoes][${entidade}] ${c.foraDoMolde} página(s) que o leitor recusou`);
  }
  if (falhouInvariante) process.exitCode = 1;
}

/** C4 e C3 das ideias, depois de a cópia estar gravada. Devolve true se há violação nova. */
async function invariantesESeries(obs: Observacao[], cursor: number, leitor: string, observacoes: ClienteR2, saida?: string): Promise<boolean> {
  // C4 — invariantes sobre o conjunto. A cópia já está gravada: um alerta nunca custa o dado.
  const conhecidas = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "invariantes-conhecidas.json"), "utf8")) as Conhecida[];
  const violacoes = verificarInvariantes(obs);
  const { novas, conhecidas: explicadas, semAlerta } = separarConhecidas(violacoes, conhecidas);
  const relatorio = JSON.stringify({ geradoEm: new Date().toISOString(), leitor, cursor, novas, conhecidas: explicadas, semAlerta }, null, 1);
  if (saida) writeFileSync(saida.replace(/\.parquet$/, "") + "-invariantes.json", relatorio);
  else await observacoes.gravar(CHAVE_DOS_INVARIANTES, new TextEncoder().encode(relatorio), { "content-type": "application/json" });
  const porRegra = (vs: Violacao[]) => [...new Set(vs.map((v) => v.regra))].map((r) => `${r} ${vs.filter((v) => v.regra === r).length}`).join(", ") || "nenhuma";
  console.log(`[observacoes][invariantes] ${violacoes.length} violação(ões): ${novas.length} nova(s) (${porRegra(novas)}), ${explicadas.length} conhecida(s), ${semAlerta.filter((v) => v.tipo === "transitoria").length} queda(s) transitória(s) e ${semAlerta.filter((v) => v.tipo === "pendente").length} pendente(s) sem alerta`);
  for (const v of novas.slice(0, 50)) {
    // Anotação do GitHub: aparece no resumo do run.
    console.log(`::warning title=Invariante ${v.regra}::${v.entidade} ${v.entityId} (${v.fonte}): ${v.detalhe} — páginas ${v.paginas.map((p) => p.slice(0, 12)).join(", ")}`);
  }
  // C3 — séries de apoios e de situação (arquivo + corpus), refeitas inteiras.
  if (!process.argv.includes("--sem-series")) await gravarSeries({ obs, leitor, cursor, balde: observacoes, saida });

  if (novas.length > 0) console.error(`[observacoes][invariantes] violação nova: conferir na fonte e explicar em invariantes-conhecidas.json (chave, motivo, conferidaEm)`);
  return novas.length > 0;
}

main().catch((e) => {
  // Fora de ordem = o índice deixou de crescer junto com o tempo (medido 0 casos em 21/11/2026):
  // nada é gravado, e a causa precisa ser olhada antes de qualquer --completo.
  if (e instanceof ForaDeOrdemError) console.error(`[observacoes] ordem do índice quebrada, nada gravado: ${e.message}`);
  else console.error(`[observacoes] falhou: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
