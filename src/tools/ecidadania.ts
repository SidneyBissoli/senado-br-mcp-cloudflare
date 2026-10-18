/**
 * Group G — e-Cidadania (9 tools)
 *
 * Data acquisition + normalization now lives in src/scraper/ecidadania.ts (isolated boundary,
 * fixture-tested). This module only registers the MCP tools over those scraper functions, with
 * caching and error shaping.
 *
 * Consolidações v3: consultas_consensuais + consultas_polarizadas → consultas_analise
 * (enum `modo`); os rankings ideias_populares / eventos_populares viram `ordenarPor`
 * nos respectivos listar_*.
 */

import type { SenadoToolHost } from "../tool-host.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { errorFrom } from "../utils/validation.js";
import {
  leituraDoCache,
  provenanceEcidadania,
  NOTA_DERIVACAO_DATA_ESTIMADA,
  NOTA_DERIVACAO_PERCENTUAIS,
  NOTA_DERIVACAO_RANKING_ECIDADANIA,
  NOTA_DERIVACAO_SOMAS,
  NOTA_DERIVACAO_STATUS_IDEIA,
  derivado,
  derivadoSe,
  provenanceArquimedesVotos,
  resultWithProvenance,
  withFieldSources,
  type FieldSource,
  type Provenance,
} from "../utils/provenance.js";
import { tagUntrustedFields, tagUntrustedList, neutralizeUntrustedText, sanitizeScrapedText } from "../utils/untrusted.js";
import { CACHE_ON_DEMAND } from "../types.js";
import type { Env } from "../types.js";
import { readCurrentStatus, resolveList, writeDetalheThrough } from "../scraper/store.js";
import { apoiosPublicados, detalheParaCorpus, statusDaLinhaDoTempo, type IdeiaDetalhe } from "../scraper/ideia-detalhe.js";
import {
  ECIDADANIA_BASE,
  parseBrNum,
  extractId,
  normalizeEcidadaniaUrl,
  stripHtml,
  extractDate,
  extractTime,
  buildConsultaResumo,
  listarConsultasInternal,
  obterConsultaInternal,
  listarIdeiasInternal,
  obterIdeiaInternal,
  listarEventosInternal,
  obterEventoInternal,
  estimarCriacaoIdeia,
  AVISO_DATAS_IDEIA,
  AVISO_DATAS_IDEIA_DETALHE,
  IDEIA_PRAZO_APOIOS_DIAS,
  type ConsultaResumo,
  type IdeiaResumo,
  type EventoResumo,
  type ConsultaVotoResumo,
} from "../scraper/ecidadania.js";

// Re-export the scraper's pure/IO helpers so existing unit tests keep importing them from here.
export {
  estimarCriacaoIdeia,
  AVISO_DATAS_IDEIA,
  AVISO_DATAS_IDEIA_DETALHE,
  IDEIA_PRAZO_APOIOS_DIAS,
  ECIDADANIA_BASE,
  parseBrNum,
  extractId,
  normalizeEcidadaniaUrl,
  stripHtml,
  extractDate,
  extractTime,
  buildConsultaResumo,
  listarConsultasInternal,
  obterConsultaInternal,
  listarIdeiasInternal,
  obterIdeiaInternal,
  listarEventosInternal,
  obterEventoInternal,
};

/** Format an integer with pt-BR thousands separators ("253804" → "253.804").
 *  Avoids toLocaleString, whose Intl data is not guaranteed on Workers (OBS-12). */
