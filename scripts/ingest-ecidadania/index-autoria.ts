/**
 * Coletor da autoria oficial das matérias — E1.b do ROADMAP (runs OFF-Worker, GitHub Action no runner
 * `ecidadania`). Desenho e fila em `autoria.ts`.
 *
 *   1. Lê a fila: ids das consultas e do acervo (corpus `ecidadania_current`) e os links das proposições
 *      das ideias (`c3_ideias_proposicoes`), menos as matérias já em `ecidadania_autoria_estado`.
 *   2. Para cada matéria da fatia (`INGEST_AUTORIA_CHUNK`): Senado = lista + detalhe de cada processo;
 *      Câmara = autores. Toda resposta passa pelo arquivo bruto ANTES de ser lida (regra "arquivo
 *      primeiro"; o observador de `http.ts` grava cada uma), com pausa entre chamadas.
 *   3. Matéria lida inteira → linha de estado. A cada `LOTE` matérias: descarrega o índice do arquivo e
 *      SÓ DEPOIS grava o lote de estados. Falha de uma matéria não grava estado: volta no run seguinte.
 *   4. Disjuntor: falhas de transporte seguidas param o run (fonte fora), com o que já foi gravado.
 *
 * Nada aqui escreve no corpus nem nas tabelas publicadas: quem lê as respostas é a E1.c, do arquivo.
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getJson, sleep, HttpError } from "./http.js";
import { criarDisjuntor, PortalForaError } from "./breaker.js";
import { queryD1, gravarEAplicarLote } from "./d1.js";
import { ligarArquivo } from "./arquivo-run.js";
import {
  chaveDoAlvo, conferirAutoresDaCamara, conferirDetalheDoProcesso, estadoStmt, filaDaAutoria, idsDaListaDeProcessos,
  type Alvo, type SituacaoAutoria,
} from "./autoria.js";

const JOB = "autoria";
const SENADO = process.env.SENADO_BASE_URL || "https://legis.senado.leg.br/dadosabertos";
const CAMARA = "https://dadosabertos.camara.leg.br/api/v2";
const CHUNK = Number(process.env.INGEST_AUTORIA_CHUNK) || 1500;
const DELAY_MS = Number(process.env.INGEST_AUTORIA_DELAY_MS) || 500;
const LOTE = 50;
const OUT_DIR = dirname(fileURLToPath(import.meta.url));

const ehNaoEncontrada = (e: unknown) => e instanceof HttpError && e.status === 404;

/** Lê uma matéria inteira; devolve a situação e os processos, ou lança (matéria não marcada). */
async function lerMateria(a: Alvo): Promise<{ situacao: SituacaoAutoria; processos: number[] | null }> {
  if (a.casa === "CD") {
    try {
      conferirAutoresDaCamara(await getJson(`${CAMARA}/proposicoes/${a.codigo}/autores`), a.codigo);
    } catch (e) {
      if (ehNaoEncontrada(e)) return { situacao: "nao-encontrada", processos: null };
      throw e;
    }
    return { situacao: "lida", processos: null };
  }
  let ids: number[];
  try {
    ids = idsDaListaDeProcessos(await getJson(`${SENADO}/processo?codigoMateria=${a.codigo}`), a.codigo);
  } catch (e) {
    if (ehNaoEncontrada(e)) return { situacao: "nao-encontrada", processos: null };
    throw e;
  }
  if (ids.length === 0) return { situacao: "sem-processo", processos: [] };
  for (const id of ids) {
    await sleep(DELAY_MS);
    conferirDetalheDoProcesso(await getJson(`${SENADO}/processo/${id}`), id);
  }
  return { situacao: "lida", processos: ids };
}

async function main(): Promise<number> {
  const arquivo = ligarArquivo({ job: JOB, entidade: JOB, outDir: OUT_DIR });
  if (!arquivo.ligado) {
    // A E1.c lê a autoria do ARQUIVO: marcar matéria como lida sem guardar a resposta a perderia de vez.
    console.error(`::error title=Autoria::arquivo bruto desligado — o coletor da autoria não roda sem ele`);
    return 1;
  }
  try {
    return await coletar(arquivo);
  } finally {
    // Todo caminho de saída descarrega o índice pendente (idempotente se já fechado).
    await arquivo.fechar();
  }
}

