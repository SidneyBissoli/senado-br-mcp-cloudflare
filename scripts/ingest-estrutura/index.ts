/**
 * Ingestão da estrutura organizacional do Senado Federal (off-Worker, Node via tsx).
 *
 * A API de dados abertos publica apenas unidades de alto nível (a tabela `/servidores/lotacoes`
 * e o endpoint `/gestao/diretores-e-coordenadores` param na altura de Secretaria e não ligam as
 * unidades-folha — serviços/núcleos/coordenações — ao seu superior). O portal institucional, ao
 * contrário, expõe a árvore COMPLETA até o nível de serviço: a página inicial embute os ~200 nós
 * de topo num `<input id="tree_orgaos">` (com sigla e caminho), e cada órgão tem uma página de
 * detalhe `orgaosenado?codorgao=N` que lista os filhos como links `codorgao=…`. Algumas páginas
 * (CONLEG, CONORF…) listam a subárvore SEM links, só por nome e indentação — esses filhos viram
 * nós SINTÉTICOS (cod negativo determinístico), pois são a única publicação dessas unidades.
 *
 * Este crawler faz um BFS a partir da raiz, reconstrói a árvore inteira (cod, nome, superior),
 * retropreenche a sigla a partir do `tree_orgaos` (por código) e da tabela `/servidores/lotacoes`
 * (por nome normalizado), e congela tudo em `src/data/estrutura-organizacional.ts`. Rode-o à mão
 * quando a estrutura mudar:  `npx tsx scripts/ingest-estrutura/index.ts`.
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { normalizarNome } from "../../src/estrutura/normalizar.js";
import type { OrgaoNode } from "../../src/estrutura/tipos.js";

const PORTAL = "https://www12.senado.leg.br/institucional/estrutura";
const PAGINA_ARVORE = `${PORTAL}/estruturaorganizacional`;
const DETALHE = (cod: number) => `${PORTAL}/orgaosenado?codorgao=${cod}`;
const LOTACOES_URL =
  "https://adm.senado.gov.br/adm-dadosabertos/api/v1/servidores/lotacoes";

const CONCURRENCY = 10;
const MAX_NODES = 6000; // trava de segurança contra loop
const MAX_ROUNDS = 20;

const decodeEntities = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

async function fetchText(url: string, tentativas = 3): Promise<string> {
  let ultimoErro: unknown;
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "text/html,application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      ultimoErro = e;
      await new Promise((ok) => setTimeout(ok, 400 * (i + 1)));
    }
  }
  throw ultimoErro;
}

/**
 * Nós de topo embutidos na página inicial (`<input id="tree_orgaos">`): ~197 órgãos de alto nível,
 * cada um já com sigla, nome e superior. Servem de SEMENTE — a página da raiz (cód 47) não lista os
 * topos, então pré-populamos a árvore com esses 197 e crawleamos cada um para descobrir as folhas.
 */
async function lerTopoEmbutido(): Promise<{
  siglaPorCod: Map<number, string>;
  seeds: OrgaoNode[];
}> {
  const html = await fetchText(PAGINA_ARVORE);
  const m = html.match(/id="tree_orgaos"[^>]*value="([\s\S]*?)"\s*\/?>/);
  if (!m) throw new Error("input tree_orgaos não encontrado na página inicial");
  const arr = JSON.parse(decodeEntities(m[1])) as Array<Record<string, unknown>>;
  const flat: Array<Record<string, unknown>> = [];
  (function walk(ns: Array<Record<string, unknown>>) {
    for (const n of ns) {
      flat.push(n);
      if (Array.isArray(n.children)) walk(n.children as Array<Record<string, unknown>>);
    }
  })(arr);
  const siglaPorCod = new Map<number, string>();
  const cods = new Set<number>(flat.map((n) => Number(n.COD_ORGAO)));
  const seeds: OrgaoNode[] = [];
  for (const n of flat) {
    const cod = Number(n.COD_ORGAO);
    const sigla = typeof n.SGL_ORGAO === "string" ? n.SGL_ORGAO : null;
    if (sigla) siglaPorCod.set(cod, sigla);
    const codSuperior = n.COD_SUPERIOR != null ? Number(n.COD_SUPERIOR) : null;
    seeds.push({
      cod,
      sigla,
      nome: typeof n.NOM_ORGAO_CAIXA_BAIXA === "string" ? (n.NOM_ORGAO_CAIXA_BAIXA as string).trim() : "",
      // Superior fora do conjunto (a raiz SF/OSE que a página omite) vira raiz local.
      codSuperior: codSuperior != null && cods.has(codSuperior) ? codSuperior : null,
    });
  }
  return { siglaPorCod, seeds };
}

