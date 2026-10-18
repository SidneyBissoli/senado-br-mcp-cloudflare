/**
 * A3 (ROADMAP): restaura os campos de detalhe das ideias apagados desde 12/10/2026 a partir do
 * `ecidadania_history` — por ideia e por campo, o ÚLTIMO valor não vazio já gravado. Execução única,
 * à mão: `npx tsx scripts/ingest-ecidadania/restaurar-ideias-a3.ts` (simula e grava os .sql em
 * `.a3/`) e, conferido o relatório, o mesmo comando com `--aplicar`.
 *
 * O payload sai do construtor canônico (`registroDetalheIdeia`), com o valor do history no papel de
 * leitura: `mesclarCampo` só preenche o vazio, e os bytes ficam iguais aos dos escritores diários. A
 * escrita é `UPDATE … WHERE content_hash = <lido>` — não há raspagem, então `scraped_at` fica; e uma
 * linha mexida por outro escritor entre a leitura e a escrita é pulada, nunca sobrescrita. O history
 * recebe a versão restaurada no instante da restauração (mantém "último do history = current").
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { queryD1 } from "./d1.js";
import { registroDetalheIdeia, type DetalheIdeiaLido } from "./ideias-registro.js";
import { sqlValue } from "./sql.js";

const CAMPOS = ["autorUf", "dataPublicacao", "descricao", "plConvertido"] as const;
type Campo = (typeof CAMPOS)[number];
const PAGINA = 2000;
const STMTS_POR_ARQUIVO = 5000;

const vazio = (campo: string) => `COALESCE(json_extract(payload_json,'$.${campo}'),'')=''`;
const ultimoNaoVazio = (campo: Campo) =>
  `(SELECT json_extract(h.payload_json,'$.${campo}') FROM ecidadania_history h WHERE h.entidade='ideias' ` +
  `AND h.entity_id=c.entity_id AND COALESCE(json_extract(h.payload_json,'$.${campo}'),'')<>'' ` +
  `ORDER BY h.scraped_at DESC LIMIT 1) AS h_${campo}`;

interface Alvo {
  entity_id: number;
  payload_json: string;
  content_hash: string;
  h_autorUf: string | null;
  h_dataPublicacao: string | null;
  h_descricao: string | null;
  h_plConvertido: string | null;
}

function lerAlvos(): Alvo[] {
  const alvos: Alvo[] = [];
  let depoisDe = 0;
  for (;;) {
    const rows = queryD1<Alvo>(
      `SELECT c.entity_id, c.payload_json, c.content_hash, ${CAMPOS.map(ultimoNaoVazio).join(", ")} ` +
        `FROM ecidadania_current c WHERE c.entidade='ideias' AND c.entity_id > ${depoisDe} ` +
        `AND (${CAMPOS.map((k) => vazio(k).replace("payload_json", "c.payload_json")).join(" OR ")}) ` +
        `ORDER BY c.entity_id LIMIT ${PAGINA}`,
    );
    alvos.push(...rows);
    if (rows.length < PAGINA) return alvos;
    depoisDe = Number(rows[rows.length - 1].entity_id);
  }
}

function main(): void {
  const aplicar = process.argv.includes("--aplicar");
  const agora = new Date().toISOString();
  const alvos = lerAlvos();

  const restaurados: Record<Campo, number> = { autorUf: 0, dataPublicacao: 0, descricao: 0, plConvertido: 0 };
  let identicos = 0;
  let divergentes = 0;
  const linhas: string[] = [];

  for (const a of alvos) {
    const id = Number(a.entity_id);
    // Prova de byte-compatibilidade: reconstruir sem restaurar tem de dar o hash guardado.
    if (registroDetalheIdeia(a.payload_json, id, null).contentHash === a.content_hash) identicos++;
    else divergentes++;

    const prev = JSON.parse(a.payload_json) as Record<string, unknown>;
    const lido: DetalheIdeiaLido = { autorUf: null, dataPublicacao: null, descricao: null, plConvertido: null, proposicoes: null };
    for (const k of CAMPOS) {
      const h = a[`h_${k}`];
      if ((prev[k] ?? "") === "" && h) {
        lido[k] = String(h);
        restaurados[k]++;
      }
    }
    const rec = registroDetalheIdeia(a.payload_json, id, lido);
    if (rec.contentHash === a.content_hash) continue;
    linhas.push(
      `UPDATE ecidadania_current SET payload_json=${sqlValue(rec.payloadJson)}, content_hash=${sqlValue(rec.contentHash)} ` +
        `WHERE entidade='ideias' AND entity_id=${id} AND content_hash=${sqlValue(a.content_hash)};`,
      `INSERT OR IGNORE INTO ecidadania_history (entidade, entity_id, scraped_at, content_hash, payload_json) VALUES (` +
        ["ideias", id, agora, rec.contentHash, rec.payloadJson].map(sqlValue).join(", ") +
        `);`,
    );
  }

  const dir = ".a3";
  mkdirSync(dir, { recursive: true });
  const arquivos: string[] = [];
  for (let i = 0; i < linhas.length; i += STMTS_POR_ARQUIVO) {
    const f = join(dir, `lote-${String(arquivos.length + 1).padStart(2, "0")}.sql`);
    writeFileSync(f, linhas.slice(i, i + STMTS_POR_ARQUIVO).join("\n") + "\n");
    arquivos.push(f);
  }

  console.log(`[a3] alvos (algum campo vazio): ${alvos.length}`);
  console.log(`[a3] reconstrução sem restaurar = hash guardado: ${identicos} (divergentes: ${divergentes})`);
  console.log(`[a3] campos restaurados: ${JSON.stringify(restaurados)}`);
  console.log(`[a3] ideias a gravar: ${linhas.length / 2} em ${arquivos.length} arquivo(s) em ${dir}/ (instante ${agora})`);
  if (divergentes > 0) {
    console.error("[a3] ABORTADO: o construtor não reproduz o payload guardado — a escrita reescreveria bytes além dos campos restaurados.");
    process.exit(2);
  }
  if (!aplicar) {
    console.log("[a3] simulação: nada gravado. Repetir com --aplicar.");
    return;
  }
  for (const f of arquivos) {
    console.log(`[a3] aplicando ${f}`);
    execSync(`npx --no-install wrangler d1 execute senado-ecidadania --remote --yes --file=${f}`, { stdio: "inherit" });
  }
  console.log("[a3] aplicado.");
}

main();