export function formatIntBR(n: number): string {
  return Math.trunc(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Aviso fixo do detalhe da consulta pública. A página `visualizacaomateria`
 * não publica o período da consulta em lugar nenhum (verificado ao vivo em
 * 15/07/2026: a única data é o carimbo "Votos apurados até…"), então
 * `dataAbertura`/`dataEncerramento` — e também `comissao`/`linkMateria` —
 * vêm sempre null desta fonte. A consulta abre quando a matéria entra em
 * tramitação e encerra quando sai, o que se reflete em `status`.
 */
export const OBTER_CONSULTA_DATAS_AVISO =
  "O portal e-Cidadania não publica o período da consulta: dataAbertura/dataEncerramento " +
  "(e também comissao/linkMateria) vêm sempre null. A consulta abre quando a matéria entra " +
  "em tramitação e encerra quando sai — o campo `status` reflete essa situação.";

/**
 * Monta o payload de resposta de `senado_ecidadania_obter_consulta` a partir do
 * detalhe raspado, SEM alterar o objeto gravado no write-through do corpus
 * (o aviso e o comentarios null são só da resposta; mudar o payload persistido
 * mudaria o contentHash de todas as linhas de ecidadania_detalhe).
 * OBS-9: a página de consulta não tem recurso de comentários — o 0 raspado é
 * espúrio; serve null (indisponível) em vez de sugerir "zero comentários".
 */
export function buildConsultaDetalheResult(r: Record<string, unknown>): Record<string, unknown> {
  return { ...r, comentarios: null, aviso: OBTER_CONSULTA_DATAS_AVISO };
}

/** URL canônica do item raspado (nível 3) quando o scraper a expõe; senão o caminho de fallback. */
function urlDoItem(item: unknown, fallbackPath: string): string {
  const url = (item as { url?: unknown } | null)?.url;
  return typeof url === "string" && url.startsWith("http") ? url : fallbackPath;
}

/**
 * Sub-fonte lida do corpus em D1 (`resolveList`): o instante é o `lastScrapedAt` da meta, o
 * mesmo que `provLista` põe no topo das listas; o D1 não é cache, então `served_from_cache`
 * fica de fora (sai `null`).
 */
export function subFonteDoCorpus(pathOrUrl: string, dataset_id: string, meta: unknown, fields: string[]): FieldSource {
  const ts = (meta as { lastScrapedAt?: unknown } | null)?.lastScrapedAt;
  return {
    fields,
    source_url: provenanceEcidadania(pathOrUrl).source_url,
    dataset_id,
    ...(typeof ts === "string" && ts ? { retrieved_at: ts } : {}),
  };
}

/**
 * Proveniência de `senado_ecidadania_obter_evento`. O detalhe é raspado ao vivo (cache próprio),
 * mas a página estática não lê a contagem de `comentarios` (carregada por AJAX): ela vem do
 * corpus em D1, lido noutro instante. Até a 3.18.1 o topo era só o do detalhe; agora, quando o
 * corpus dá a contagem, as duas leituras viram sub-fontes e o topo é o mais antigo (adaptador,
 * contrato §3). Evento fora do corpus = `comentarios: null`, sem sub-fonte.
 */
export function provenanceEventoDetalhe(
  item: Record<string, unknown>,
  id: number,
  leitura: { fetchedAt: string; fromCache: boolean },
  corpusMeta?: unknown,
): Provenance {
  const dataset_id = `evento=${id}`;
  const prov = provenanceEcidadania(urlDoItem(item, `/visualizacaoaudiencia?id=${id}`), {
    dataset_id,
    retrieved_at: leitura.fetchedAt,
  });
  if (corpusMeta === undefined) return prov;
  return withFieldSources(prov, [
    {
      fields: Object.keys(item).filter((k) => k !== "comentarios"),
      source_url: prov.source_url,
      dataset_id,
      ...leituraDoCache(leitura),
    },
    subFonteDoCorpus("/principalaudiencia", "eventos", corpusMeta, ["comentarios"]),
  ]);
}

/**
 * Contract v1.3 `derived` on e-Cidadania responses. Every consulta carries percentages the server
 * computes (`buildConsultaResumo`), and `totalVotos` too when the source sends no total; the
 * analysis and the poll suggestion add their own polarisation/consensus metrics and ranking on top;
 * an idea's creation date is an estimate; the historical archive's national totals are summed from
 * the per-UF rows of the CSV.
 */
export const NOTA_DERIVACAO_ANALISE_CONSULTAS = `${NOTA_DERIVACAO_RANKING_ECIDADANIA} ${NOTA_DERIVACAO_PERCENTUAIS}`;
export const provenanceDasConsultas = (prov: Provenance): Provenance => derivado(prov, NOTA_DERIVACAO_PERCENTUAIS);
export const provenanceDaAnaliseDeConsultas = (prov: Provenance): Provenance => derivado(prov, NOTA_DERIVACAO_ANALISE_CONSULTAS);
export const provenanceDasIdeias = (prov: Provenance, ideias: ReadonlyArray<{ dataCriacaoEstimada?: string | null }>): Provenance =>
  derivadoSe(prov, ideias.some((i) => i.dataCriacaoEstimada != null), NOTA_DERIVACAO_DATA_ESTIMADA);
/**
 * Proveniência de `senado_ecidadania_obter_ideia`. O detalhe é lido ao vivo; a situação vem do corpus
 * em D1 (categoria do portal, lida noutro instante → sub-fonte, topo = o mais antigo) ou, fora do
 * corpus, é derivada da linha do tempo. A data estimada é sempre derivada quando há data limite.
 */
export function provenanceDaIdeia(
  prov: Provenance,
  detalhe: Record<string, unknown>,
  statusDoCorpus: { scrapedAt: string } | null,
  leitura: { fetchedAt: string; fromCache: boolean },
): Provenance {
  const comFontes = statusDoCorpus
    ? withFieldSources(prov, [
        { fields: Object.keys(detalhe).filter((k) => k !== "status"), source_url: prov.source_url, dataset_id: `ideia=${detalhe.id}`, ...leituraDoCache(leitura) },
        subFonteDoCorpus("/principalideia", "ideias", { lastScrapedAt: statusDoCorpus.scrapedAt }, ["status"]),
      ])
    : prov;
  const notas = [
    ...(detalhe.dataCriacaoEstimada != null ? [NOTA_DERIVACAO_DATA_ESTIMADA] : []),
    ...(statusDoCorpus ? [] : [NOTA_DERIVACAO_STATUS_IDEIA]),
  ];
  return notas.length ? derivado(comFontes, notas.join(" ")) : comFontes;
}

/**
 * Resposta de `senado_ecidadania_obter_ideia` a partir da leitura do leitor novo (fase A4). Campos que
 * já existiam mantêm tipo e não-nulidade (saída que passa a aceitar null seria MAJOR): `descricao` ""
 * quando ausente, `apoios` 0 quando a página não publica contagem (com aviso), `status` sempre preenchido,
 * `autor` "NOME (UF)". Os novos vêm depois, na ordem da leitura.
 */
export function montarDetalheDaIdeia(id: number, d: IdeiaDetalhe, statusDoCorpus: string | null) {
  const apoios = apoiosPublicados(d);
  const avisos = [...d.avisos, ...(apoios === null ? ["a página não publica a contagem de apoios desta ideia; apoios saiu 0 por compatibilidade"] : [])];
  const autor = d.autorNome ? `${d.autorNome}${d.autorUf ? ` (${d.autorUf})` : ""}` : null;
  return {
    id,
    titulo: d.titulo,
    descricao: d.descricao ?? "",
    apoios: apoios ?? 0,
    dataPublicacao: d.prazoApoios,
    status: statusDoCorpus ?? statusDaLinhaDoTempo(d),
    origemStatus: statusDoCorpus ? "categoria do portal (listagem)" : "derivado da linha do tempo",
    autor,
    url: `${ECIDADANIA_BASE}/visualizacaoideia?id=${id}`,
    problema: null,
    solucao: null,
    // OBS-9: a página de ideia não tem recurso de comentários — null, não um 0 espúrio.
    comentarios: null,
    dataEncerramento: d.encerramento?.data ?? null,
    plConvertido: detalheParaCorpus(d).plConvertido,
    dataCriacaoEstimada: estimarCriacaoIdeia(d.prazoApoios),
    avisoDatas: AVISO_DATAS_IDEIA_DETALHE,
    autorNome: d.autorNome,
    autorUf: d.autorUf,
    dataProposta: d.dataProposta,
    prazoApoios: d.prazoApoios,
    dataMeta: d.dataMeta,
    meta: d.meta,
    sugestao: d.sugestao,
    decisaoCdh: d.decisaoCdh,
    encerramento: d.encerramento,
    oficina: d.oficina,
    proposicoes: d.proposicoes,
    linhaDoTempo: d.linhaDoTempo,
    avisos,
  };
}

export const provenanceDosVotosHistoricos =(prov: Provenance): Provenance => derivado(prov, NOTA_DERIVACAO_SOMAS);
/**
 * Proveniência de `senado_ecidadania_sugerir_tema_enquete`: as sugestões cruzam DOIS corpora
 * do D1 (consultas e ideias), cada um com o seu `lastScrapedAt`. Até a 3.18.1 o topo levava só
 * o das consultas e o das ideias era descartado; agora cada corpus é sub-fonte das mesmas
 * contagens e o topo é o mais antigo (adaptador, contrato §3).
 */
export function provenanceSugestaoEnquete(consultasMeta: unknown, ideiasMeta: unknown): Provenance {
  const campos = ["sugestoes", "count", "totalAnalisados", "totalQualificados"];
  const ts = (consultasMeta as { lastScrapedAt?: unknown } | null)?.lastScrapedAt;
  const prov = provenanceEcidadania("/principalmateria", {
    dataset_id: "consultas+ideias",
    retrieved_at: typeof ts === "string" && ts ? ts : undefined,
  });
  return derivado(withFieldSources(prov, [
    subFonteDoCorpus("/principalmateria", "consultas", consultasMeta, campos),
    subFonteDoCorpus("/principalideia", "ideias", ideiasMeta, campos),
  ]), NOTA_DERIVACAO_ANALISE_CONSULTAS);
}

// ══════════════════════════════════════════════════════════════════════════
// Tool registration
// ══════════════════════════════════════════════════════════════════════════

export function registerECidadaniaTools(server: SenadoToolHost, _baseUrl: string, env: Env, ctx?: ExecutionContext) {
  const db = env.ECIDADANIA_DB;
  // All three e-Cidadania entities are now weekly full corpora, not 2h highlight sets, so they get a
  // much larger staleness window —
  // otherwise possivelDesatualizacao would trip ~6h after every weekly load. See store.resolveList.
  const corpusStaleMaxMin = () => {
    const n = parseInt(env.ECIDADANIA_CORPUS_STALE_MAX_MIN ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : 14400; // ~10 days
  };
  // Corpus entities (consultas, eventos, ideias) must never collapse to the ~5-item live highlight
  // scrape on staleness (that was the original coverage bug); serve the corpus from D1 flagged
  // instead. Live is reserved for an empty D1 (cold start, before the first weekly corpus run).
  const CORPUS_RESOLVE = { fallbackOnStale: false } as const;

  // Listas vêm do D1 (resolveList): o retrieved_at fiel é o lastScrapedAt da meta — a idade
  // real do dado, não o instante desta chamada. `pathOrUrl` é a página de seção do portal.
  function provLista(pathOrUrl: string, dataset_id: string, meta: unknown) {
    const ts = (meta as { lastScrapedAt?: unknown } | null)?.lastScrapedAt;
    return provenanceEcidadania(pathOrUrl, {
      dataset_id,
      retrieved_at: typeof ts === "string" && ts ? ts : undefined,
    });
  }

  // Detalhes são raspados ao vivo (via cachedFetch): use a URL canônica do próprio item quando
  // o scraper a expõe (nível 3), com o fetchedAt do cache como retrieved_at.
  function provDetalhe(item: unknown, fallbackPath: string, dataset_id: string, fetchedAt: string) {
    return provenanceEcidadania(urlDoItem(item, fallbackPath), { dataset_id, retrieved_at: fetchedAt });
  }

  function ecidadaniaError(e: unknown) {
    // Mesmo caminho de toda tool (errorFrom: log cru, classe pelo TIPO da exceção via
    // anexarClasse); o sufixo tranquilizador vai só na mensagem que o cliente lê.
    return errorFrom(
      e,
      "Erro ao acessar e-Cidadania",
      ". As demais funcionalidades (senadores, matérias, votações) continuam operacionais.",
    );
  }

  // G1. senado_ecidadania_listar_consultas
  server.tool(
    "senado_ecidadania_listar_consultas",
    "Lista consultas públicas do e-Cidadania (conjunto completo das **abertas** — toda matéria em tramitação, ~7,7 mil), em que cidadãos votam sim/não. Retorna `{ count, consultas }`, cada consulta com `id`, `materia`, `ementa`, `votosSim`/`votosNao`/`totalVotos`, `percentualSim`/`percentualNao`, `status` e `url`. Toda consulta entra como `aberta`; quando a matéria sai de tramitação ela passa a `encerrada` (o conjunto `encerrada`/`todas` cresce com o tempo). Consultas encerradas antes da 1ª ingestão não são capturadas. Aceita `limite` (padrão 20). Para o detalhe de uma consulta chame `senado_ecidadania_obter_consulta` com o `id`; para recortes analíticos (consenso/polarização) use `senado_ecidadania_consultas_analise`.",
    {
      status: z.enum(["aberta", "encerrada", "todas"]).optional().default("aberta").describe("Filtrar por status (padrão: aberta). encerrada lista consultas cuja matéria saiu de tramitação desde a ingestão (cresce com o tempo); fechadas antes da 1ª carga não são capturadas."),
      limite: z.number().int().min(1).max(100).optional().default(20).describe("Número máximo de resultados"),
      pagina: z.number().int().min(1).optional().default(1).describe("Página de resultados"),
    },
    async (params) => {
      try {
        const { items, meta } = await resolveList(
          db, "consultas", corpusStaleMaxMin(),
          () => listarConsultasInternal({ limite: 100 }),
          undefined, CORPUS_RESOLVE,
        );
        const status = params.status ?? "aberta";
        let filtered = items as ConsultaResumo[];
        if (status !== "todas") filtered = filtered.filter((c) => c.status === status);
        const limite = params.limite ?? 20;
        const offset = ((params.pagina ?? 1) - 1) * limite;
        const out = filtered.slice(offset, offset + limite);
        return resultWithProvenance(
          { count: out.length, consultas: tagUntrustedList("consultas", out as unknown as Record<string, unknown>[]), meta },
          provenanceDasConsultas(provLista("/principalmateria", "consultas", meta)),
        );
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G2. senado_ecidadania_obter_consulta
  server.tool(
    "senado_ecidadania_obter_consulta",
    "Obtém o detalhe de uma consulta pública específica do e-Cidadania. Retorna um objeto com `id`, `materia`, `ementa`, `votosSim`/`votosNao`/`totalVotos`, `percentualSim`/`percentualNao`, `status`, `autor`, `relator`, `url`. O portal não publica o período da consulta: `dataAbertura`/`dataEncerramento` (e `comissao`/`linkMateria`) vêm sempre `null` — a consulta abre quando a matéria entra em tramitação e encerra quando sai, refletido em `status`. O campo `comentarios` vem `null`: a página de consulta não possui recurso de comentários. Obtenha o `id` antes via `senado_ecidadania_listar_consultas` ou `senado_ecidadania_consultas_analise`.",
    { id: z.number().int().positive().describe("ID da consulta pública") },
    async (params) => {
      try {
        const { value: r, fetchedAt } = await cachedFetchWithMeta("ecidadania_consulta", { id: params.id }, CACHE_ON_DEMAND, () =>
          obterConsultaInternal(params.id),
        );
        writeDetalheThrough(db, ctx, "consultas", params.id, r as Record<string, unknown>);
        const detalhe = buildConsultaDetalheResult(r as Record<string, unknown>);
        return resultWithProvenance(
          tagUntrustedFields("consultas", detalhe),
          provenanceDasConsultas(provDetalhe(r, `/visualizacaomateria?id=${params.id}`, `consulta=${params.id}`, fetchedAt)),
        );
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G3. senado_ecidadania_consultas_analise (modo: consenso | polarizada)
  server.tool(
    "senado_ecidadania_consultas_analise",
    "Analisa o conjunto completo de consultas públicas **abertas** (matérias em tramitação) do e-Cidadania por grau de concordância cidadã, conforme `modo`: " +
      "`consenso` → consultas com alta concentração de votos numa direção, ordenadas da maior para a menor concentração; usa `percentualMinimo` (padrão 85%). " +
      "`polarizada` → consultas com votação equilibrada (~50/50), ordenadas da menor para a maior diferença sim/não; usa `margemPolarizacao` (padrão 15 pontos). " +
      "Analisa por padrão consultas `aberta` (opinião pública atual). Quando a matéria sai de tramitação a consulta passa a `encerrada`, então `status: \"encerrada\"`/`\"todas\"` cobrem o conjunto que foi encerrado desde a ingestão (cresce com o tempo); fechadas antes da 1ª carga não são capturadas. " +
      "Todos os modos aceitam `minimoVotos` (padrão 1000) e `limite` (padrão 10). Retorna `{ modo, criterio, count, consultas }`. " +
      "É esta a ferramenta para 'consultas mais votadas', ranking ou panorama ATUAL da votação das consultas em tramitação — não confundir com `senado_ecidadania_consultas_votos`, que é o acervo HISTÓRICO (matérias já arquivadas) com quebra por UF. " +
      "Para o detalhe de uma consulta use `senado_ecidadania_obter_consulta`.",
    {
      modo: z.enum(["consenso", "polarizada"]).optional().default("consenso").describe("consenso (alta concordância) ou polarizada (~50/50)"),
      status: z.enum(["aberta", "encerrada", "todas"]).optional().default("aberta").describe("Recorte do conjunto (padrão: aberta = opinião atual). encerrada cobre consultas que saíram de tramitação desde a ingestão (cresce com o tempo); fechadas antes da 1ª carga não são capturadas."),
      percentualMinimo: z.number().int().min(50).max(100).optional().default(85).describe("Modo consenso: percentual mínimo numa direção"),
      margemPolarizacao: z.number().int().min(0).max(50).optional().default(15).describe("Modo polarizada: considera polarizado se diferença ≤ este percentual"),
      minimoVotos: z.number().int().min(0).optional().default(1000).describe("Mínimo de votos para considerar"),
      limite: z.number().int().min(1).max(50).optional().default(10).describe("Número máximo de resultados"),
    },
    async (params) => {
      try {
        const modo = params.modo ?? "consenso";
        const statusFiltro = params.status ?? "aberta";
        const minimoVotos = params.minimoVotos ?? 1000;
        const limite = params.limite ?? 10;
        const { items, meta } = await resolveList(
          db, "consultas", corpusStaleMaxMin(),
          () => listarConsultasInternal({ limite: 100 }),
          undefined, CORPUS_RESOLVE,
        );
        const all = (items as ConsultaResumo[]).filter(
          (c) => statusFiltro === "todas" || c.status === statusFiltro,
        );
        let filtered: ConsultaResumo[];
        let criterio: string;
        if (modo === "polarizada") {
          const margem = params.margemPolarizacao ?? 15;
          filtered = (all as ConsultaResumo[])
            .filter((c) => c.totalVotos >= minimoVotos && Math.abs(c.percentualSim - c.percentualNao) <= margem)
            .sort((a, b) => Math.abs(a.percentualSim - a.percentualNao) - Math.abs(b.percentualSim - b.percentualNao))
            .slice(0, limite);
          criterio = `Diferença sim/não ≤ ${margem}%, mínimo ${minimoVotos} votos`;
        } else {
          const percentualMinimo = params.percentualMinimo ?? 85;
          filtered = (all as ConsultaResumo[])
            .filter((c) => c.totalVotos >= minimoVotos && Math.max(c.percentualSim, c.percentualNao) >= percentualMinimo)
            .sort((a, b) => Math.max(b.percentualSim, b.percentualNao) - Math.max(a.percentualSim, a.percentualNao))
            .slice(0, limite);
          criterio = `≥${percentualMinimo}% numa direção, mínimo ${minimoVotos} votos`;
        }
        return resultWithProvenance(
          { modo, criterio, count: filtered.length, consultas: tagUntrustedList("consultas", filtered as unknown as Record<string, unknown>[]), meta },
          provenanceDaAnaliseDeConsultas(provLista("/principalmateria", "consultas", meta)),
        );
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G5. senado_ecidadania_listar_ideias
  server.tool(
    "senado_ecidadania_listar_ideias",
    "Lista ideias legislativas propostas por cidadãos no e-Cidadania — **conjunto completo** (corpus persistido em D1; ideias em andamento atualizadas diariamente; ~118 mil ideias, incluindo encerradas e convertidas em proposição). Retorna `{ count, ideias, avisoDatas }`, cada ideia com `id`, `titulo`, `apoios`, `status` (a categoria da listagem do portal em que a ideia aparece: `aberta` = \"Aberta\", \"Na comissão\" ou \"Aguardando envio à CDH\"; `encerrada` = \"Encerrada – sem apoio suficiente\" ou \"Não acatada\" pela CDH; `convertida` = \"Transformada em proposição\"; `removida` = retirada do portal, que não a publica mais — o corpus guarda o último estado conhecido), `url` e os campos lidos do detalhe quando o backfill já passou por ela (`dataPublicacao`, `autorUf`, `descricao`, `plConvertido`; `null` até lá). **Datas:** `dataPublicacao` é a DATA LIMITE para receber os 20.000 apoios — a única data que o corpus guarda; o nome do campo é histórico — e por isso cai no futuro em ideia aberta; `dataCriacaoEstimada` (= data limite − 120 dias, a regra dos 4 meses do portal) é calculada pelo servidor e é estimativa, não dado da fonte; a data REAL da proposição sai em `senado_ecidadania_obter_ideia` (`dataProposta`); `avisoDatas` repete isso na resposta. Aceita filtro por `status` e `limite` (padrão 20). Para um ranking das mais apoiadas, ordene por apoios (`ordenarPor: \"apoios\"`, `ordem: \"desc\"`). Para o detalhe completo de uma ideia (texto, autor, linha do tempo, Sugestão, decisão da CDH, proposições em que virou) chame `senado_ecidadania_obter_ideia` com o `id`.",
    {
      status: z.enum(["aberta", "encerrada", "convertida", "removida", "todas"]).optional().describe("Filtrar por status (`removida` = retirada do portal)"),
      ordenarPor: z.enum(["apoios", "data", "comentarios"]).optional().describe("Campo para ordenação (apoios é o disponível no corpus; data/comentarios só no detalhe)"),
      ordem: z.enum(["asc", "desc"]).optional().describe("Ordem de ordenação"),
      limite: z.number().int().min(1).max(100).optional().default(20).describe("Número máximo de resultados"),
      pagina: z.number().int().min(1).optional().default(1).describe("Página de resultados"),
    },
    async (params) => {
      try {
        const { items, meta } = await resolveList(
          db, "ideias", corpusStaleMaxMin(),
          () => listarIdeiasInternal({ limite: 100 }),
          undefined, CORPUS_RESOLVE,
        );
        let arr = items as IdeiaResumo[];
        if (params.status && params.status !== "todas") arr = arr.filter((i) => i.status === params.status);
        if (params.ordenarPor === "apoios") {
          arr = [...arr].sort((a, b) => (params.ordem === "asc" ? a.apoios - b.apoios : b.apoios - a.apoios));
        }
        const limite = params.limite ?? 20;
        const offset = ((params.pagina ?? 1) - 1) * limite;
        arr = arr.slice(offset, offset + limite);
        // Derivado na SAÍDA, nunca no corpus: `IdeiaResumo` é o payload persistido (hash estável).
        const ideias = arr.map((i) => ({ ...i, dataCriacaoEstimada: estimarCriacaoIdeia(i.dataPublicacao) }));
        return resultWithProvenance(
          {
            count: ideias.length,
            ideias: tagUntrustedList("ideias", ideias as unknown as Record<string, unknown>[]),
            avisoDatas: AVISO_DATAS_IDEIA,
            meta,
          },
          provenanceDasIdeias(provLista("/principalideia", "ideias", meta), ideias),
        );
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G6. senado_ecidadania_obter_ideia
  server.tool(
    "senado_ecidadania_obter_ideia",
    "Obtém o detalhe de uma ideia legislativa do e-Cidadania, lido ao vivo da página da ideia. Retorna `id`, `titulo`, `descricao`, `apoios`, `status`, `origemStatus`, `autor` (\"NOME (UF)\", o nome abreviado como o portal publica), `url`, `plConvertido` (a Sugestão gerada, \"SUG n/ano\"), `dataEncerramento` (fim do período de apoio, quando encerrado) e os campos da linha do tempo do portal: `dataProposta` (data em que a ideia foi proposta, publicada pela fonte), `prazoApoios` (data limite para os 20.000 apoios), `dataMeta`/`meta` (quando alcançou a meta), `sugestao` (número, ano, data e link da Sugestão), `decisaoCdh` (a CDH transformou ou não a Sugestão), `encerramento` (apoios recebidos e fim do período), `oficina` (ideia de Oficina Legislativa), `proposicoes` (cada proposição em que a ideia virou — pela CDH ou adotada por senador/deputado —, com sigla, número, ano, parlamentar e link), `linhaDoTempo` (os acontecimentos como publicados, mais recente primeiro) e `avisos` (acontecimento que o servidor não reconheceu, copiado sem interpretação). **Situação:** `status` é a categoria do portal guardada no corpus (`aberta`/`encerrada`/`convertida`/`removida`, as mesmas de `senado_ecidadania_listar_ideias`); se a ideia ainda não está no corpus, o servidor a classifica pela linha do tempo e `origemStatus` diz isso. **Datas:** use `dataProposta`; `dataPublicacao` é a data limite (nome histórico, igual a `prazoApoios`) e `dataCriacaoEstimada` é estimativa mantida por compatibilidade. `comentarios`, `problema` e `solucao` vêm `null`: a página não os publica. Obtenha o `id` antes via `senado_ecidadania_listar_ideias`.",
    { id: z.number().int().positive().describe("ID da ideia legislativa") },
    async (params) => {
      try {
        // v2: a chave muda com o formato — o L1 guardaria a leitura do leitor antigo.
        const { value: lida, fetchedAt, fromCache } = await cachedFetchWithMeta("ecidadania_ideia_v2", { id: params.id }, CACHE_ON_DEMAND, () =>
          obterIdeiaInternal(params.id),
        );
        // A situação é a categoria do portal guardada no corpus (bucket da listagem), lida a cada chamada.
        const doCorpus = await readCurrentStatus(db, "ideias", params.id);
        const detalhe = montarDetalheDaIdeia(params.id, lida, doCorpus?.status ?? null);
        writeDetalheThrough(db, ctx, "ideias", params.id, detalhe);
        return resultWithProvenance(
          tagUntrustedFields("ideias", detalhe),
          provenanceDaIdeia(
            provDetalhe(detalhe, `/visualizacaoideia?id=${params.id}`, `ideia=${params.id}`, fetchedAt),
            detalhe,
            doCorpus,
            { fetchedAt, fromCache },
          ),
        );
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G7. senado_ecidadania_listar_eventos
  server.tool(
    "senado_ecidadania_listar_eventos",
    "Lista eventos interativos do e-Cidadania (audiências públicas, sabatinas, lives) — conjunto completo (corpus persistido em D1, atualizado semanalmente; ~milhares de eventos, incluindo encerrados). Retorna `{ count, eventos }`, cada evento com `id`, `titulo`, `data`, `hora`, `comissao` (sigla), `comentarios`, `status` (`agendado`/`encerrado`/`cancelado`) e `url`; aceita filtro por `status`, por `comissao` (sigla) e `limite` (padrão 20). Para um ranking dos mais comentados, ordene por comentários (`ordenarPor: \"comentarios\"`, `ordem: \"desc\"`). Para o detalhe completo de um evento use `senado_ecidadania_obter_evento`.",
    {
      status: z.enum(["agendado", "encerrado", "todos"]).optional().describe("Filtrar por status"),
      comissao: z.string().optional().describe("Sigla da comissão"),
      ordenarPor: z.enum(["data", "comentarios"]).optional().describe("Ordenar por data ou número de comentários"),
      ordem: z.enum(["asc", "desc"]).optional().default("desc").describe("Ordem (padrão desc)"),
      limite: z.number().int().min(1).max(100).optional().default(20).describe("Número máximo de resultados"),
    },
    async (params) => {
      try {
        const limite = params.limite ?? 20;
        const ordem = params.ordem ?? "desc";
        const { items, meta } = await resolveList(
          db, "eventos", corpusStaleMaxMin(),
          () => listarEventosInternal({ limite: 100 }),
          undefined, CORPUS_RESOLVE,
        );
        let eventos = (items as EventoResumo[]).filter((e) => {
          if (params.status && params.status !== "todos" && e.status !== params.status) return false;
          if (params.comissao && !e.comissao?.toUpperCase().includes(params.comissao.toUpperCase())) return false;
          return true;
        });
        if (params.ordenarPor === "comentarios") {
          eventos.sort((a, b) => (ordem === "asc" ? a.comentarios - b.comentarios : b.comentarios - a.comentarios));
        } else if (params.ordenarPor === "data") {
          eventos.sort((a, b) => {
            const da = a.data || "", dbb = b.data || "";
            return ordem === "asc" ? da.localeCompare(dbb) : dbb.localeCompare(da);
          });
        }
        eventos = eventos.slice(0, limite);
        // OBS-10: the corpus carries the detail-enriched fields (descricao, pauta, convidados,
        // local, videoUrl, comissaoNomeCompleto). The listing should stay compact — reserve those
        // for senado_ecidadania_obter_evento.
        const compactos = eventos.map((e) => ({
          id: e.id,
          titulo: e.titulo,
          data: e.data,
          hora: e.hora,
          comissao: e.comissao,
          comentarios: e.comentarios,
          status: e.status,
          url: e.url,
        }));
        return resultWithProvenance(
          { count: compactos.length, eventos: tagUntrustedList("eventos", compactos as unknown as Record<string, unknown>[]), meta },
          provLista("/principalaudiencia", "eventos", meta),
        );
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G9. senado_ecidadania_obter_evento
  server.tool(
    "senado_ecidadania_obter_evento",
    "Obtém o detalhe completo de um evento interativo do e-Cidadania (audiência, sabatina, live). Retorna um objeto com `id`, `titulo`, `descricao`, `data`, `hora`, `comissao` e `comissaoNomeCompleto`, `local`, `status` (`agendado`/`encerrado`/`cancelado`), `comentarios`, `url`, mais `pauta` (até 15 itens), `convidados` e `videoUrl` (embed do YouTube quando houver, senão `null`) — campos não preenchidos vêm `null` e `id` inexistente retorna erro. Obtenha o `id` antes via `senado_ecidadania_listar_eventos`. Para apenas listar/rankear eventos (sem descrição/pauta/convidados) use `senado_ecidadania_listar_eventos`, não esta.",
    { id: z.number().int().positive().describe("Identificador do evento (campo `id` de senado_ecidadania_listar_eventos)") },
    async (params) => {
      try {
        const leitura = await cachedFetchWithMeta("ecidadania_evento", { id: params.id }, CACHE_ON_DEMAND, () =>
          obterEventoInternal(params.id),
        );
        const r = leitura.value as Record<string, unknown>;
        writeDetalheThrough(db, ctx, "eventos", params.id, r);
        // The static detail scrape can't read the AJAX-loaded comentarios count (always 0);
        // the corpus carries the canonical count from the AJAX fragment (estudo A3 — the
        // listing count is spurious, 0 in ~82%). Splice it in, or null when the event is not
        // in the corpus (unknown, not a spurious 0).
        const detalhe = { ...r };
        let corpusMeta: unknown;
        try {
          const { items, meta } = await resolveList(
            db, "eventos", corpusStaleMaxMin(),
            () => listarEventosInternal({ limite: 100 }),
            undefined, CORPUS_RESOLVE,
          );
          const corpusItem = (items as EventoResumo[]).find((e) => e.id === params.id);
          detalhe.comentarios = corpusItem ? corpusItem.comentarios : null;
          if (corpusItem) corpusMeta = meta;
        } catch {
          detalhe.comentarios = null;
        }
        return resultWithProvenance(
          tagUntrustedFields("eventos", detalhe),
          provenanceEventoDetalhe(r, params.id, leitura, corpusMeta),
        );
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G8. senado_ecidadania_sugerir_tema_enquete
  server.tool(
    "senado_ecidadania_sugerir_tema_enquete",
    "Sugere temas para uma enquete pública mensal (seleção de pauta): analisa o conjunto completo de consultas (abertas) e as ideias do e-Cidadania e elege as de maior engajamento cidadão, filtrando por polarização/consenso e participação mínima. Retorna `{ criteriosAplicados, totalAnalisados, count, totalQualificados, sugestoes }` (até 10), cada sugestão com `tipo` (`consulta`/`ideia`), `id`, `titulo`, `motivo`, `metricas` (participação/polarização) e `url`, ordenadas por participação. `count` é o número de sugestões retornadas (≤10) e `totalQualificados` é quantas passaram nos critérios. Critérios opcionais em `criterios`: `evitarPolarizacao`/`evitarConsenso` (padrão true), `minimoParticipacao` (padrão 500), `apenasEmTramitacao` (padrão true → considera só consultas abertas, com base no status real). Para investigar uma sugestão, use `senado_ecidadania_obter_consulta` ou `senado_ecidadania_obter_ideia` conforme o `tipo`.",
    {
      criterios: z.object({
        evitarPolarizacao: z.boolean().optional().default(true).describe("Evita temas com ~50/50"),
        evitarConsenso: z.boolean().optional().default(true).describe("Evita temas com >85%"),
        minimoParticipacao: z.number().int().min(0).optional().default(500).describe("Mínimo de votos/apoios"),
        apenasEmTramitacao: z.boolean().optional().default(true).describe("Apenas matérias em tramitação"),
      }).optional().describe("Critérios de seleção do tema (polarização, consenso, participação mínima, tramitação)"),
    },
    async (params) => {
      try {
        const criterios = params.criterios || {
          evitarPolarizacao: true, evitarConsenso: true,
          minimoParticipacao: 500, apenasEmTramitacao: true,
        };

        const [cRes, iRes] = await Promise.all([
          resolveList(
            db, "consultas", corpusStaleMaxMin(),
            () => listarConsultasInternal({ limite: 100 }),
            undefined, CORPUS_RESOLVE,
          ),
          resolveList(
            db, "ideias", corpusStaleMaxMin(),
            () => listarIdeiasInternal({ limite: 100 }),
            undefined, CORPUS_RESOLVE,
          ),
        ]);
        // apenasEmTramitacao is now honored against the real /processo-derived status (aberta ⟺ em
        // tramitação), so the criterion is no longer inert (§2.1 / §7).
        const apenasEmTramitacao = criterios.apenasEmTramitacao ?? true;
        const consultas = (cRes.items as ConsultaResumo[]).filter(
          (c) => !apenasEmTramitacao || c.status === "aberta",
        );
        // OBS-12(i): apenasEmTramitacao must also gate ideias, else 2017–2020
        // encerradas/convertidas get suggested as current poll topics.
        const ideias = (iRes.items as IdeiaResumo[]).filter(
          (i) => !apenasEmTramitacao || i.status === "aberta",
        );

        const sugestoes: any[] = [];

        for (const c of consultas) {
          if (c.totalVotos < (criterios.minimoParticipacao ?? 500)) continue;
          const polarizacao = Math.abs(c.percentualSim - c.percentualNao);
          if (criterios.evitarPolarizacao && polarizacao < 20) continue;
          if (criterios.evitarConsenso && Math.max(c.percentualSim, c.percentualNao) > 85) continue;
          let motivo = "Tema com boa participação cidadã";
          if (polarizacao >= 20 && polarizacao <= 40) motivo = "Tema com divisão moderada de opiniões, ideal para debate";
          else if (polarizacao > 40 && polarizacao <= 70) motivo = "Tema com tendência clara mas ainda com debate significativo";
          sugestoes.push({
            tipo: "consulta", id: c.id, titulo: sanitizeScrapedText(c.ementa.substring(0, 200)), motivo,
            metricas: { participacao: c.totalVotos, polarizacao: 100 - polarizacao },
            materiaRelacionada: c.materia ? sanitizeScrapedText(c.materia) : undefined, url: c.url,
          });
        }

        for (const i of ideias) {
          if (i.apoios < (criterios.minimoParticipacao ?? 500)) continue;
          sugestoes.push({
            tipo: "ideia", id: i.id, titulo: neutralizeUntrustedText(i.titulo.substring(0, 200)),
            motivo: `Ideia popular com ${formatIntBR(i.apoios)} apoios`,
            metricas: { participacao: i.apoios }, url: i.url,
          });
        }

        sugestoes.sort((a, b) => b.metricas.participacao - a.metricas.participacao);

        const retornadas = sugestoes.slice(0, 10);
        return resultWithProvenance({
          criteriosAplicados: criterios,
          totalAnalisados: consultas.length + ideias.length,
          // OBS-12(ii): `count` now means "itens retornados" (consistent with the other tools);
          // the full qualified count moves to `totalQualificados`.
          count: retornadas.length,
          totalQualificados: sugestoes.length,
          sugestoes: retornadas,
          meta: { consultas: cRes.meta, ideias: iRes.meta },
        }, provenanceSugestaoEnquete(cRes.meta, iRes.meta));
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G10. senado_ecidadania_consultas_votos (acervo histórico de votos por UF — CSV Arquimedes)
  server.tool(
    "senado_ecidadania_consultas_votos",
    "Acervo **histórico** de votos das consultas públicas do e-Cidadania, com **quebra por UF** (fonte: CSV Arquimedes; ~15 mil matérias, atualizado semanalmente). Use apenas quando o pedido for pelo acervo/arquivo histórico ou por votos por estado (UF); para 'consultas mais votadas', ranking ou opinião ATUAL das consultas em tramitação use `senado_ecidadania_consultas_analise`. Diferente de `senado_ecidadania_listar_consultas` (consultas em tramitação): aqui o conjunto é o **arquivo** de matérias já consultadas — `status` vem como `Descontinuado` no arquivo de origem, por isso é tratado como acervo, não como opinião atual. Retorna `{ count, referencePeriod, consultas }`, cada item com `id`, `materia`, `ementa`, `autoria`, `votosSim`/`votosNao`/`totalVotos`, `votosPorUf` (`{ UF: { sim, nao } }`) e `url`. Use `ordenarPor` (`total`/`sim`/`nao`, padrão `total`) e `ordem` para ranking; `uf` para recortar e **ranquear por aquele estado** (só matérias com votos na UF, e cada item ganha `recorteUf`); `materia` para filtrar por código (numérico) ou trecho do nome/ementa; `limite` (padrão 20).",
    {
      ordenarPor: z.enum(["total", "sim", "nao"]).optional().default("total").describe("Métrica do ranking (padrão: total de votos)"),
      ordem: z.enum(["asc", "desc"]).optional().default("desc").describe("Ordem (padrão desc)"),
      uf: z.string().length(2).optional().describe("Sigla da UF (ex.: SP) — filtra e ranqueia por votos daquele estado"),
      materia: z.string().optional().describe("Filtro por código da matéria (numérico) ou trecho do nome/ementa"),
      limite: z.number().int().min(1).max(100).optional().default(20).describe("Número máximo de resultados"),
    },
    async (params) => {
      try {
        const ordenarPor = params.ordenarPor ?? "total";
        const ordem = params.ordem ?? "desc";
        const limite = params.limite ?? 20;
        const uf = params.uf?.toUpperCase();
        const { items, meta } = await resolveList(
          db, "consultas_votos", corpusStaleMaxMin(),
          async () => [], // sem fonte ao vivo: na 1ª carga (D1 vazio) responde vazio com aviso
          undefined, CORPUS_RESOLVE,
        );
        let arr = items as ConsultaVotoResumo[];

        if (params.materia) {
          const q = params.materia.trim();
          if (/^\d+$/.test(q)) {
            const code = Number(q);
            arr = arr.filter((v) => v.id === code);
          } else {
            const needle = q.toLowerCase();
            arr = arr.filter((v) => v.materia.toLowerCase().includes(needle) || v.ementa.toLowerCase().includes(needle));
          }
        }

        // Ranking metric: by UF when `uf` is set (and drop matérias without votes there), else aggregate.
        const valueOf = (v: ConsultaVotoResumo): number => {
          if (uf) {
            const u = v.votosPorUf[uf];
            if (!u) return Number.NEGATIVE_INFINITY;
            return ordenarPor === "sim" ? u.sim : ordenarPor === "nao" ? u.nao : u.sim + u.nao;
          }
          return ordenarPor === "sim" ? v.votosSim : ordenarPor === "nao" ? v.votosNao : v.totalVotos;
        };
        if (uf) arr = arr.filter((v) => v.votosPorUf[uf]);
        arr = [...arr].sort((a, b) => (ordem === "asc" ? valueOf(a) - valueOf(b) : valueOf(b) - valueOf(a)));

        const out = arr.slice(0, limite).map((v) => {
          if (!uf) return v;
          const u = v.votosPorUf[uf]!;
          return { ...v, recorteUf: { uf, votosSim: u.sim, votosNao: u.nao, totalVotos: u.sim + u.nao } };
        });

        const referencePeriod = (items[0] as ConsultaVotoResumo | undefined)?.referencePeriod ?? null;
        const consultasTagged = tagUntrustedList("consultas_votos", out as unknown as Record<string, unknown>[]);
        const payload: Record<string, unknown> = { count: out.length, referencePeriod, consultas: consultasTagged, meta };
        if (out.length === 0 && (meta.fonte === "ao-vivo" || meta.motivo === "d1-vazio" || meta.motivo === "d1-indisponivel")) {
          payload.aviso = "Acervo de votos ainda não ingerido (primeira carga semanal pendente) ou filtro sem correspondência.";
        }
        return resultWithProvenance(
          payload,
          provenanceDosVotosHistoricos(provenanceArquimedesVotos({
            reference_period: referencePeriod ?? undefined,
            retrieved_at: typeof meta.lastScrapedAt === "string" && meta.lastScrapedAt ? meta.lastScrapedAt : undefined,
          })),
        );
      } catch (e) { return ecidadaniaError(e); }
    },
  );
}
