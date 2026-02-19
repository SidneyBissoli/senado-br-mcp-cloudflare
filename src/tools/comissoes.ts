/**
 * Group E — Committees (5 tools)
 * senado_listar_comissoes, senado_obter_comissao, senado_membros_comissao,
 * senado_reunioes_comissao, senado_agenda_comissoes
 *
 * Endpoints:
 *   /comissao/lista/colegiados  — list all active committees
 *   /comissao/{codigo}          — committee detail (numeric code, not sigla)
 *   /composicao/comissao/{codigo} — committee members
 *   /comissao/agenda/{data}     — agenda for a single date
 *   /comissao/agenda/{dataInicio}/{dataFim} — agenda for date range
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, toolError, ensureArray } from "../utils/validation.js";
import { CACHE_SEMI_STATIC, CACHE_DYNAMIC } from "../types.js";

function formatDateYMD(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** Resolve a committee sigla to its numeric code via the list endpoint. */
async function resolveComissaoCodigo(sigla: string, baseUrl: string): Promise<number | null> {
  const response = await cachedFetch("senado_listar_comissoes", {}, CACHE_SEMI_STATIC, () =>
    upstreamFetch("/comissao/lista/colegiados", {}, baseUrl),
  );
  const r = response as any;
  const comissoes = ensureArray(r?.ListaColegiados?.Colegiados?.Colegiado);
  const upper = sigla.toUpperCase();
  const match = comissoes.find((c: any) => (c.Sigla || "").toUpperCase() === upper);
  return match ? parseInt(match.Codigo || "0") : null;
}

