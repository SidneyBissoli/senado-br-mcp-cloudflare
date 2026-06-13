/**
 * Group F — Plenary (7 tools)
 * senado_agenda_plenario, senado_resultado_plenario, senado_orientacao_bancada,
 * senado_vetos, senado_resultado_veto, senado_encontro_plenario,
 * senado_tabelas_plenario
 *
 * Mix of legacy endpoints (PascalCase wrappers, YYYYMMDD dates) and the flat
 * camelCase orientacaoBancada endpoint.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, toolError, errorFrom, ensureArray, safeInt } from "../utils/validation.js";
import { CACHE_DYNAMIC, CACHE_ON_DEMAND, CACHE_STATIC } from "../types.js";

function formatDateYMD(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Strip legacy response noise: unwrap a single top-level wrapper key and drop
 * Metadados / metadados / noNamespaceSchemaLocation.
 */
export function stripWrapper(response: any): any {
  if (response == null || typeof response !== "object" || Array.isArray(response)) return response;
  const drop = new Set(["Metadados", "metadados", "noNamespaceSchemaLocation"]);
  let obj = response;
  // Unwrap only while the object is a pure single-key wrapper around another object
  for (let i = 0; i < 4; i++) {
    const keys = Object.keys(obj);
    if (keys.length === 1 && obj[keys[0]] !== null &&
        typeof obj[keys[0]] === "object" && !Array.isArray(obj[keys[0]])) {
      obj = obj[keys[0]];
    } else {
      break;
    }
  }
  if (Array.isArray(obj)) return obj;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!drop.has(k)) clean[k] = v;
  }
  return clean;
}

/** Find the first nested array within an object (depth-limited). */
export function firstArrayDeep(obj: any, depth = 4): any[] {
  if (Array.isArray(obj)) return obj;
  if (obj == null || typeof obj !== "object" || depth <= 0) return [];
  for (const v of Object.values(obj)) {
    const found = firstArrayDeep(v, depth - 1);
    if (found.length > 0 || Array.isArray(v)) return found;
  }
  return [];
}

/** Extract Sessoes.Sessao[] from any ResultadoPlenario* wrapper. */
export function extractSessoesResultado(response: any): any[] {
  const body = stripWrapper(response);
  return ensureArray(body?.Sessoes?.Sessao ?? body?.Sessao);
}

/** Parse a session from a plenary result response. */
export function parseSessaoResultado(s: any) {
  return {
    codigoSessao: safeInt(s.codigoSessao || s.CodigoSessao),
    numeroSessao: safeInt(s.numeroSessao || s.NumeroSessao),
    data: s.dataSessao || s.DataSessao || null,
    hora: s.horaSessao || s.HoraSessao || null,
    tipo: s.descricaoTipoSessao || s.DescricaoTipoSessao || s.tipoSessao || null,
    casa: s.siglaCasa || s.SiglaCasa || null,
    itens: ensureArray(s.Itens?.Item ?? s.itens).map((i: any) => ({
      codigoMateria: safeInt(i.codigoMateria || i.CodigoMateria) || null,
      identificacao: (i.identificacao || i.Identificacao || "").trim() || null,
      ementa: i.ementa || i.Ementa || null,
      resultado: i.descricaoResultado || i.DescricaoResultado || i.resultado || null,
      parecer: typeof (i.parecer ?? i.Parecer) === "string" ? (i.parecer ?? i.Parecer).trim() : null,
    })),
  };
}

/** Parse an orientacaoBancada votacao item (flat camelCase). */
export function parseOrientacaoVotacao(v: any) {
  return {
    codigoVotacao: v.codigoVotacaoSve ?? null,
    descricao: v.descricaoVotacao || null,
    materia: v.descricaoMateria ||
      (v.siglaTipoMateria ? `${v.siglaTipoMateria} ${v.numeroMateria}/${v.anoMateria}` : null),
    dataInicio: v.dataInicioVotacao || null,
    sessao: v.descricaoSessao || null,
    totalSim: v.qtdVotosSim ?? null,
    totalNao: v.qtdVotosNao ?? null,
    totalAbstencao: v.qtdVotosAbstencao ?? null,
    obstrucoes: v.qtdObstrucoes ?? null,
    orientacoes: ensureArray(v.orientacoesLideranca).map((o: any) => ({
      partido: o.partido || null,
      voto: o.voto || null,
    })),
  };
}

