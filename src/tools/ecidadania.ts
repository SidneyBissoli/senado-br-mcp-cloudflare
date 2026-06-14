/**
 * Group G — e-Cidadania (8 tools)
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
import { cachedFetch } from "../cache/manager.js";
import { toolResult, toolError } from "../utils/validation.js";
import { CACHE_DYNAMIC, CACHE_ON_DEMAND } from "../types.js";
import {
  ECIDADANIA_BASE,
  parseBrNum,
  extractId,
  normalizeEcidadaniaUrl,
  stripHtml,
  extractDate,
  extractTime,
  listarConsultasInternal,
  obterConsultaInternal,
  listarIdeiasInternal,
  obterIdeiaInternal,
  listarEventosInternal,
  obterEventoInternal,
  type ConsultaResumo,
  type IdeiaResumo,
  type EventoResumo,
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

export function registerECidadaniaTools(server: McpServer, _baseUrl: string) {
  function ecidadaniaError(e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro ao acessar e-Cidadania";
    const retryable = e instanceof Error && "retryable" in e && typeof (e as any).retryable === "boolean"
      ? (e as any).retryable
      : false;
    return toolError(`${msg}. As demais funcionalidades (senadores, matérias, votações) continuam operacionais.`, retryable);
  }

  // G1. senado_ecidadania_listar_consultas
  server.tool(
    "senado_ecidadania_listar_consultas",
    "Lista consultas públicas do e-Cidadania, em que cidadãos votam sim/não sobre matérias em tramitação. Retorna `{ count, consultas }`, cada consulta com `id`, `materia`, `ementa`, `votosSim`/`votosNao`/`totalVotos`, `percentualSim`/`percentualNao`, `status` e `url`; aceita filtro por `status` e `limite` (padrão 20). Para o detalhe de uma consulta chame `senado_ecidadania_obter_consulta` com o `id`; para recortes analíticos (consenso/polarização) use `senado_ecidadania_consultas_analise`.",
    {
      status: z.enum(["aberta", "encerrada", "todas"]).optional().describe("Filtrar por status"),
      limite: z.number().int().min(1).max(100).optional().default(20).describe("Número máximo de resultados"),
      pagina: z.number().int().min(1).optional().default(1).describe("Página de resultados"),
    },
    async (params) => {
      try {
        const all = await cachedFetch("ecidadania_consultas", { p: params.pagina }, CACHE_DYNAMIC, () =>
          listarConsultasInternal({ pagina: params.pagina, limite: 100 }),
        );
        let filtered = all as ConsultaResumo[];
        if (params.status && params.status !== "todas") filtered = filtered.filter((c) => c.status === params.status);
        return toolResult({ count: filtered.slice(0, params.limite).length, consultas: filtered.slice(0, params.limite) });
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
        const r = await cachedFetch("ecidadania_consulta", { id: params.id }, CACHE_ON_DEMAND, () =>
          obterConsultaInternal(params.id),
        );
        return toolResult(r);
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G3. senado_ecidadania_consultas_analise (modo: consenso | polarizada)
  server.tool(
    "senado_ecidadania_consultas_analise",
    "Analisa consultas públicas do e-Cidadania por grau de concordância cidadã, conforme `modo`: " +
      "`consenso` → consultas com alta concentração de votos numa direção, ordenadas da maior para a menor concentração; usa `percentualMinimo` (padrão 85%). " +
      "`polarizada` → consultas com votação equilibrada (~50/50), ordenadas da menor para a maior diferença sim/não; usa `margemPolarizacao` (padrão 15 pontos). " +
      "Ambos os modos aceitam `minimoVotos` (padrão 1000) e `limite` (padrão 10). Retorna `{ modo, criterio, count, consultas }`. " +
      "Para o detalhe de uma consulta use `senado_ecidadania_obter_consulta`.",
    {
      modo: z.enum(["consenso", "polarizada"]).optional().default("consenso").describe("consenso (alta concordância) ou polarizada (~50/50)"),
      percentualMinimo: z.number().int().min(50).max(100).optional().default(85).describe("Modo consenso: percentual mínimo numa direção"),
      margemPolarizacao: z.number().int().min(0).max(50).optional().default(15).describe("Modo polarizada: considera polarizado se diferença ≤ este percentual"),
      minimoVotos: z.number().int().min(0).optional().default(1000).describe("Mínimo de votos para considerar"),
      limite: z.number().int().min(1).max(50).optional().default(10).describe("Número máximo de resultados"),
    },
    async (params) => {
      try {
        const modo = params.modo ?? "consenso";
        const minimoVotos = params.minimoVotos ?? 1000;
        const limite = params.limite ?? 10;
        const all = await cachedFetch("ecidadania_consultas_full", {}, CACHE_DYNAMIC, () =>
          listarConsultasInternal({ limite: 100 }),
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
        return toolResult({ modo, criterio, count: filtered.length, consultas: filtered });
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G5. senado_ecidadania_listar_ideias
  server.tool(
    "senado_ecidadania_listar_ideias",
    "Lista ideias legislativas propostas por cidadãos no portal e-Cidadania. Retorna `{ count, ideias }`, cada ideia com código, título, autor, número de apoios e status; resultado paginado (padrão 20 por página, ordenável por apoios, data ou comentários). Para um ranking das mais apoiadas, ordene por apoios (`ordenarPor: \"apoios\"`, `ordem: \"desc\"`, opcionalmente `status: \"aberta\"`). Para o detalhe completo de uma ideia (texto, apoios, se virou projeto de lei) chame `senado_ecidadania_obter_ideia` com o código.",
    {
      status: z.enum(["aberta", "encerrada", "convertida", "todas"]).optional().describe("Filtrar por status"),
      ordenarPor: z.enum(["apoios", "data", "comentarios"]).optional().describe("Campo para ordenação"),
      ordem: z.enum(["asc", "desc"]).optional().describe("Ordem de ordenação"),
      limite: z.number().int().min(1).max(100).optional().default(20).describe("Número máximo de resultados"),
      pagina: z.number().int().min(1).optional().default(1).describe("Página de resultados"),
    },
    async (params) => {
      try {
        const ideias = await cachedFetch("ecidadania_ideias", params, CACHE_DYNAMIC, () =>
          listarIdeiasInternal(params),
        );
        return toolResult({ count: (ideias as IdeiaResumo[]).length, ideias });
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
        const r = await cachedFetch("ecidadania_ideia", { id: params.id }, CACHE_ON_DEMAND, () =>
          obterIdeiaInternal(params.id),
        );
        return toolResult(r);
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G7. senado_ecidadania_listar_eventos
  server.tool(
    "senado_ecidadania_listar_eventos",
    "Lista eventos interativos do e-Cidadania (audiências públicas, sabatinas, lives). Retorna `{ count, eventos }`, cada evento com `id`, `titulo`, `data`, `hora`, `comissao` (sigla), `comentarios`, `status` (`agendado`/`encerrado`) e `url`; aceita filtro por `status`, por `comissao` (sigla) e `limite` (padrão 20). Para um ranking dos mais comentados, ordene por comentários (`ordenarPor: \"comentarios\"`, `ordem: \"desc\"`). Para o detalhe completo de um evento use `senado_ecidadania_obter_evento`.",
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
        const todos = (await cachedFetch(
          "ecidadania_eventos",
          { status: params.status, comissao: params.comissao },
          CACHE_DYNAMIC,
          () => listarEventosInternal({ status: params.status, comissao: params.comissao, limite: 100 }),
        )) as EventoResumo[];
        let eventos = [...todos];
        if (params.ordenarPor === "comentarios") {
          eventos.sort((a, b) => (ordem === "asc" ? a.comentarios - b.comentarios : b.comentarios - a.comentarios));
        } else if (params.ordenarPor === "data") {
          eventos.sort((a, b) => {
            const da = a.data || "", db = b.data || "";
            return ordem === "asc" ? da.localeCompare(db) : db.localeCompare(da);
          });
        }
        eventos = eventos.slice(0, limite);
        return toolResult({ count: eventos.length, eventos });
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
        const r = await cachedFetch("ecidadania_evento", { id: params.id }, CACHE_ON_DEMAND, () =>
          obterEventoInternal(params.id),
        );
        return toolResult(r);
      } catch (e) { return ecidadaniaError(e); }
    },
  );

  // G8. senado_ecidadania_sugerir_tema_enquete
  server.tool(
    "senado_ecidadania_sugerir_tema_enquete",
    "Sugere temas para uma enquete pública mensal (seleção de pauta): analisa as consultas e ideias do e-Cidadania e elege as de maior engajamento cidadão, filtrando por polarização/consenso e participação mínima. Retorna `{ criteriosAplicados, totalAnalisados, count, sugestoes }` (até 10), cada sugestão com `tipo` (`consulta`/`ideia`), `id`, `titulo`, `motivo`, `metricas` (participação/polarização) e `url`, ordenadas por participação. Critérios opcionais em `criterios`: `evitarPolarizacao`/`evitarConsenso` (padrão true), `minimoParticipacao` (padrão 500), `apenasEmTramitacao`. Para investigar uma sugestão, use `senado_ecidadania_obter_consulta` ou `senado_ecidadania_obter_ideia` conforme o `tipo`.",
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

        const [consultas, ideias] = await Promise.all([
          cachedFetch("ecidadania_consultas_full", {}, CACHE_DYNAMIC, () =>
            listarConsultasInternal({ limite: 50 }),
          ) as Promise<ConsultaResumo[]>,
          cachedFetch("ecidadania_ideias_sug", {}, CACHE_DYNAMIC, () =>
            listarIdeiasInternal({ status: "aberta", limite: 50, ordenarPor: "apoios", ordem: "desc" }),
          ) as Promise<IdeiaResumo[]>,
        ]);

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
            tipo: "consulta", id: c.id, titulo: c.ementa.substring(0, 200), motivo,
            metricas: { participacao: c.totalVotos, polarizacao: 100 - polarizacao },
            materiaRelacionada: c.materia || undefined, url: c.url,
          });
        }

        for (const i of ideias) {
          if (i.apoios < (criterios.minimoParticipacao ?? 500)) continue;
          sugestoes.push({
            tipo: "ideia", id: i.id, titulo: i.titulo.substring(0, 200),
            motivo: `Ideia popular com ${i.apoios.toLocaleString()} apoios`,
            metricas: { participacao: i.apoios }, url: i.url,
          });
        }

        sugestoes.sort((a, b) => b.metricas.participacao - a.metricas.participacao);

        return toolResult({
          criteriosAplicados: criterios,
          totalAnalisados: consultas.length + ideias.length,
          count: sugestoes.length,
          sugestoes: sugestoes.slice(0, 10),
        });
      } catch (e) { return ecidadaniaError(e); }
    },
  );
}
