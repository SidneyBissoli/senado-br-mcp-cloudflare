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
import { cachedFetchWithMeta } from "../cache/manager.js";
import { admFetch, admFetchLarge } from "../throttle/adm.js";
import { toolError, errorFrom, buildParams, ensureArray, normalizeText } from "../utils/validation.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
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
  return normalizeText(value).includes(normalizeText(filtro));
}

/**
 * Match a filter against a value that may be a plain string OR a nested object
 * exposing `sigla`/`nome` (e.g. lotacao {sigla,nome}, cargo {nome}). Matching such
 * objects with the string matcher yields "[object Object]" and never matches.
 */
export function matchesFiltroCampo(value: unknown, filtro: string): boolean {
  if (typeof value === "string") return matchesFiltro(value, filtro);
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return (
      (typeof v.sigla === "string" && matchesFiltro(v.sigla, filtro)) ||
      (typeof v.nome === "string" && matchesFiltro(v.nome, filtro))
    );
  }
  return false;
}

export function registerContratacoesTools(server: McpServer, admBaseUrl: string) {
  // Q1. senado_contratos
  server.tool(
    "senado_contratos",
    "Busca contratos administrativos do Senado por fornecedor, CNPJ, ano, número, objeto ou mão de obra (base completa baixada e filtrada no Worker; busca parcial sem acento em objeto/fornecedor/número). Retorna `{ count, total, contratos }`, onde cada item traz `id`, `numero`, `objeto`, `empresa {nome, cnpj}`, `subEspecie`, `dataAssinatura`, `vigencia` e `unidadeGestora`. Limitado a `limite` itens (padrão 50, máx 500), com `aviso` quando há truncamento. Use o `id` retornado em `senado_contratacao_detalhe` para itens, pagamentos, garantias ou aditivos.",
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
        // The upstream filters server-side but case/accent-sensitively (and rejects the
        // mao-de-obra param with HTTP 400), so fetch the full base once (cached) and filter
        // in-Worker for reliable, accent-insensitive results.
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_contratos", {}, CACHE_SEMI_STATIC,
          () => admFetchLarge("/contratacoes/contratos", {}, admBaseUrl),
        );
        let filtrados = ensureArray(response).map(parseContrato);
        if (params.objeto) filtrados = filtrados.filter((c) => matchesFiltro(c.objeto, params.objeto!));
        if (params.fornecedor) filtrados = filtrados.filter((c) => matchesFiltro(c.empresa?.nome, params.fornecedor!));
        if (params.numero) filtrados = filtrados.filter((c) => matchesFiltro(c.numero, params.numero!));
        if (params.cnpj) {
          const alvo = params.cnpj.replace(/\D/g, "");
          filtrados = filtrados.filter((c) => (c.empresa?.cnpj || "").replace(/\D/g, "") === alvo);
        }
        if (params.ano) filtrados = filtrados.filter((c) => String(c.dataAssinatura || "").startsWith(String(params.ano)));
        if (params.maoDeObra !== undefined) filtrados = filtrados.filter((c) => c.maoDeObra === params.maoDeObra);
        const limite = params.limite ?? 50;
        const contratos = filtrados.slice(0, limite);
        const prov = provenanceFor("SENADO_ADM", admBaseUrl, "/api/v1/contratacoes/contratos", {
          reference_period: params.ano ? String(params.ano) : undefined,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          count: contratos.length,
          total: filtrados.length,
          ...(filtrados.length > limite ? { aviso: `Exibindo ${limite} de ${filtrados.length} contratos. Refine os filtros.` } : {}),
          contratos,
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao buscar contratos");
      }
    },
  );

  // Q2. senado_contratacao_detalhe
  server.tool(
    "senado_contratacao_detalhe",
    "Detalha uma seção específica de uma contratação. O `tipo` indica a natureza do registro: `contratos` (contrato firmado), `atas_registro_preco` (ata de registro de preço — compromisso de preços para compras futuras) ou `notas_empenho` (nota de empenho — reserva orçamentária do gasto). A `secao` escolhe o aspecto: `itens`, `pagamentos`, `garantias`, `aditivos` (só `contratos`) ou `acionamentos` (só `atas_registro_preco`). Retorna `{ id, tipo, secao, count, total, itens }` com os registros brutos da seção (campos conforme a API administrativa), limitados a `limite` (padrão 100, máx 500); seção sem registros retorna `count` 0 e `itens` vazio. Obtenha o `id` antes via `senado_contratos` ou `senado_contratacoes_lista`; combinações de seção/tipo inválidas retornam erro.",
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
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_contratacao_detalhe",
          { tipo, id: params.id, secao: params.secao },
          CACHE_ON_DEMAND,
          () => admFetch(path, {}, admBaseUrl),
        );
        const todos = ensureArray(response);
        const limite = params.limite ?? 100;
        const prov = provenanceFor("SENADO_ADM", admBaseUrl, `/api/v1${path}`, {
          dataset_id: `${tipo}=${params.id}; secao=${params.secao}`, retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          id: params.id,
          tipo,
          secao: params.secao,
          count: Math.min(todos.length, limite),
          total: todos.length,
          itens: todos.slice(0, limite),
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao obter detalhe da contratação");
      }
    },
  );

  // Q3. senado_licitacoes
  server.tool(
    "senado_licitacoes",
    "Busca licitações do Senado por número exato (ex: `19/2018`) ou texto do objeto. Retorna `{ count, total, licitacoes }` com os registros brutos da API administrativa, limitados a `limite` (padrão 50, máx 500). Exige ao menos `numero` ou `objeto` (sem filtro retorna erro). Para o contrato resultante de uma licitação, use `senado_contratos`.",
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
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_licitacoes", qp, CACHE_SEMI_STATIC,
          () => admFetch("/contratacoes/licitacoes", qp, admBaseUrl),
        );
        const todos = ensureArray(response);
        const limite = params.limite ?? 50;
        const prov = provenanceFor("SENADO_ADM", admBaseUrl, "/api/v1/contratacoes/licitacoes", {
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          count: Math.min(todos.length, limite),
          total: todos.length,
          licitacoes: todos.slice(0, limite),
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao buscar licitações");
      }
    },
  );

  // Q4. senado_terceirizados
  server.tool(
    "senado_terceirizados",
    "Lista colaboradores terceirizados do Senado, filtráveis (busca parcial, sem acento) por nome, empresa contratada ou lotação. Retorna `{ count, total, terceirizados }`, cada item com `nome`, `cpf`, `situacao`, `empresa`, `lotacao` e `numeroContrato`. A lista completa é baixada e filtrada no Worker; resultados limitados a `limite` (padrão 50, máx 500), com `aviso` ao truncar. Para a empresa contratante e seus contratos, use `senado_empresas_contratadas`.",
    {
      nome: z.string().optional().describe("Nome do colaborador (busca parcial)"),
      empresa: z.string().optional().describe("Nome da empresa contratada (busca parcial)"),
      lotacao: z.string().optional().describe("Lotação/setor (busca parcial)"),
      limite: z.number().int().min(1).max(500).optional().default(50).describe("Máximo de resultados (padrão: 50)"),
    },
    async (params) => {
      try {
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_terceirizados", {}, CACHE_SEMI_STATIC,
          () => admFetch("/contratacoes/terceirizados", {}, admBaseUrl),
        );
        let lista = ensureArray(response).map(parseTerceirizado);
        if (params.nome) lista = lista.filter((t) => matchesFiltro(t.nome, params.nome!));
        if (params.empresa) lista = lista.filter((t) => matchesFiltro(t.empresa || "", params.empresa!));
        if (params.lotacao) lista = lista.filter((t) => matchesFiltroCampo(t.lotacao, params.lotacao!));
        const limite = params.limite ?? 50;
        const prov = provenanceFor("SENADO_ADM", admBaseUrl, "/api/v1/contratacoes/terceirizados", {
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          count: Math.min(lista.length, limite),
          total: lista.length,
          ...(lista.length > limite ? { aviso: `Exibindo ${limite} de ${lista.length} terceirizados. Refine os filtros.` } : {}),
          terceirizados: lista.slice(0, limite),
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao listar terceirizados");
      }
    },
  );

  // Q5. senado_empresas_contratadas
  server.tool(
    "senado_empresas_contratadas",
    "Busca empresas que contratam com o Senado por nome (mín. 3 caracteres) ou CNPJ/CPF (busca parcial). Retorna `{ count, total, empresas }`, cada item com `id`, `nome`, `cnpj`, `contratos` (até 30 números), `totalContratos`, `totalAtas` e `totalNotasEmpenho`. Exige `nome` ou `cnpj` (a base completa é grande); limitado a `limite` (padrão 20, máx 100). Use o `id`/número de contrato em `senado_contratos` ou `senado_contratacao_detalhe` para o detalhamento.",
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
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_empresas_contratadas", {}, CACHE_SEMI_STATIC,
          () => admFetchLarge("/contratacoes/empresas", {}, admBaseUrl),
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
        const prov = provenanceFor("SENADO_ADM", admBaseUrl, "/api/v1/contratacoes/empresas", {
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          count: resultado.length,
          total: empresas.length,
          empresas: resultado,
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao buscar empresas contratadas");
      }
    },
  );

  // Q6. senado_contratacoes_lista
  server.tool(
    "senado_contratacoes_lista",
    "Lista, conforme `tipo`, atas de registro de preço, notas de empenho ou menores aprendizes do Senado, com filtro textual opcional aplicado no Worker sobre todos os campos. Retorna `{ tipo, count, total, registros }`; para `atas_registro_preco`/`notas_empenho` cada registro segue o formato de contrato (`id`, `numero`, `objeto`, `empresa`, `subEspecie`, `vigencia`...), enquanto `menores_aprendizes` vêm como registros brutos da API (campos não normalizados). Limitado a `limite` (padrão 50, máx 500), com `aviso` ao truncar; `tipo` sem registros retorna lista vazia. Para aprofundar uma ata/empenho, use o `id` em `senado_contratacao_detalhe`.",
    {
      tipo: z.enum(["atas_registro_preco", "notas_empenho", "menores_aprendizes"]).describe("Qual lista consultar"),
      filtro: z.string().optional().describe("Filtro textual (empresa, objeto, etc.)"),
      limite: z.number().int().min(1).max(500).optional().default(50).describe("Máximo de resultados (padrão: 50)"),
    },
    async (params) => {
      try {
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
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
        const prov = provenanceFor("SENADO_ADM", admBaseUrl, `/api/v1/contratacoes/${params.tipo}`, {
          dataset_id: `tipo=${params.tipo}`, retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          tipo: params.tipo,
          count: Math.min(lista.length, limite),
          total: lista.length,
          ...(lista.length > limite ? { aviso: `Exibindo ${limite} de ${lista.length} registros.` } : {}),
          registros: lista.slice(0, limite),
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao consultar lista de contratações");
      }
    },
  );
}