/** Parse a veto list item (legacy PascalCase). */
export function parseVeto(v: any) {
  const mat = v.Materia || {};
  const vetada = v.MateriaVetada || {};
  return {
    codigo: safeInt(v.Codigo) || null,
    identificacao: mat.Sigla ? `${mat.Sigla} ${mat.Numero}/${mat.Ano}` : null,
    ementa: mat.Ementa || null,
    emTramitacao: mat.EmTramitacao === "Sim",
    materiaVetada: vetada.Sigla ? {
      codigo: safeInt(vetada.Codigo) || null,
      identificacao: `${vetada.Sigla} ${vetada.Numero}/${vetada.Ano}`,
    } : null,
    dataLimiteVotacao: v.DataLimiteVotacao || v.PrazoVotacao || null,
    tipo: v.TipoVeto || v.DescricaoTipoVeto || null,
  };
}

export function registerPlenarioTools(server: McpServer, baseUrl: string) {
  // F1. senado_agenda_plenario
  server.tool(
    "senado_agenda_plenario",
    "Obtém agenda de sessões de plenário (Senado ou Congresso Nacional), por dia ou mês, incluindo pauta com matérias a serem votadas.",
    {
      data: z.string().regex(/^\d{8}$/).optional().describe("Data específica (YYYYMMDD; padrão: hoje)"),
      escopo: z.enum(["dia", "mes", "cn"]).optional().default("dia").describe("dia = SF+CN no dia; mes = mês inteiro; cn = plenário do Congresso"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim para período do CN (YYYYMMDD; apenas escopo=cn)"),
    },
    async (params) => {
      try {
        const data = params.data || formatDateYMD(new Date());
        const escopo = params.escopo ?? "dia";
        let path: string;
        if (escopo === "mes") {
          path = `/plenario/agenda/mes/${data}`;
        } else if (escopo === "cn") {
          path = params.dataFim
            ? `/plenario/agenda/cn/${data}/${params.dataFim}`
            : `/plenario/agenda/cn/${data}`;
        } else {
          path = `/plenario/agenda/dia/${data}`;
        }
        const response = await cachedFetch("senado_agenda_plenario", { path }, CACHE_DYNAMIC, () =>
          upstreamFetch(path, {}, baseUrl),
        );
        const r = response as any;
        const sessoes = ensureArray(
          r?.Agenda?.Sessoes?.Sessao ??
          r?.AgendaPlenario?.Sessoes?.Sessao ??
          r?.Sessoes?.Sessao ??
          firstArrayDeep(stripWrapper(r)),
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
        return toolResult({ data, escopo, count: sessoes.length, sessoes });
      } catch (e) {
        return errorFrom(e, "Erro ao obter agenda do plenário");
      }
    },
  );

  // F2. senado_resultado_plenario
  server.tool(
    "senado_resultado_plenario",
    "Resultado das sessões plenárias numa data: itens de pauta apreciados, pareceres e resultados. Escopo: Senado (sf), Congresso (cn) ou mês inteiro (mes).",
    {
      data: z.string().regex(/^\d{8}$/).describe("Data da sessão (YYYYMMDD); para escopo=mes, qualquer dia do mês"),
      escopo: z.enum(["sf", "cn", "mes"]).optional().default("sf").describe("sf = Senado no dia; cn = Congresso no dia; mes = resumo do mês"),
    },
    async (params) => {
      try {
        const escopo = params.escopo ?? "sf";
        const path = escopo === "cn"
          ? `/plenario/resultado/cn/${params.data}`
          : escopo === "mes"
            ? `/plenario/resultado/mes/${params.data}`
            : `/plenario/resultado/${params.data}`;
        const response = await cachedFetch("senado_resultado_plenario", { path }, CACHE_ON_DEMAND, () =>
          upstreamFetch(path, {}, baseUrl),
        );
        const sessoes = extractSessoesResultado(response).map(parseSessaoResultado);
        return toolResult({ data: params.data, escopo, count: sessoes.length, sessoes });
      } catch (e) {
        return errorFrom(e, "Erro ao obter resultado do plenário");
      }
    },
  );

  // F3. senado_orientacao_bancada
  server.tool(
    "senado_orientacao_bancada",
    "Orientação de bancada nas votações de plenário: como cada liderança partidária orientou o voto, com placar da votação. Essencial para análise de disciplina partidária.",
    {
      data: z.string().regex(/^\d{8}$/).optional().describe("Data da sessão (YYYYMMDD)"),
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Data início do período (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim do período (YYYYMMDD)"),
    },
    async (params) => {
      try {
        let path: string;
        if (params.dataInicio && params.dataFim) {
          path = `/plenario/votacao/orientacaoBancada/${params.dataInicio}/${params.dataFim}`;
        } else if (params.data) {
          path = `/plenario/votacao/orientacaoBancada/${params.data}`;
        } else {
          return toolError("Informe 'data' ou o período 'dataInicio'/'dataFim'.");
        }
        const response = await cachedFetch("senado_orientacao_bancada", { path }, CACHE_ON_DEMAND, () =>
          upstreamFetch(path, {}, baseUrl),
        );
        const r = response as any;
        const votacoes = ensureArray(r?.votacoes ?? r).map(parseOrientacaoVotacao);
        return toolResult({ count: votacoes.length, votacoes });
      } catch (e) {
        return errorFrom(e, "Erro ao obter orientação de bancada");
      }
    },
  );

  // F4. senado_vetos
  server.tool(
    "senado_vetos",
    "Lista vetos presidenciais em apreciação pelo Congresso Nacional — por ano ou por status de tramitação.",
    {
      ano: z.number().int().min(1990).max(2100).optional().describe("Vetos do ano informado"),
      status: z.enum(["tramitando", "antes-rcn", "encerrados"]).optional().describe("tramitando = pós-RCN 1/2013 em tramitação (padrão); antes-rcn = anteriores à RCN; encerrados = tramitação encerrada"),
      limite: z.number().int().min(1).max(500).optional().default(100).describe("Máximo de resultados (padrão: 100)"),
    },
    async (params) => {
      try {
        const path = params.ano
          ? `/materia/vetos/${params.ano}`
          : params.status === "antes-rcn"
            ? "/materia/vetos/antesrcn"
            : params.status === "encerrados"
              ? "/materia/vetos/encerrados"
              : "/materia/vetos/aposrcn";
        const response = await cachedFetch("senado_vetos", { path }, CACHE_ON_DEMAND, () =>
          upstreamFetch(path, {}, baseUrl),
        );
        const body = stripWrapper(response);
        const todos = ensureArray((body as any)?.Vetos?.Veto ?? firstArrayDeep(body)).map(parseVeto);
        const limite = params.limite ?? 100;
        const vetos = todos.slice(0, limite);
        return toolResult({
          count: vetos.length,
          total: todos.length,
          ...(todos.length > limite ? { aviso: `Exibindo ${limite} de ${todos.length} vetos.` } : {}),
          vetos,
        });
      } catch (e) {
        return errorFrom(e, "Erro ao listar vetos");
      }
    },
  );

  // F5. senado_resultado_veto
  server.tool(
    "senado_resultado_veto",
    "Resultado da votação nominal de um veto presidencial — pelo código do veto, da matéria vetada ou do dispositivo (em vetos parciais).",
    {
      codigo: z.number().int().positive().describe("Código do veto, da matéria ou do dispositivo, conforme o tipo"),
      tipo: z.enum(["veto", "materia", "dispositivo"]).optional().default("veto").describe("veto = código do veto (padrão); materia = código do projeto vetado; dispositivo = dispositivo de veto parcial"),
    },
    async (params) => {
      try {
        const tipo = params.tipo ?? "veto";
        const path = tipo === "materia"
          ? `/plenario/resultado/veto/materia/${params.codigo}`
          : tipo === "dispositivo"
            ? `/plenario/resultado/veto/dispositivo/${params.codigo}`
            : `/plenario/resultado/veto/${params.codigo}`;
        const response = await cachedFetch("senado_resultado_veto", { path }, CACHE_ON_DEMAND, () =>
          upstreamFetch(path, {}, baseUrl),
        );
        return toolResult({ codigo: params.codigo, tipo, resultado: stripWrapper(response) });
      } catch (e) {
        return errorFrom(e, "Erro ao obter resultado do veto");
      }
    },
  );

  // F6. senado_encontro_plenario
  server.tool(
    "senado_encontro_plenario",
    "Detalhes de um encontro legislativo (sessão de plenário): dados gerais, pauta, resultado ou resumo. O código vem da agenda ou do resultado do plenário.",
    {
      codigo: z.number().int().positive().describe("Código do encontro/sessão"),
      secao: z.enum(["detalhes", "pauta", "resultado", "resumo"]).optional().default("detalhes").describe("Qual seção do encontro consultar"),
    },
    async (params) => {
      try {
        const secao = params.secao ?? "detalhes";
        const path = secao === "detalhes"
          ? `/plenario/encontro/${params.codigo}`
          : `/plenario/encontro/${params.codigo}/${secao}`;
        const response = await cachedFetch("senado_encontro_plenario", { path }, CACHE_ON_DEMAND, () =>
          upstreamFetch(path, {}, baseUrl),
        );
        const body = stripWrapper(response);
        const encontros = ensureArray((body as any)?.encontros?.encontro ?? body);
        return toolResult({
          codigo: params.codigo,
          secao,
          encontro: encontros.length === 1 ? encontros[0] : encontros,
        });
      } catch (e) {
        return errorFrom(e, "Erro ao obter encontro do plenário");
      }
    },
  );

  // F7. senado_tabelas_plenario
  server.tool(
    "senado_tabelas_plenario",
    "Tabelas de referência do plenário: tipos de sessão, tipos de comparecimento em votações e lista de legislaturas com sessões legislativas.",
    {
      tabela: z.enum(["tipos-sessao", "tipos-comparecimento", "legislaturas"]).describe("Tabela de referência a consultar"),
      filtro: z.string().optional().describe("Filtro textual"),
      limite: z.number().int().min(1).max(500).optional().default(100).describe("Máximo de linhas (padrão: 100)"),
    },
    async (params) => {
      try {
        const path = params.tabela === "tipos-sessao"
          ? "/plenario/tiposSessao"
          : params.tabela === "tipos-comparecimento"
            ? "/plenario/lista/tiposComparecimento"
            : "/plenario/lista/legislaturas";
        const response = await cachedFetch(
          "senado_tabelas_plenario",
          { tabela: params.tabela },
          CACHE_STATIC,
          () => upstreamFetch(path, {}, baseUrl),
        );
        let linhas = firstArrayDeep(stripWrapper(response));
        if (params.filtro) {
          const f = params.filtro.toLowerCase();
          linhas = linhas.filter((l: any) => JSON.stringify(l).toLowerCase().includes(f));
        }
        const limite = params.limite ?? 100;
        return toolResult({
          tabela: params.tabela,
          count: Math.min(linhas.length, limite),
          total: linhas.length,
          linhas: linhas.slice(0, limite),
        });
      } catch (e) {
        return errorFrom(e, "Erro ao consultar tabela do plenário");
      }
    },
  );
}
