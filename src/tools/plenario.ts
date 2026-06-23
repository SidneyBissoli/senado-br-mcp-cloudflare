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
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolError, errorFrom, ensureArray, safeInt } from "../utils/validation.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
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
    "Obtém a agenda de sessões de plenário (Senado ou Congresso Nacional), por dia ou mês, com a pauta de matérias a votar. Retorna `{ data, escopo, count, sessoes }`, onde cada sessão traz `codigo`, `data`, `hora`, `tipo`, `situacao` e `pauta` (matéria, ementa, relator). Use `escopo` dia/mes/cn; sem `data` assume hoje. Para o resultado já apreciado use `senado_resultado_plenario`; detalhes de uma sessão via `senado_encontro_plenario`.",
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
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_agenda_plenario", { path }, CACHE_DYNAMIC,
          () => upstreamFetch(path, {}, baseUrl),
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
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          reference_period: data, retrieved_at: fetchedAt,
        });
        return resultWithProvenance({ data, escopo, count: sessoes.length, sessoes }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao obter agenda do plenário");
      }
    },
  );

  // F2. senado_resultado_plenario
  server.tool(
    "senado_resultado_plenario",
    "Resultado das sessões plenárias numa data: itens de pauta apreciados, pareceres e resultados. Retorna `{ data, escopo, count, sessoes }` (todas as sessões da data, sem paginação), com cada sessão trazendo `codigoSessao`, `numeroSessao`, `data`, `hora`, `tipo`, `casa` e `itens` (`codigoMateria`, `identificacao`, `ementa`, `resultado`, `parecer` — `resultado`/`parecer` podem vir `null` em itens ainda não deliberados). Sem sessão na data, `count` é 0 e `sessoes` vem vazio. `escopo`: sf (Senado), cn (Congresso) ou mes (resumo do mês). Para a pauta prévia use `senado_agenda_plenario`; orientação de bancada via `senado_orientacao_bancada`.",
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
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_resultado_plenario", { path }, CACHE_ON_DEMAND,
          () => upstreamFetch(path, {}, baseUrl),
        );
        const sessoes = extractSessoesResultado(response).map(parseSessaoResultado);
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          reference_period: params.data, retrieved_at: fetchedAt,
        });
        return resultWithProvenance({ data: params.data, escopo, count: sessoes.length, sessoes }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao obter resultado do plenário");
      }
    },
  );

  // F3. senado_orientacao_bancada
  server.tool(
    "senado_orientacao_bancada",
    "Orientação de bancada nas votações de plenário: como cada liderança partidária orientou o voto, com placar — essencial para análise de disciplina partidária. Retorna `{ count, votacoes }`, com cada votação trazendo `codigoVotacao`, `descricao`, `materia`, `dataInicio`, `sessao`, totais (`totalSim`, `totalNao`, `totalAbstencao`, `obstrucoes`) e `orientacoes` (`partido`, `voto`). Informe `data` (um dia) ou o período `dataInicio`/`dataFim`. Para o resultado das sessões use `senado_resultado_plenario`.",
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
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_orientacao_bancada", { path }, CACHE_ON_DEMAND,
          () => upstreamFetch(path, {}, baseUrl),
        );
        const r = response as any;
        const votacoes = ensureArray(r?.votacoes ?? r).map(parseOrientacaoVotacao);
        const periodo = params.dataInicio && params.dataFim
          ? `${params.dataInicio}/${params.dataFim}`
          : params.data;
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          reference_period: periodo, retrieved_at: fetchedAt,
        });
        return resultWithProvenance({ count: votacoes.length, votacoes }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao obter orientação de bancada");
      }
    },
  );

  // F4. senado_vetos
  server.tool(
    "senado_vetos",
    "Lista vetos presidenciais em apreciação pelo Congresso Nacional, por ano ou por status de tramitação. Retorna `{ count, total, aviso?, vetos }`, com cada veto trazendo `codigo`, `identificacao`, `ementa`, `emTramitacao`, `materiaVetada` e `dataLimiteVotacao`. `limite` controla o corte (padrão 100; `aviso` indica truncagem). Informe `ano` OU `status` (tramitando/antes-rcn/encerrados). Para o resultado da votação de um veto use `senado_resultado_veto`.",
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
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_vetos", { path }, CACHE_ON_DEMAND,
          () => upstreamFetch(path, {}, baseUrl),
        );
        const body = stripWrapper(response);
        const todos = ensureArray((body as any)?.Vetos?.Veto ?? firstArrayDeep(body)).map(parseVeto);
        const limite = params.limite ?? 100;
        const vetos = todos.slice(0, limite);
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          reference_period: params.ano ? String(params.ano) : undefined,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          count: vetos.length,
          total: todos.length,
          ...(todos.length > limite ? { aviso: `Exibindo ${limite} de ${todos.length} vetos.` } : {}),
          vetos,
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao listar vetos");
      }
    },
  );

  // F5. senado_resultado_veto
  server.tool(
    "senado_resultado_veto",
    "Resultado da votação nominal de um veto presidencial. Retorna `{ codigo, tipo, resultado }`, onde `resultado` é o objeto bruto da API (já sem wrappers), com campos variáveis conforme o veto — tipicamente identificação do veto, sessão/data, placar e situação da apreciação; pode vir objeto vazio quando o veto ainda não foi votado, e a chamada retorna erro se o `codigo` não existir. Informe `codigo` e `tipo`: veto (código do veto, padrão), materia (código do projeto vetado) ou dispositivo (dispositivo de veto parcial). Obtenha o código do veto via `senado_vetos`.",
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
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_resultado_veto", { path }, CACHE_ON_DEMAND,
          () => upstreamFetch(path, {}, baseUrl),
        );
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          dataset_id: `${tipo}=${params.codigo}`, retrieved_at: fetchedAt,
        });
        return resultWithProvenance({ codigo: params.codigo, tipo, resultado: stripWrapper(response) }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao obter resultado do veto");
      }
    },
  );

  // F6. senado_encontro_plenario
  server.tool(
    "senado_encontro_plenario",
    "Detalhes de um encontro legislativo (sessão de plenário). Retorna `{ codigo, secao, encontro }`, onde `encontro` é o objeto bruto da API (ou array, quando o upstream traz vários) cujos campos variam conforme a `secao` escolhida: `detalhes` (padrão) traz dados gerais da sessão (tipo, data, situação, presença); `pauta` traz as matérias previstas; `resultado` traz os itens apreciados e seus resultados; `resumo` traz uma síntese. `encontro` pode vir vazio se a seção não tiver dados, e a chamada retorna erro se o `codigo` não existir. Obtenha o `codigo` via `senado_agenda_plenario` ou `senado_resultado_plenario`.",
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
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_encontro_plenario", { path }, CACHE_ON_DEMAND,
          () => upstreamFetch(path, {}, baseUrl),
        );
        const body = stripWrapper(response);
        const encontros = ensureArray((body as any)?.encontros?.encontro ?? body);
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          dataset_id: `encontro=${params.codigo}; secao=${secao}`, retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          codigo: params.codigo,
          secao,
          encontro: encontros.length === 1 ? encontros[0] : encontros,
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao obter encontro do plenário");
      }
    },
  );

  // F7. senado_tabelas_plenario
  server.tool(
    "senado_tabelas_plenario",
    "Tabelas de referência do plenário para resolver códigos e domínios. Retorna `{ tabela, count, total, linhas }` com as linhas da tabela escolhida em `tabela`: tipos-sessao, tipos-comparecimento ou legislaturas. `filtro` faz busca textual e `limite` corta o resultado (padrão 100). Use para interpretar campos como `tipo` retornados por `senado_agenda_plenario` e `senado_resultado_plenario`.",
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
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
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
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          dataset_id: `tabela=${params.tabela}`, retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          tabela: params.tabela,
          count: Math.min(linhas.length, limite),
          total: linhas.length,
          linhas: linhas.slice(0, limite),
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao consultar tabela do plenário");
      }
    },
  );
}
