/**
 * Group E — Committees (5 tools)
 * senado_listar_comissoes, senado_obter_comissao, senado_membros_comissao,
 * senado_reunioes_comissao, senado_agenda_comissoes
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, toolError, buildParams, ensureArray } from "../utils/validation.js";
import { CACHE_SEMI_STATIC, CACHE_DYNAMIC } from "../types.js";

function parseComissaoResumo(c: any) {
  const id = c.IdentificacaoComissao || c;
  return {
    codigo: parseInt(id.CodigoComissao || c.Codigo || "0"),
    sigla: id.SiglaComissao || c.Sigla || "",
    nome: id.NomeComissao || c.Nome || "",
    tipo: c.TipoComissao?.DescricaoTipoComissao || c.Tipo || null,
    casa: id.SiglaCasaComissao || c.Casa || null,
    ativa: c.DataFim === null || c.DataFim === undefined,
  };
}

function parseParlamentarComissao(m: any) {
  const id = m.IdentificacaoParlamentar || m;
  return {
    codigo: parseInt(id.CodigoParlamentar || "0"),
    nome: id.NomeParlamentar || m.NomeParlamentar || "",
    partido: id.SiglaPartidoParlamentar || m.SiglaPartido || null,
    uf: id.UfParlamentar || m.UfParlamentar || null,
  };
}

function parseComissaoDetalhe(dados: any) {
  const c = dados.Comissao || dados;
  const id = c.IdentificacaoComissao || {};
  let presidente = null;
  let vicePresidente = null;
  const pres = c.Presidente || c.MembroPresidente;
  if (pres) presidente = parseParlamentarComissao(pres);
  const vice = c.VicePresidente || c.MembroVicePresidente;
  if (vice) vicePresidente = parseParlamentarComissao(vice);
  return {
    codigo: parseInt(id.CodigoComissao || c.Codigo || "0"),
    sigla: id.SiglaComissao || c.Sigla || "",
    nome: id.NomeComissao || c.Nome || "",
    tipo: c.TipoComissao?.DescricaoTipoComissao || c.Tipo || null,
    casa: id.SiglaCasaComissao || c.Casa || null,
    ativa: c.DataFim === null || c.DataFim === undefined,
    dataInicio: c.DataInicio || null,
    dataFim: c.DataFim || null,
    finalidade: c.Finalidade || null,
    presidente,
    vicePresidente,
  };
}

function formatDateYMD(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
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
          upstreamFetch("/comissao/lista", {}, baseUrl),
        );
        const r = response as any;
        let comissoes = ensureArray(
          r?.ListaComissoes?.Comissoes?.Comissao ?? r?.Comissoes?.Comissao,
        ).map(parseComissaoResumo);
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
        if (params.ativa !== undefined) {
          comissoes = comissoes.filter((c) => c.ativa === params.ativa);
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
        const response = await cachedFetch("senado_obter_comissao", { sigla }, CACHE_SEMI_STATIC, () =>
          upstreamFetch(`/comissao/${sigla}`, {}, baseUrl),
        );
        const dados = (response as any).DetalheComissao || response;
        return toolResult(parseComissaoDetalhe(dados));
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
        const response = await cachedFetch("senado_membros_comissao", { sigla }, CACHE_SEMI_STATIC, () =>
          upstreamFetch(`/comissao/${sigla}/composicao`, {}, baseUrl),
        );
        const r = response as any;
        const membros = ensureArray(
          r?.ComposicaoComissao?.Comissao?.Membros?.Membro ?? r?.Membros?.Membro,
        ).map((m: any) => ({
          ...parseParlamentarComissao(m),
          cargo: m.DescricaoCargo || m.Cargo || null,
          titular: m.DescricaoParticipacao !== "Suplente",
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
        const qp = buildParams({ dataInicio: params.dataInicio, dataFim: params.dataFim });
        const response = await cachedFetch("senado_reunioes_comissao", { sigla, ...qp }, CACHE_DYNAMIC, () =>
          upstreamFetch(`/comissao/${sigla}`, qp, baseUrl),
        );
        const r = response as any;
        const reunioes = ensureArray(
          r?.DetalheComissao?.Comissao?.Reunioes?.Reuniao ?? r?.Reunioes?.Reuniao,
        ).map((re: any) => ({
          codigo: parseInt(re.CodigoReuniao || re.Codigo || "0"),
          data: re.DataReuniao || re.Data || "",
          hora: re.HoraReuniao || re.Hora || null,
          local: re.LocalReuniao || re.Local || null,
          tipo: re.TipoReuniao?.DescricaoTipoReuniao || re.Tipo || null,
          situacao: re.SituacaoReuniao?.DescricaoSituacaoReuniao || re.Situacao || null,
          pauta: re.Pauta || re.DescricaoPauta || null,
        }));
        return toolResult({ sigla, count: reunioes.length, reunioes });
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
          upstreamFetch(`/agenda/${data}`, {}, baseUrl),
        );
        const r = response as any;
        let reunioes = ensureArray(
          r?.Agenda?.Reunioes?.Reuniao ?? r?.AgendaComissoes?.Reunioes?.Reuniao ?? r?.Reunioes?.Reuniao,
        ).map((re: any) => {
          const com = re.Comissao || re.IdentificacaoComissao || {};
          return {
            codigo: parseInt(re.CodigoReuniao || re.Codigo || "0"),
            comissao: { sigla: com.SiglaComissao || com.Sigla || "", nome: com.NomeComissao || com.Nome || "" },
            data: re.DataReuniao || re.Data || "",
            hora: re.HoraReuniao || re.Hora || null,
            local: re.LocalReuniao || re.Local || null,
            tipo: re.TipoReuniao?.DescricaoTipoReuniao || re.Tipo || null,
            situacao: re.SituacaoReuniao?.DescricaoSituacaoReuniao || re.Situacao || null,
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
