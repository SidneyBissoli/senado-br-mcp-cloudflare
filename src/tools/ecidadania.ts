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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { toolError } from "../utils/validation.js";
import { provenanceEcidadania, provenanceArquimedesVotos, resultWithProvenance } from "../utils/provenance.js";
import { tagUntrustedFields, tagUntrustedList, neutralizeUntrustedText } from "../utils/untrusted.js";
import { logger } from "../utils/logger.js";
import { CACHE_ON_DEMAND } from "../types.js";
import type { Env } from "../types.js";
import { resolveList, writeDetalheThrough } from "../scraper/store.js";
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
  type ConsultaResumo,
  type IdeiaResumo,
  type EventoResumo,
  type ConsultaVotoResumo,
} from "../scraper/ecidadania.js";

// Re-export the scraper's pure/IO helpers so existing unit tests keep importing them from here.
export {
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

// ══════════════════════════════════════════════════════════════════════════
// Tool registration
// ══════════════════════════════════════════════════════════════════════════

export function registerECidadaniaTools(server: McpServer, _baseUrl: string, env: Env, ctx?: ExecutionContext) {
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
    const url = (item as { url?: unknown } | null)?.url;
    const alvo = typeof url === "string" && url.startsWith("http") ? url : fallbackPath;
    return provenanceEcidadania(alvo, { dataset_id, retrieved_at: fetchedAt });
  }

  function ecidadaniaError(e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro ao acessar e-Cidadania";
    const retryable = e instanceof Error && "retryable" in e && typeof (e as any).retryable === "boolean"
      ? (e as any).retryable
      : false;
    // Emit the same structured tool_error log the other tools get via errorFrom(); log the raw
    // message (no suffix), but keep the reassuring suffix in the user-facing tool error.
    logger.error("tool_error", { message: msg, retryable });
    return toolError(`${msg}. As demais funcionalidades (senadores, matérias, votações) continuam operacionais.`, retryable);
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
          provLista("/principalmateria", "consultas", meta),
        );
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G2. senado_ecidadania_obter_consulta
  server.tool(
    "senado_ecidadania_obter_consulta",
    "Obtém o detalhe de uma consulta pública específica do e-Cidadania. Retorna um objeto com `id`, `materia`, `ementa`, `votosSim`/`votosNao`/`totalVotos`, `percentualSim`/`percentualNao`, `status`, `autor`, `relator`, `comentarios`, `url` (campos como `comissao` e datas podem vir `null`). Obtenha o `id` antes via `senado_ecidadania_listar_consultas` ou `senado_ecidadania_consultas_analise`.",
    { id: z.number().int().positive().describe("ID da consulta pública") },
    async (params) => {
      try {
        const { value: r, fetchedAt } = await cachedFetchWithMeta("ecidadania_consulta", { id: params.id }, CACHE_ON_DEMAND, () =>
          obterConsultaInternal(params.id),
        );
        writeDetalheThrough(db, ctx, "consultas", params.id, r as Record<string, unknown>);
        return resultWithProvenance(
          tagUntrustedFields("consultas", r as Record<string, unknown>),
          provDetalhe(r, `/visualizacaomateria?id=${params.id}`, `consulta=${params.id}`, fetchedAt),
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
          provLista("/principalmateria", "consultas", meta),
        );
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G5. senado_ecidadania_listar_ideias
  server.tool(
    "senado_ecidadania_listar_ideias",
    "Lista ideias legislativas propostas por cidadãos no e-Cidadania — **conjunto completo** (corpus persistido em D1, atualizado semanalmente; ~150 mil ideias, incluindo encerradas e convertidas em proposição). Retorna `{ count, ideias }`, cada ideia com `id`, `titulo`, `apoios`, `status` (`aberta`/`encerrada`/`convertida`) e `url` (`autor` e `dataPublicacao` só aparecem no detalhe, vêm `null` aqui). Aceita filtro por `status` e `limite` (padrão 20). Para um ranking das mais apoiadas, ordene por apoios (`ordenarPor: \"apoios\"`, `ordem: \"desc\"`). Para o detalhe completo de uma ideia (texto, autor, se virou projeto de lei) chame `senado_ecidadania_obter_ideia` com o `id`.",
    {
      status: z.enum(["aberta", "encerrada", "convertida", "todas"]).optional().describe("Filtrar por status"),
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
        return resultWithProvenance(
          { count: arr.length, ideias: tagUntrustedList("ideias", arr as unknown as Record<string, unknown>[]), meta },
          provLista("/principalideia", "ideias", meta),
        );
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G6. senado_ecidadania_obter_ideia
  server.tool(
    "senado_ecidadania_obter_ideia",
    "Obtém o detalhe de uma ideia legislativa do e-Cidadania. Retorna um objeto com `id`, `titulo`, `descricao` (texto completo, truncado em ~2000 caracteres), `apoios`, `dataPublicacao`, `status`, `autor`, `comentarios`, `url` e `plConvertido` (sigla/número quando virou projeto de lei). Obtenha o `id` antes via `senado_ecidadania_listar_ideias`.",
    { id: z.number().int().positive().describe("ID da ideia legislativa") },
    async (params) => {
      try {
        const { value: r, fetchedAt } = await cachedFetchWithMeta("ecidadania_ideia", { id: params.id }, CACHE_ON_DEMAND, () =>
          obterIdeiaInternal(params.id),
        );
        writeDetalheThrough(db, ctx, "ideias", params.id, r as Record<string, unknown>);
        return resultWithProvenance(
          tagUntrustedFields("ideias", r as Record<string, unknown>),
          provDetalhe(r, `/visualizacaoideia?id=${params.id}`, `ideia=${params.id}`, fetchedAt),
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
        return resultWithProvenance(
          { count: eventos.length, eventos: tagUntrustedList("eventos", eventos as unknown as Record<string, unknown>[]), meta },
          provLista("/principalaudiencia", "eventos", meta),
        );
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G9. senado_ecidadania_obter_evento
  server.tool(
    "senado_ecidadania_obter_evento",
    "Obtém o detalhe de um evento interativo do e-Cidadania. Retorna um objeto com `id`, `titulo`, `descricao`, `data`, `hora`, `comissao` e `comissaoNomeCompleto`, `local`, `status`, `comentarios`, `url`, além de `pauta` (até 15 itens), `convidados` e `videoUrl` (embed do YouTube, quando houver). Obtenha o `id` antes via `senado_ecidadania_listar_eventos`.",
    { id: z.number().int().positive().describe("ID do evento") },
    async (params) => {
      try {
        const { value: r, fetchedAt } = await cachedFetchWithMeta("ecidadania_evento", { id: params.id }, CACHE_ON_DEMAND, () =>
          obterEventoInternal(params.id),
        );
        writeDetalheThrough(db, ctx, "eventos", params.id, r as Record<string, unknown>);
        // The static detail scrape can't read the AJAX-loaded comentarios count (always 0);
        // the listing corpus carries the authoritative qtdComentario. Splice it in, or null
        // when the event is not in the corpus (unknown, not a spurious 0).
        const detalhe = { ...(r as Record<string, unknown>) };
        try {
          const { items } = await resolveList(
            db, "eventos", corpusStaleMaxMin(),
            () => listarEventosInternal({ limite: 100 }),
            undefined, CORPUS_RESOLVE,
          );
          const corpusItem = (items as EventoResumo[]).find((e) => e.id === params.id);
          detalhe.comentarios = corpusItem ? corpusItem.comentarios : null;
        } catch {
          detalhe.comentarios = null;
        }
        return resultWithProvenance(
          tagUntrustedFields("eventos", detalhe),
          provDetalhe(r, `/visualizacaoaudiencia?id=${params.id}`, `evento=${params.id}`, fetchedAt),
        );
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G8. senado_ecidadania_sugerir_tema_enquete
  server.tool(
    "senado_ecidadania_sugerir_tema_enquete",
    "Sugere temas para uma enquete pública mensal (seleção de pauta): analisa o conjunto completo de consultas (abertas) e as ideias do e-Cidadania e elege as de maior engajamento cidadão, filtrando por polarização/consenso e participação mínima. Retorna `{ criteriosAplicados, totalAnalisados, count, sugestoes }` (até 10), cada sugestão com `tipo` (`consulta`/`ideia`), `id`, `titulo`, `motivo`, `metricas` (participação/polarização) e `url`, ordenadas por participação. Critérios opcionais em `criterios`: `evitarPolarizacao`/`evitarConsenso` (padrão true), `minimoParticipacao` (padrão 500), `apenasEmTramitacao` (padrão true → considera só consultas abertas, com base no status real). Para investigar uma sugestão, use `senado_ecidadania_obter_consulta` ou `senado_ecidadania_obter_ideia` conforme o `tipo`.",
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
        const ideias = iRes.items as IdeiaResumo[];

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
            tipo: "consulta", id: c.id, titulo: neutralizeUntrustedText(c.ementa.substring(0, 200)), motivo,
            metricas: { participacao: c.totalVotos, polarizacao: 100 - polarizacao },
            materiaRelacionada: c.materia ? neutralizeUntrustedText(c.materia) : undefined, url: c.url,
          });
        }

        for (const i of ideias) {
          if (i.apoios < (criterios.minimoParticipacao ?? 500)) continue;
          sugestoes.push({
            tipo: "ideia", id: i.id, titulo: neutralizeUntrustedText(i.titulo.substring(0, 200)),
            motivo: `Ideia popular com ${i.apoios.toLocaleString()} apoios`,
            metricas: { participacao: i.apoios }, url: i.url,
          });
        }

        sugestoes.sort((a, b) => b.metricas.participacao - a.metricas.participacao);

        return resultWithProvenance({
          criteriosAplicados: criterios,
          totalAnalisados: consultas.length + ideias.length,
          count: sugestoes.length,
          sugestoes: sugestoes.slice(0, 10),
          meta: { consultas: cRes.meta, ideias: iRes.meta },
        }, provLista("/principalmateria", "consultas+ideias", cRes.meta));
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G10. senado_ecidadania_consultas_votos (acervo histórico de votos por UF — CSV Arquimedes)
  server.tool(
    "senado_ecidadania_consultas_votos",
    "Acervo **histórico** de votos das consultas públicas do e-Cidadania, com **quebra por UF** (fonte: CSV Arquimedes; ~15 mil matérias, atualizado semanalmente). Diferente de `senado_ecidadania_listar_consultas` (consultas em tramitação): aqui o conjunto é o **arquivo** de matérias já consultadas — `status` vem como `Descontinuado` no arquivo de origem, por isso é tratado como acervo, não como opinião atual. Retorna `{ count, referencePeriod, consultas }`, cada item com `id`, `materia`, `ementa`, `autoria`, `votosSim`/`votosNao`/`totalVotos`, `votosPorUf` (`{ UF: { sim, nao } }`) e `url`. Use `ordenarPor` (`total`/`sim`/`nao`, padrão `total`) e `ordem` para ranking; `uf` para recortar e **ranquear por aquele estado** (só matérias com votos na UF, e cada item ganha `recorteUf`); `materia` para filtrar por código (numérico) ou trecho do nome/ementa; `limite` (padrão 20).",
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
          provenanceArquimedesVotos({
            reference_period: referencePeriod ?? undefined,
            retrieved_at: typeof meta.lastScrapedAt === "string" && meta.lastScrapedAt ? meta.lastScrapedAt : undefined,
          }),
        );
      } catch (e) { return ecidadaniaError(e); }
    },
  );
}