export function registerComissoesTools(server: McpServer, baseUrl: string) {
  // E1. senado_listar_comissoes
  server.tool(
    "senado_listar_comissoes",
    "Lista comissões do Senado. Pode filtrar por tipo (permanente, temporária, CPI, mista) e status (ativa/inativa).",
    {
      tipo: z.enum(["permanente", "temporaria", "cpi", "mista"]).optional().describe("Tipo: permanente, temporaria, cpi, mista"),
      ativa: z.boolean().optional().describe("Apenas comissões ativas"),
    },
    async (params) => {
      try {
        const response = await cachedFetch("senado_listar_comissoes", {}, CACHE_SEMI_STATIC, () =>
          upstreamFetch("/comissao/lista/colegiados", {}, baseUrl),
        );
        const r = response as any;
        let comissoes = ensureArray(
          r?.ListaColegiados?.Colegiados?.Colegiado,
        ).map((c: any) => ({
          codigo: parseInt(c.Codigo || "0"),
          sigla: c.Sigla || "",
          nome: c.Nome || "",
          tipo: c.DescricaoTipoColegiado || null,
          casa: c.SiglaCasa || null,
          ativa: true, // this endpoint only returns active committees
        }));
        if (params.tipo) {
          const tipoMap: Record<string, string[]> = {
            permanente: ["permanente"],
            temporaria: ["temporária", "temporaria"],
            cpi: ["cpi", "comissão parlamentar de inquérito"],
            mista: ["mista"],
          };
          const valid = tipoMap[params.tipo] || [];
          comissoes = comissoes.filter((c) => c.tipo && valid.some((t) => c.tipo!.toLowerCase().includes(t)));
        }
        if (params.ativa === false) {
          comissoes = []; // this endpoint only returns active ones
        }
        return toolResult({ count: comissoes.length, comissoes });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Erro ao listar comissões");
      }
    },
  );

  // E2. senado_obter_comissao
  server.tool(
    "senado_obter_comissao",
    "Obtém detalhes de uma comissão, incluindo presidente, vice-presidente e finalidade.",
    {
      sigla: z.string().min(2).describe("Sigla da comissão (ex: CCJ, CAE)"),
    },
    async (params) => {
      try {
        const sigla = params.sigla.toUpperCase();
        const codigo = await resolveComissaoCodigo(sigla, baseUrl);
        if (!codigo) return toolError(`Comissão com sigla "${sigla}" não encontrada.`);

        const response = await cachedFetch("senado_obter_comissao", { codigo }, CACHE_SEMI_STATIC, () =>
          upstreamFetch(`/comissao/${codigo}`, {}, baseUrl),
        );
        const r = response as any;
        const colegiado = ensureArray(
          r?.ComissoesCongressoNacional?.Colegiados?.Colegiado,
        )[0];
        if (!colegiado) return toolError("Dados da comissão não encontrados.");

        const cargos = ensureArray(colegiado.Cargos?.Cargo);
        const presidente = cargos.find((c: any) => c.TipoCargo === "PRESIDENTE");
        const vicePresidente = cargos.find((c: any) => c.TipoCargo === "VICE-PRESIDENTE");

        return toolResult({
          codigo: parseInt(colegiado.CodigoColegiado || "0"),
          sigla: colegiado.SiglaColegiado || sigla,
          nome: colegiado.NomeColegiado || "",
          finalidade: colegiado.Finalidade || null,
          presidente: presidente
            ? { nome: presidente.NomeParlamentar || "", codigo: parseInt(presidente.CodigoParlamentar || "0"), bancada: presidente.Bancada || null }
            : null,
          vicePresidente: vicePresidente
            ? { nome: vicePresidente.NomeParlamentar || "", codigo: parseInt(vicePresidente.CodigoParlamentar || "0"), bancada: vicePresidente.Bancada || null }
            : null,
          totalMembros: parseInt(colegiado.QuantidadesMembros?.Distribuicao?.Senadores || "0") || null,
          titulares: parseInt(colegiado.QuantidadesMembros?.Distribuicao?.SenadoresTitulares || "0") || null,
          suplentes: parseInt(colegiado.QuantidadesMembros?.Distribuicao?.SenadoresSuplentes || "0") || null,
        });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Comissão não encontrada");
      }
    },
  );

  // E3. senado_membros_comissao
  server.tool(
    "senado_membros_comissao",
    "Lista membros atuais de uma comissão, incluindo cargo (presidente, vice, titular, suplente).",
    {
      sigla: z.string().min(2).describe("Sigla da comissão"),
    },
    async (params) => {
      try {
        const sigla = params.sigla.toUpperCase();
        const codigo = await resolveComissaoCodigo(sigla, baseUrl);
        if (!codigo) return toolError(`Comissão com sigla "${sigla}" não encontrada.`);

        const response = await cachedFetch("senado_membros_comissao", { codigo }, CACHE_SEMI_STATIC, () =>
          upstreamFetch(`/composicao/comissao/${codigo}`, {}, baseUrl),
        );
        const r = response as any;
        const membros = ensureArray(
          r?.UltimaComposicaoComissaoSf?.ComposicaoComissao?.Membros?.Membro,
        ).map((m: any) => ({
          codigo: parseInt(m.CodigoParlamentar || "0"),
          nome: m.NomeMembro || "",
          tipoVaga: m.TipoVaga || null,
          ativo: m.IndicadorVagaAtiva === "Sim",
          dataInicio: m.DataInicioMembroVaga || null,
        }));
        return toolResult({ sigla, count: membros.length, membros });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Erro ao obter membros da comissão");
      }
    },
  );

  // E4. senado_reunioes_comissao
  server.tool(
    "senado_reunioes_comissao",
    "Lista reuniões agendadas ou realizadas de uma comissão, com data, hora, local e pauta.",
    {
      sigla: z.string().min(2).describe("Sigla da comissão"),
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim (YYYYMMDD)"),
    },
    async (params) => {
      try {
        const sigla = params.sigla.toUpperCase();
        // Default to last 30 days if no dates provided
        const hoje = new Date();
        const inicio30 = new Date(hoje);
        inicio30.setDate(inicio30.getDate() - 30);
        const di = params.dataInicio || formatDateYMD(inicio30);
        const df = params.dataFim || formatDateYMD(hoje);

        // The /comissao/agenda endpoint doesn't support cross-year ranges.
        // Split into per-year requests if needed.
        const yearDi = parseInt(di.slice(0, 4));
        const yearDf = parseInt(df.slice(0, 4));
        let todas: any[] = [];
        if (yearDi === yearDf) {
          const response = await cachedFetch(
            "senado_reunioes_comissao",
            { sigla, dataInicio: di, dataFim: df },
            CACHE_DYNAMIC,
            () => upstreamFetch(`/comissao/agenda/${di}/${df}`, {}, baseUrl),
          );
          todas = ensureArray((response as any)?.AgendaReuniao?.reunioes?.reuniao);
        } else {
          // Split: [di..yearDi-12-31] + [yearDf-01-01..df]
          const r1 = await cachedFetch(
            "senado_reunioes_comissao_p1",
            { sigla, dataInicio: di, dataFim: `${yearDi}1231` },
            CACHE_DYNAMIC,
            () => upstreamFetch(`/comissao/agenda/${di}/${yearDi}1231`, {}, baseUrl),
          );
          const r2 = await cachedFetch(
            "senado_reunioes_comissao_p2",
            { sigla, dataInicio: `${yearDf}0101`, dataFim: df },
            CACHE_DYNAMIC,
            () => upstreamFetch(`/comissao/agenda/${yearDf}0101/${df}`, {}, baseUrl),
          );
          todas = [
            ...ensureArray((r1 as any)?.AgendaReuniao?.reunioes?.reuniao),
            ...ensureArray((r2 as any)?.AgendaReuniao?.reunioes?.reuniao),
          ];
        }
        const reunioes = todas
          .filter((re: any) => {
            const s = re.colegiadoCriador?.sigla || "";
            return s.toUpperCase() === sigla;
          })
          .map((re: any) => ({
            codigo: parseInt(re.codigo || "0"),
            descricao: re.descricao || re.titulo || "",
            data: re.dataInicio ? re.dataInicio.split("T")[0] : "",
            hora: re.dataInicio ? re.dataInicio.split("T")[1]?.slice(0, 5) || null : null,
            local: re.local || null,
            tipo: re.tipo?.descricao || null,
            situacao: re.situacao || null,
          }));
        return toolResult({ sigla, periodo: { dataInicio: di, dataFim: df }, count: reunioes.length, reunioes });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Erro ao obter reuniões da comissão");
      }
    },
  );

  // E5. senado_agenda_comissoes
  server.tool(
    "senado_agenda_comissoes",
    "Obtém agenda de reuniões das comissões do Senado. Pode filtrar por data e comissão específica.",
    {
      data: z.string().regex(/^\d{8}$/).optional().describe("Data específica (YYYYMMDD)"),
      siglaComissao: z.string().min(2).optional().describe("Filtrar por comissão específica"),
    },
    async (params) => {
      try {
        const data = params.data || formatDateYMD(new Date());
        const response = await cachedFetch("senado_agenda_comissoes", { data }, CACHE_DYNAMIC, () =>
          upstreamFetch(`/comissao/agenda/${data}`, {}, baseUrl),
        );
        const r = response as any;
        let reunioes = ensureArray(r?.AgendaReuniao?.reunioes?.reuniao).map((re: any) => {
          const com = re.colegiadoCriador || {};
          return {
            codigo: parseInt(re.codigo || "0"),
            comissao: { sigla: com.sigla || "", nome: com.nome || "" },
            descricao: re.descricao || re.titulo || "",
            data: re.dataInicio ? re.dataInicio.split("T")[0] : "",
            hora: re.dataInicio ? re.dataInicio.split("T")[1]?.slice(0, 5) || null : null,
            local: re.local || null,
            tipo: re.tipo?.descricao || null,
            situacao: re.situacao || null,
          };
        });
        if (params.siglaComissao) {
          const s = params.siglaComissao.toUpperCase();
          reunioes = reunioes.filter((r: any) => r.comissao.sigla.toUpperCase() === s);
        }
        return toolResult({ data, siglaComissao: params.siglaComissao || null, count: reunioes.length, reunioes });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Erro ao obter agenda das comissões");
      }
    },
  );
}