/** Extrai (nome do nó atual, filhos [cod,nome]) de uma página de detalhe. */
function parseDetalhe(cod: number, html: string): { nome: string; filhos: Array<[number, string]> } {
  const tituloM = html.match(/<title>([\s\S]*?)::/);
  const nome = tituloM ? decodeEntities(tituloM[1]).replace(/\s+/g, " ").trim() : "";
  const filhos: Array<[number, string]> = [];
  const re = /<a[^>]*codorgao=(\d+)[^>]*>([\s\S]*?)<\/a>/g;
  let a: RegExpExecArray | null;
  const vistos = new Set<number>();
  while ((a = re.exec(html))) {
    const c = Number(a[1]);
    if (c === cod || vistos.has(c)) continue;
    const txt = decodeEntities(a[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!txt) continue;
    vistos.add(c);
    filhos.push([c, txt]);
  }
  return { nome, filhos };
}

/**
 * Item da seção "Estrutura" de uma página de detalhe (`<li class="listaInstitucional">`).
 * Algumas páginas (CONLEG cód 49, CONORF cód 1340…) listam a subárvore inteira aqui SEM links
 * `codorgao=` — o item traz só o nome, e a hierarquia vem da indentação (`margin-left` em passos
 * de 25px: 0 = o próprio órgão, 25 = filho, 50 = neto…). É a ÚNICA fonte pública desses nós.
 */
interface ItemEstrutura {
  profundidade: number;
  cod: number | null; // null = item sem link (candidato a nó sintético)
  nome: string;
}

function parseItensEstrutura(html: string): ItemEstrutura[] {
  const out: ItemEstrutura[] = [];
  const re = /<li class="listaInstitucional"([^>]*)>([\s\S]*?)<\/li>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const ml = m[1].match(/margin-left:\s*(\d+)px/);
    const profundidade = ml ? Math.round(Number(ml[1]) / 25) : 0;
    const codM = m[2].match(/codorgao=(\d+)/);
    const nome = decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!nome) continue;
    out.push({ profundidade, cod: codM ? Number(codM[1]) : null, nome });
  }
  return out;
}

/**
 * Código DETERMINÍSTICO para um nó sintético (filho link-less): FNV-1a de `nome|codPai`,
 * mapeado para a faixa NEGATIVA — nunca colide com os códigos reais do portal e não depende
 * da ordem de visita do crawl (preserva a byte-estabilidade do snapshot entre execuções).
 * Nunca vaza para o usuário (as tools expõem apenas sigla/nome).
 */
