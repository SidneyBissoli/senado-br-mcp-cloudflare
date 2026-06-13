/**
 * Group Q — Contratações / Procurement (6 tools)
 * senado_contratos, senado_contratacao_detalhe, senado_licitacoes,
 * senado_terceirizados, senado_empresas_contratadas, senado_contratacoes_lista
 *
 * Consumes the ADMINISTRATIVE open data API (adm.senado.gov.br) via admFetch.
 * Responses are flat snake_case JSON arrays.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { admFetch, admFetchLarge } from "../throttle/adm.js";
import { toolResult, toolError, errorFrom, buildParams, ensureArray } from "../utils/validation.js";
import { CACHE_SEMI_STATIC, CACHE_ON_DEMAND } from "../types.js";

/** Parse a contract / ata / nota de empenho list item (snake_case). */
export function parseContrato(c: any) {
  return {
    id: c.id ?? null,
    numero: c.numero_formatado || c.numero || null,
    objeto: typeof c.objeto === "string" ? c.objeto : null,
    empresa: c.empresa ? { nome: c.empresa.nome || null, cnpj: c.empresa.cpf_cnpj || null } : null,
    licitacao: c.licitacao?.numero || c.licitacao || null,
    subEspecie: c.sub_especie?.descricao || c.sub_especie?.sigla || c.sub_especie || null,
    dataAssinatura: c.data_assinatura || null,
    vigencia: { inicio: c.data_inicio_vigencia || null, fim: c.data_fim_vigencia || null },
    maoDeObra: c.ind_mao_de_obra === "S" || c.ind_mao_de_obra === true,
    unidadeGestora: c.unidade_gestora?.nome || c.unidade_gestora || null,
  };
}

/** Parse an outsourced collaborator item. */
export function parseTerceirizado(t: any) {
  return {
    nome: t.nome || "",
    cpf: t.cpf || null,
    situacao: t.situacao || null,
    empresa: t.empresa?.nome || t.empresa || null,
    lotacao: t.lotacao || null,
    numeroContrato: t.numeroContrato || null,
  };
}

/** Case/accent-insensitive substring match. */
export function matchesFiltro(value: unknown, filtro: string): boolean {
  if (typeof value !== "string") return false;
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return norm(value).includes(norm(filtro));
}

