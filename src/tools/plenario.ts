/**
 * Group F — Plenary (1 tool)
 * senado_agenda_plenario
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, toolError, ensureArray } from "../utils/validation.js";
import { CACHE_DYNAMIC } from "../types.js";

function formatDateYMD(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export function registerPlenarioTools(server: McpServer, baseUrl: string) {
  // F1. senado_agenda_plenario
  server.tool(
    "senado_agenda_plenario",
    "Obtém agenda de sessões do plenário do Senado, incluindo pauta com matérias a serem votadas.",
    {
      data: z.string().regex(/^\d{8}$/).optional().describe("Data específica (YYYYMMDD)"),
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim (YYYYMMDD)"),
    },
    async (params) => {
      try {
        const data = params.data || formatDateYMD(new Date());
        const response = await cachedFetch("senado_agenda_plenario", { data }, CACHE_DYNAMIC, () =>
          upstreamFetch(`/plenario/agenda/dia/${data}`, {}, baseUrl),
        );
        const r = response as any;
        const sessoes = ensureArray(
          r?.Agenda?.Sessoes?.Sessao ??
          r?.AgendaPlenario?.Sessoes?.Sessao ??
          r?.Sessoes?.Sessao,
        ).map((s: any) => {
          const materias = ensureArray(s.Materias?.Materia);
          return {
            codigo: parseInt(s.CodigoSessao || s.Codigo || "0"),
            data: s.DataSessao || s.Data || "",
            hora: s.HoraInicioSessao || s.Hora || null,
            tipo: s.TipoSessao?.DescricaoTipoSessao || s.DescricaoTipoSessao || s.Tipo || null,
            situacao: s.SituacaoSessao?.DescricaoSituacaoSessao || s.Situacao || null,
            pauta: materias.length > 0
              ? materias.map((m: any) => ({
                  materia:
                    m.IdentificacaoMateria?.DescricaoIdentificacaoMateria ||
                    `${m.SiglaSubtipoMateria || ""} ${m.NumeroMateria || ""}/${m.AnoMateria || ""}`.trim() || null,
                  ementa: m.EmentaMateria || m.Ementa || null,
                  relator: m.Relator?.NomeRelator || null,
                }))
              : undefined,
          };
        });
        return toolResult({ data, count: sessoes.length, sessoes });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Erro ao obter agenda do plenário");
      }
    },
  );
}