function codSintetico(nome: string, codPai: number): number {
  const s = `${nome}|${codPai}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return -(h % 0x7fffffff) - 1;
}

async function crawl(): Promise<{ nodes: Map<number, OrgaoNode>; falhas: number; sinteticos: number }> {
  const { siglaPorCod, seeds } = await lerTopoEmbutido();
  console.log(`topo embutido: ${seeds.length} nós semente (${siglaPorCod.size} com sigla)`);

  const nodes = new Map<number, OrgaoNode>();
  // Índice incremental filho-por-nome-normalizado-sob-o-pai: evita duplicar como sintético um
  // filho que a mesma página (ou outra rodada) já registrou com código real.
  const filhoPorNome = new Map<number, Map<string, number>>();
  const registrar = (n: OrgaoNode) => {
    nodes.set(n.cod, n);
    if (n.codSuperior != null) {
      const m = filhoPorNome.get(n.codSuperior) ?? new Map<string, number>();
      const nn = normalizarNome(n.nome);
      if (nn && !m.has(nn)) m.set(nn, n.cod);
      filhoPorNome.set(n.codSuperior, m);
    }
  };
  for (const s of seeds) registrar({ ...s });
  let frontier = seeds.map((s) => s.cod);
  let round = 0;
  let falhas = 0;
  let sinteticos = 0;

  while (frontier.length && nodes.size < MAX_NODES && round < MAX_ROUNDS) {
    round++;
    const proximos: number[] = [];
    for (let i = 0; i < frontier.length; i += CONCURRENCY) {
      const lote = frontier.slice(i, i + CONCURRENCY);
      const paginas = await Promise.all(
        lote.map(async (cod) => {
          try {
            return { cod, html: await fetchText(DETALHE(cod)) };
          } catch {
            falhas++;
            return { cod, html: "" };
          }
        }),
      );
      for (const { cod, html } of paginas) {
        if (!html) continue;
        const { nome, filhos } = parseDetalhe(cod, html);
        const self = nodes.get(cod);
        if (self && !self.nome && nome) self.nome = nome; // nome canônico do título
        for (const [c, txt] of filhos) {
          if (nodes.has(c)) continue; // BFS: 1ª descoberta = superior correto (mais raso)
          registrar({ cod: c, sigla: siglaPorCod.get(c) ?? null, nome: txt, codSuperior: cod });
          proximos.push(c);
        }
        // Filhos SEM link (`<li class="listaInstitucional">` sem codorgao): viram nós sintéticos
        // com pai dado pela indentação. Itens COM link só entram na pilha de pais (a descoberta
        // deles continua sendo a dos links acima — semântica original preservada).
        const pilha: Array<{ profundidade: number; cod: number }> = [{ profundidade: 0, cod }];
        for (const item of parseItensEstrutura(html)) {
          if (item.profundidade === 0) continue; // o próprio órgão (título em negrito)
          while (pilha.length > 1 && pilha[pilha.length - 1].profundidade >= item.profundidade) pilha.pop();
          const codPai = pilha[pilha.length - 1].cod;
          let codItem = item.cod;
          if (codItem == null) {
            const jaExiste = filhoPorNome.get(codPai)?.get(normalizarNome(item.nome));
            if (jaExiste != null) {
              codItem = jaExiste;
            } else {
              codItem = codSintetico(item.nome, codPai);
              const ocupado = nodes.get(codItem);
              if (ocupado) throw new Error(`colisão de cod sintético ${codItem}: "${ocupado.nome}" × "${item.nome}"`);
              registrar({ cod: codItem, sigla: null, nome: item.nome, codSuperior: codPai });
              sinteticos++;
            }
          }
          pilha.push({ profundidade: item.profundidade, cod: codItem });
        }
      }
    }
    frontier = proximos;
    console.log(`round ${round}: total ${nodes.size}, novos ${proximos.length}, falhas acum. ${falhas}`);
  }
  return { nodes, falhas, sinteticos };
}

/** Retropreenche siglas ausentes casando o nome do nó com a tabela /servidores/lotacoes. */
async function backfillSiglas(nodes: Map<number, OrgaoNode>): Promise<number> {
  let preenchidas = 0;
  try {
    const raw = (await (await fetch(LOTACOES_URL, { headers: { accept: "application/json" } })).json()) as unknown;
    const arr = (Array.isArray(raw) ? raw : []) as Array<{ sigla?: string; nome?: string }>;
    const siglaPorNome = new Map<string, string>();
    for (const l of arr) {
      if (l.sigla && l.nome) {
        const k = normalizarNome(l.nome);
        if (k && !siglaPorNome.has(k)) siglaPorNome.set(k, l.sigla.trim());
      }
    }
    for (const n of nodes.values()) {
      if (n.sigla) continue;
      const s = siglaPorNome.get(normalizarNome(n.nome));
      if (s) {
        n.sigla = s;
        preenchidas++;
      }
    }
  } catch (e) {
    console.warn("backfill de siglas falhou (seguindo sem):", (e as Error).message);
  }
  return preenchidas;
}

/** Piso abaixo do qual um crawl é considerado quebrado (soluço de rede), não uma reforma real. */
const PISO_ORGAOS = 400;

/** Lê o snapshot anterior (se existir) para estabilidade byte-a-byte + guarda anti-catástrofe. */
async function lerSnapshotAnterior(out: string): Promise<{ extraidoEm: string; orgaos: OrgaoNode[] } | null> {
  try {
    const txt = await readFile(out, "utf8");
    const m = txt.match(/ESTRUTURA_ORGANIZACIONAL:\s*EstruturaSnapshot\s*=\s*(\{[\s\S]*\});\s*$/);
    if (!m) return null;
    const parsed = JSON.parse(m[1]) as { extraidoEm: string; orgaos: OrgaoNode[] };
    return { extraidoEm: parsed.extraidoEm, orgaos: parsed.orgaos };
  } catch {
    return null;
  }
}

async function main() {
  const t0 = Date.now();
  const here = dirname(fileURLToPath(import.meta.url));
  const out = resolve(here, "../../src/data/estrutura-organizacional.ts");
  const anterior = await lerSnapshotAnterior(out);
  const force = process.env.INGEST_FORCE === "1";

  const { nodes, falhas, sinteticos } = await crawl();
  const preenchidas = await backfillSiglas(nodes);
  const orgaos = [...nodes.values()].sort((a, b) => a.cod - b.cod);
  const comSigla = orgaos.filter((o) => o.sigla).length;

  // Guarda anti-catástrofe: um crawl que encolhe drasticamente (ou fica sob o piso) é quase sempre um
  // soluço de rede no portal, não uma reforma administrativa. Aborta sem sobrescrever (a menos de INGEST_FORCE).
  if (!force && anterior) {
    const encolheuDemais = orgaos.length < Math.floor(anterior.orgaos.length * 0.7);
    if (orgaos.length < PISO_ORGAOS || encolheuDemais) {
      console.error(
        `ABORTADO: crawl retornou ${orgaos.length} órgãos (anterior: ${anterior.orgaos.length}, piso: ${PISO_ORGAOS}). ` +
          `Provável soluço de rede — snapshot NÃO reescrito. Use INGEST_FORCE=1 para forçar.`,
      );
      process.exit(1);
    }
  }

  // Estabilidade byte-a-byte: só bump o carimbo `extraidoEm` quando a árvore de fato muda. Assim,
  // re-rodar sem mudança produz arquivo idêntico (git diff limpo) e a Action não commita/deploya à toa.
  const canonicalNovo = JSON.stringify(orgaos);
  const inalterado = anterior != null && JSON.stringify(anterior.orgaos) === canonicalNovo;
  const extraidoEm = inalterado ? anterior!.extraidoEm : new Date().toISOString();

  const banner =
    "// GERADO por scripts/ingest-estrutura/index.ts — NÃO edite à mão.\n" +
    "// Snapshot da árvore organizacional do Senado (portal institucional), até o nível de serviço.\n" +
    `// Extraído em ${extraidoEm}. Rode \`npm run ingest:estrutura\` para atualizar.\n`;
  const body =
    banner +
    'import type { EstruturaSnapshot } from "../estrutura/tipos.js";\n\n' +
    "export const ESTRUTURA_ORGANIZACIONAL: EstruturaSnapshot = " +
    JSON.stringify(
      { extraidoEm, fonteUrl: `${PORTAL}/orgaosenado`, total: orgaos.length, orgaos },
      null,
      2,
    ) +
    ";\n";
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, body, "utf8");

  console.log("─".repeat(60));
  console.log(`órgãos: ${orgaos.length} (com sigla: ${comSigla}, retropreenchidas: ${preenchidas}, sintéticos: ${sinteticos})`);
  console.log(`falhas de fetch: ${falhas}`);
  console.log(inalterado ? "estrutura INALTERADA (arquivo idêntico — sem commit)" : "estrutura MUDOU (carimbo atualizado)");
  console.log(`escrito em ${out}`);
  console.log(`tempo: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