export function registerContratacoesTools(server: McpServer, admBaseUrl: string) {
  // Q1. senado_contratos
  server.tool(
    "senado_contratos",
    "Busca contratos administrativos do Senado por fornecedor, CNPJ, ano, número ou objeto. Filtros aplicados pela própria API.",
    {
      fornecedor: z.string().optional().describe("Nome do fornecedor (busca parcial)"),
      cnpj: z.string().optional().describe("CNPJ/CPF exato do fornecedor"),
      ano: z.number().int().min(1990).max(2100).optional().describe("Ano do contrato"),
      numero: z.string().optional().describe("Número do contrato (busca parcial)"),
      objeto: z.string().optional().describe("Texto no objeto do contrato"),
      maoDeObra: z.boolean().optional().describe("Apenas contratos com mão de obra residente"),
      limite: z.number().int().min(1).max(500).optional().default(50).describe("Máximo de resultados (padrão: 50)"),
    },
    async (params) => {
      try {
        const qp = buildParams({
          nomeFornecedorContains: params.fornecedor,
          cnpjCpfEquals: params.cnpj,
          anoEquals: params.ano,
          numeroContains: params.numero,
          objetoDescricaoContains: params.objeto,
          maoDeObraEquals: params.maoDeObra !== undefined ? (params.maoDeObra ? "S" : "N") : undefined,
        });
        const response = await cachedFetch("senado_contratos", qp, CACHE_SEMI_STATIC, () =>
          admFetch("/contratacoes/contratos", qp, admBaseUrl),
        );
        const todos = ensureArray(response).map(parseContrato);
        const limite = params.limite ?? 50;
        const contratos = todos.slice(0, limite);
        return toolResult({
          count: contratos.length,
          total: todos.length,
          ...(todos.length > limite ? { aviso: `Exibindo ${limite} de ${todos.length} contratos. Refine os filtros.` } : {}),
          contratos,
        });
      } catch (e) {
        return errorFrom(e, "Erro ao buscar contratos");
      }
    },
  );

  // Q2. senado_contratacao_detalhe
  server.tool(
    "senado_contratacao_detalhe",
    "Detalhes de uma contratação (contrato, ata de registro de preço ou nota de empenho): itens, pagamentos, garantias, aditivos ou acionamentos.",
    {
      id: z.number().int().positive().describe("ID da contratação (campo 'id' das listas de contratos/atas/empenhos)"),
      tipo: z.enum(["contratos", "atas_registro_preco", "notas_empenho"]).optional().default("contratos").describe("Tipo da contratação"),
      secao: z.enum(["itens", "pagamentos", "garantias", "aditivos", "acionamentos"]).describe("aditivos: apenas contratos; acionamentos: apenas atas"),
      limite: z.number().int().min(1).max(500).optional().default(100).describe("Máximo de itens (padrão: 100)"),
    },
    async (params) => {
      try {
        const tipo = params.tipo ?? "contratos";
        let path: string;
        if (params.secao === "aditivos") {
          if (tipo !== "contratos") return toolError("A seção 'aditivos' só existe para tipo=contratos.");
          path = `/contratacoes/contratos/${params.id}/aditivos`;
        } else if (params.secao === "acionamentos") {
          if (tipo !== "atas_registro_preco") return toolError("A seção 'acionamentos' só existe para tipo=atas_registro_preco.");
          path = `/contratacoes/atas_registro_preco/${params.id}/acionamentos`;
        } else {
          path = `/contratacoes/${tipo}/${params.id}/${params.secao}`;
        }
        const response = await cachedFetch(
          "senado_contratacao_detalhe",
          { tipo, id: params.id, secao: params.secao },
          CACHE_ON_DEMAND,
          () => admFetch(path, {}, admBaseUrl),
        );
        const todos = ensureArray(response);
        const limite = params.limite ?? 100;
        return toolResult({
          id: params.id,
          tipo,
          secao: params.secao,
          count: Math.min(todos.length, limite),
          total: todos.length,
          itens: todos.slice(0, limite),
        });
      } catch (e) {
        return errorFrom(e, "Erro ao obter detalhe da contratação");
      }
    },
  );

  // Q3. senado_licitacoes
  server.tool(
    "senado_licitacoes",
    "Busca licitações do Senado por número ou texto do objeto.",
    {
      numero: z.string().optional().describe("Número exato da licitação (ex: 19/2018)"),
      objeto: z.string().optional().describe("Texto no objeto da licitação"),
      limite: z.number().int().min(1).max(500).optional().default(50).describe("Máximo de resultados (padrão: 50)"),
    },
    async (params) => {
      try {
        const qp = buildParams({
          numeroEquals: params.numero,
          objetoContains: params.objeto,
        });
        if (Object.keys(qp).length === 0) {
          return toolError("Informe 'numero' ou 'objeto' para a busca.");
        }
        const response = await cachedFetch("senado_licitacoes", qp, CACHE_SEMI_STATIC, () =>
          admFetch("/contratacoes/licitacoes", qp, admBaseUrl),
        );
        const todos = ensureArray(response);
        const limite = params.limite ?? 50;
        return toolResult({
          count: Math.min(todos.length, limite),
          total: todos.length,
          licitacoes: todos.slice(0, limite),
        });
      } catch (e) {
        return errorFrom(e, "Erro ao buscar licitações");
      }
    },
  );

  // Q4. senado_terceirizados
  server.tool(
    "senado_terceirizados",
    "Lista colaboradores terceirizados do Senado, filtráveis por nome, empresa ou lotação.",
    {
      nome: z.string().optional().describe("Nome do colaborador (busca parcial)"),
      empresa: z.string().optional().describe("Nome da empresa contratada (busca parcial)"),
      lotacao: z.string().optional().describe("Lotação/setor (busca parcial)"),
      limite: z.number().int().min(1).max(500).optional().default(50).describe("Máximo de resultados (padrão: 50)"),
    },
    async (params) => {
      try {
        const response = await cachedFetch("senado_terceirizados", {}, CACHE_SEMI_STATIC, () =>
          admFetch("/contratacoes/terceirizados", {}, admBaseUrl),
        );
        let lista = ensureArray(response).map(parseTerceirizado);
        if (params.nome) lista = lista.filter((t) => matchesFiltro(t.nome, params.nome!));
        if (params.empresa) lista = lista.filter((t) => matchesFiltro(t.empresa || "", params.empresa!));
        if (params.lotacao) lista = lista.filter((t) => matchesFiltro(t.lotacao || "", params.lotacao!));
        const limite = params.limite ?? 50;
        return toolResult({
          count: Math.min(lista.length, limite),
          total: lista.length,
          ...(lista.length > limite ? { aviso: `Exibindo ${limite} de ${lista.length} terceirizados. Refine os filtros.` } : {}),
          terceirizados: lista.slice(0, limite),
        });
      } catch (e) {
        return errorFrom(e, "Erro ao listar terceirizados");
      }
    },
  );

  // Q5. senado_empresas_contratadas
  server.tool(
    "senado_empresas_contratadas",
    "Busca empresas que contratam com o Senado, com seus contratos, atas e empenhos. Exige filtro por nome ou CNPJ (a base completa é grande).",
    {
      nome: z.string().min(3).optional().describe("Nome da empresa (busca parcial, mín. 3 caracteres)"),
      cnpj: z.string().optional().describe("CNPJ/CPF (busca parcial)"),
      limite: z.number().int().min(1).max(100).optional().default(20).describe("Máximo de empresas (padrão: 20)"),
    },
    async (params) => {
      try {
        if (!params.nome && !params.cnpj) {
          return toolError("Informe 'nome' ou 'cnpj' para a busca.");
        }
        const response = await cachedFetch("senado_empresas_contratadas", {}, CACHE_SEMI_STATIC, () =>
          admFetchLarge("/contratacoes/empresas", {}, admBaseUrl),
        );
        let empresas = ensureArray(response);
        if (params.nome) empresas = empresas.filter((e: any) => matchesFiltro(e.nome, params.nome!));
        if (params.cnpj) {
          const alvo = params.cnpj.replace(/\D/g, "");
          empresas = empresas.filter((e: any) =>
            typeof e.cpf_cnpj === "string" && e.cpf_cnpj.replace(/\D/g, "").includes(alvo));
        }
        const limite = params.limite ?? 20;
        const resultado = empresas.slice(0, limite).map((e: any) => ({
          id: e.id ?? null,
          nome: e.nome || "",
          cnpj: e.cpf_cnpj || null,
          contratos: ensureArray(e.contratos).map((c: any) => c.numero_formatado || c.numero || c.id).slice(0, 30),
          totalContratos: ensureArray(e.contratos).length,
          totalAtas: ensureArray(e.atas_registro_preco).length,
          totalNotasEmpenho: ensureArray(e.notas_empenho).length,
        }));
        return toolResult({
          count: resultado.length,
          total: empresas.length,
          empresas: resultado,
        });
      } catch (e) {
        return errorFrom(e, "Erro ao buscar empresas contratadas");
      }
    },
  );

  // Q6. senado_contratacoes_lista
  server.tool(
    "senado_contratacoes_lista",
    "Lista atas de registro de preço, notas de empenho ou menores aprendizes do Senado, com filtro textual.",
    {
      tipo: z.enum(["atas_registro_preco", "notas_empenho", "menores_aprendizes"]).describe("Qual lista consultar"),
      filtro: z.string().optional().describe("Filtro textual (empresa, objeto, etc.)"),
      limite: z.number().int().min(1).max(500).optional().default(50).describe("Máximo de resultados (padrão: 50)"),
    },
    async (params) => {
      try {
        const response = await cachedFetch(
          "senado_contratacoes_lista",
          { tipo: params.tipo },
          CACHE_SEMI_STATIC,
          () => admFetch(`/contratacoes/${params.tipo}`, {}, admBaseUrl),
        );
        let lista = ensureArray(response);
        if (params.tipo !== "menores_aprendizes") {
          lista = lista.map(parseContrato);
        }
        if (params.filtro) {
          const f = params.filtro;
          lista = lista.filter((item: any) => matchesFiltro(JSON.stringify(item), f));
        }
        const limite = params.limite ?? 50;
        return toolResult({
          tipo: params.tipo,
          count: Math.min(lista.length, limite),
          total: lista.length,
          ...(lista.length > limite ? { aviso: `Exibindo ${limite} de ${lista.length} registros.` } : {}),
          registros: lista.slice(0, limite),
        });
      } catch (e) {
        return errorFrom(e, "Erro ao consultar lista de contratações");
      }
    },
  );
}