async function coletar(arquivo: ReturnType<typeof ligarArquivo>): Promise<number> {
  const leitor = `${JOB}@${(process.env.GITHUB_SHA ?? "local").slice(0, 7)}`;

  const consultas = queryD1<{ id: number }>("SELECT entity_id AS id FROM ecidadania_current WHERE entidade = 'consultas' ORDER BY entity_id").map((r) => r.id);
  const acervo = queryD1<{ id: number }>("SELECT entity_id AS id FROM ecidadania_current WHERE entidade = 'consultas_votos' ORDER BY entity_id").map((r) => r.id);
  let linksDasIdeias: (string | null)[] = [];
  try {
    linksDasIdeias = queryD1<{ url: string | null }>("SELECT DISTINCT url FROM c3_ideias_proposicoes ORDER BY url").map((r) => r.url);
  } catch (e) {
    // A camada 3 é do job das observações e pode estar sendo refeita: as ideias ficam para o próximo run.
    console.warn(`::warning title=Autoria::proposições das ideias indisponíveis neste run: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }
  const feitas = new Set(
    queryD1<{ casa: "SF" | "CD"; codigo: number }>("SELECT casa, codigo FROM ecidadania_autoria_estado").map(chaveDoAlvo),
  );
  const { fila, pendentes } = filaDaAutoria({ consultas, linksDasIdeias, acervo }, feitas, CHUNK);
  console.log(
    `[${JOB}] fontes: ${consultas.length} consultas, ${linksDasIdeias.length} links de proposições das ideias, ${acervo.length} matérias do acervo; ` +
      `${feitas.size} já lidas; ${pendentes} pendentes; esta fatia: ${fila.length} (teto ${CHUNK}, pausa ${DELAY_MS} ms)`,
  );

  const disjuntor = criarDisjuntor();
  const seq = { n: 0 };
  let lote: string[] = [];
  const contagem: Record<string, number> = {};
  const falhas: string[] = [];
  const gravarLote = async () => {
    if (lote.length === 0) return;
    await arquivo.descarregar();
    gravarEAplicarLote(OUT_DIR, "out-autoria-estado-", [lote.join("\n")], seq);
    lote = [];
  };

  let codigo = 0;
  try {
    for (const [i, a] of fila.entries()) {
      if (i > 0) await sleep(DELAY_MS);
      try {
        const r = await lerMateria(a);
        disjuntor.sucesso();
        lote.push(estadoStmt(a, r.situacao, r.processos, new Date().toISOString(), leitor));
        const k = `${a.origem}/${a.casa}/${r.situacao}`;
        contagem[k] = (contagem[k] ?? 0) + 1;
      } catch (e) {
        if (e instanceof PortalForaError) throw e;
        falhas.push(`${chaveDoAlvo(a)}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
        disjuntor.falha(e, chaveDoAlvo(a));
      }
      if (lote.length >= LOTE) {
        await gravarLote();
        console.log(`[${JOB}][andamento] ${i + 1}/${fila.length} matérias; ${falhas.length} falha(s)`);
      }
    }
  } catch (e) {
    if (!(e instanceof PortalForaError)) throw e;
    console.error(`::error title=Autoria::fonte fora — ${e.seguidas} falhas de transporte seguidas (última em ${e.onde}: ${e.ultimoMotivo}); o que já foi lido está gravado`);
    codigo = 1;
  }
  await gravarLote();

  console.log(`[${JOB}] resultado: ${JSON.stringify(contagem)}`);
  if (falhas.length) {
    console.warn(`::warning title=Autoria::${falhas.length} matéria(s) não lida(s), voltam no próximo run`);
    for (const f of falhas.slice(0, 30)) console.warn(`[${JOB}][falha] ${f}`);
  }
  return codigo;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(`[${JOB}] erro: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    process.exit(1);
  },
);
