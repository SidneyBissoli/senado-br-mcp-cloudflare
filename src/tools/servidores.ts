/**
 * Group P — Servidores / Gestão de Pessoas (4 tools)
 * senado_servidores, senado_remuneracoes_servidores, senado_horas_extras,
 * senado_pessoal_tabelas (funde os antigos quantitativos_pessoal + pessoal_listas)
 *
 * Consumes the ADMINISTRATIVE open data API. The remunerações dataset is
 * ~5.5 MB/month and the servidores lists are ~3 MB, so both use the raised
 * size guard and are filtered in-Worker.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { admFetch, admFetchLarge } from "../throttle/adm.js";
import { errorFrom, ensureArray } from "../utils/validation.js";
import { unwrapAdmEnvelope } from "../utils/upstream-parse.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
import { CACHE_SEMI_STATIC, CACHE_STATIC } from "../types.js";
import { matchesFiltro } from "./contratacoes.js";

/** Parse a civil-servant list item (snake_case). */
export function parseServidor(s: any) {
  return {
    nome: s.nome || "",
    vinculo: s.vinculo || null,
    situacao: s.situacao || null,
    cargo: s.cargo || null,
    especialidade: s.especialidade || null,
    funcao: s.funcao || null,
    lotacao: s.lotacao || null,
    categoria: s.categoria || null,
    cedido: s.cedido || null,
    anoAdmissao: s.ano_admissao ?? null,
  };
}

/** Sum the numeric fields of a remuneration item (gross composition). */
export function resumoRemuneracao(r: any) {
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    nome: r.nome || "",
    tipoFolha: r.tipo_folha || null,
    remuneracaoBasica: num(r.remuneracao_basica),
    vantagensPessoais: num(r.vantagens_pessoais),
    funcaoComissionada: num(r.funcao_comissionada),
    gratificacaoNatalina: num(r.gratificacao_natalina),
    horasExtras: num(r.horas_extras),
    outrasEventuais: num(r.outras_eventuais),
    abonoPermanencia: num(r.abono_permanencia),
    diarias: num(r.diarias),
    auxilios: num(r.auxilios),
    bruto: Math.round((num(r.remuneracao_basica) + num(r.vantagens_pessoais) + num(r.funcao_comissionada) +
      num(r.gratificacao_natalina) + num(r.horas_extras) + num(r.outras_eventuais) + num(r.abono_permanencia)) * 100) / 100,
  };
}

export function registerServidoresTools(server: McpServer, admBaseUrl: string) {
  // P1. senado_servidores
  server.tool(
    "senado_servidores",
    "Lista servidores do Senado por `situacao` (ativos, efetivos, comissionados ou inativos), com filtros opcionais por `nome`, `lotacao` e `cargo`. Retorna `{ situacao, count, total, servidores[] }`, cada item com `nome`, `vinculo`, `situacao`, `cargo`, `funcao`, `lotacao`, `anoAdmissao` etc. Aplica `limite` (padrão 50, máx 500) e inclui `aviso` quando há truncamento — refine os filtros. Para remuneração use `senado_remuneracoes_servidores`; para estagiários/pensionistas/quantitativos use `senado_pessoal_tabelas`.",
    {
      situacao: z.enum(["ativos", "efetivos", "comissionados", "inativos"]).optional().default("ativos").describe("Qual lista consultar (padrão: ativos)"),
      nome: z.string().optional().describe("Nome do servidor (busca parcial)"),
      lotacao: z.string().optional().describe("Lotação/setor (busca parcial, ex: SEGRAF)"),
      cargo: z.string().optional().describe("Cargo (busca parcial)"),
      limite: z.number().int().min(1).max(500).optional().default(50).describe("Máximo de resultados (padrão: 50)"),
    },
    async (params) => {
      try {
        const situacao = params.situacao ?? "ativos";
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_servidores",
          { situacao },
          CACHE_SEMI_STATIC,
          () => admFetchLarge(`/servidores/servidores/${situacao}`, {}, admBaseUrl),
        );
        let lista = ensureArray(response).map(parseServidor);
        if (params.nome) lista = lista.filter((s) => matchesFiltro(s.nome, params.nome!));
        if (params.lotacao) lista = lista.filter((s) => matchesFiltro(s.lotacao || "", params.lotacao!));
        if (params.cargo) lista = lista.filter((s) => matchesFiltro(s.cargo || "", params.cargo!));
        const limite = params.limite ?? 50;
        const prov = provenanceFor("SENADO_ADM", admBaseUrl, `/api/v1/servidores/servidores/${situacao}`, {
          dataset_id: `servidores; situacao=${situacao}`, retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          situacao,
          count: Math.min(lista.length, limite),
          total: lista.length,
          ...(lista.length > limite ? { aviso: `Exibindo ${limite} de ${lista.length} servidores. Refine os filtros.` } : {}),
          servidores: lista.slice(0, limite),
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao listar servidores");
      }
    },
  );

  // P2. senado_remuneracoes_servidores
  server.tool(
    "senado_remuneracoes_servidores",
    "Remunerações dos servidores do Senado em `ano`/`mes` de referência (a partir de 2013). `modo=resumo` (padrão) retorna `{ ano, mes, totalRegistros, resumo[] }` agregado por `tipoFolha` com `registros`, `totalBruto` e `mediaBruta`; `modo=detalhe` retorna `{ count, total, remuneracoes[] }` com a composição individual (`remuneracaoBasica`, `vantagensPessoais`, `funcaoComissionada`, `horasExtras`, `bruto` etc.), limitada por `limite` (padrão 50, máx 500) com `aviso` se truncado. Filtre por `nome` ou `tipoFolha` no detalhe para evitar listas longas. Para o cadastro de servidores use `senado_servidores`.",
    {
      ano: z.number().int().min(2013).max(2100).describe("Ano de referência"),
      mes: z.number().int().min(1).max(12).describe("Mês de referência"),
      modo: z.enum(["resumo", "detalhe"]).optional().default("resumo").describe("resumo = totais por tipo de folha (padrão); detalhe = composição individual"),
      nome: z.string().optional().describe("Nome do servidor (busca parcial)"),
      tipoFolha: z.string().optional().describe("Filtrar por tipo de folha (busca parcial)"),
      limite: z.number().int().min(1).max(500).optional().default(50).describe("Máximo de linhas no modo detalhe (padrão: 50)"),
    },
    async (params) => {
      try {
        const { value: bruto, fetchedAt } = await cachedFetchWithMeta(
          "senado_remuneracoes_servidores",
          { ano: params.ano, mes: params.mes },
          CACHE_STATIC,
          () => admFetchLarge(`/servidores/remuneracoes/${params.ano}/${params.mes}`, {}, admBaseUrl),
        );
        let itens = ensureArray(bruto);
        if (params.nome) itens = itens.filter((r: any) => matchesFiltro(r.nome, params.nome!));
        if (params.tipoFolha) itens = itens.filter((r: any) => matchesFiltro(r.tipo_folha || "", params.tipoFolha!));

        const prov = provenanceFor("SENADO_ADM", admBaseUrl, `/api/v1/servidores/remuneracoes/${params.ano}/${params.mes}`, {
          dataset_id: `remuneracoes; ${params.ano}/${params.mes}`,
          reference_period: `${params.ano}-${String(params.mes).padStart(2, "0")}`,
          retrieved_at: fetchedAt,
        });
        if ((params.modo ?? "resumo") === "detalhe") {
          const limite = params.limite ?? 50;
          return resultWithProvenance({
            ano: params.ano,
            mes: params.mes,
            count: Math.min(itens.length, limite),
            total: itens.length,
            ...(itens.length > limite ? { aviso: `Exibindo ${limite} de ${itens.length} registros. Filtre por nome ou use modo=resumo.` } : {}),
            remuneracoes: itens.slice(0, limite).map(resumoRemuneracao),
          }, prov);
        }

        const porFolha = new Map<string, { registros: number; totalBruto: number }>();
        for (const r of itens) {
          const k = (r as any).tipo_folha || "(sem tipo)";
          const g = porFolha.get(k) ?? { registros: 0, totalBruto: 0 };
          const linha = resumoRemuneracao(r);
          g.registros += 1;
          g.totalBruto += linha.bruto;
          porFolha.set(k, g);
        }
        const resumo = Array.from(porFolha.entries())
          .map(([tipoFolha, g]) => ({
            tipoFolha,
            registros: g.registros,
            totalBruto: Math.round(g.totalBruto * 100) / 100,
            mediaBruta: Math.round((g.totalBruto / g.registros) * 100) / 100,
          }))
          .sort((a, b) => b.totalBruto - a.totalBruto);
        return resultWithProvenance({ ano: params.ano, mes: params.mes, totalRegistros: itens.length, resumo }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao consultar remunerações");
      }
    },
  );

  // P3. senado_horas_extras
  server.tool(
    "senado_horas_extras",
    "Horas extras pagas a servidores do Senado em `ano`/`mes` de referência (a partir de 2013). Retorna `{ ano, mes, count, total, valorTotal, horasExtras[] }`, onde `valorTotal` soma o gasto do mês e cada item traz `nome`, `valorTotal`, `horasExtras`, `competencia` e `pagamento`. Filtro opcional por `nome` (busca parcial) e `limite` (padrão 100, máx 500). Para a remuneração completa do servidor use `senado_remuneracoes_servidores`.",
    {
      ano: z.number().int().min(2013).max(2100).describe("Ano de referência"),
      mes: z.number().int().min(1).max(12).describe("Mês de referência"),
      nome: z.string().optional().describe("Nome do servidor (busca parcial)"),
      limite: z.number().int().min(1).max(500).optional().default(100).describe("Máximo de resultados (padrão: 100)"),
    },
    async (params) => {
      try {
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_horas_extras",
          { ano: params.ano, mes: params.mes },
          CACHE_STATIC,
          () => admFetch(`/servidores/horas-extras/${params.ano}/${params.mes}`, {}, admBaseUrl),
        );
        let itens = ensureArray(response).map((h: any) => ({
          nome: h.nome || "",
          valorTotal: h.valorTotal ?? null,
          competencia: h.mes_ano_prestacao || null,
          pagamento: h.mes_ano_pagamento || null,
          horasExtras: h.horas_extras ?? null,
        }));
        if (params.nome) itens = itens.filter((h) => matchesFiltro(h.nome, params.nome!));
        const valorTotal = Math.round(itens.reduce((s, h) => s + (typeof h.valorTotal === "number" ? h.valorTotal : 0), 0) * 100) / 100;
        const limite = params.limite ?? 100;
        const prov = provenanceFor("SENADO_ADM", admBaseUrl, `/api/v1/servidores/horas-extras/${params.ano}/${params.mes}`, {
          dataset_id: `horas-extras; ${params.ano}/${params.mes}`,
          reference_period: `${params.ano}-${String(params.mes).padStart(2, "0")}`,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          ano: params.ano,
          mes: params.mes,
          count: Math.min(itens.length, limite),
          total: itens.length,
          valorTotal,
          horasExtras: itens.slice(0, limite),
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao consultar horas extras");
      }
    },
  );

  // P4. senado_pessoal_tabelas (quantitativos agregados + listas nominais sob um só enum)
  server.tool(
    "senado_pessoal_tabelas",
    "Tabelas de pessoal do Senado conforme o parâmetro `tabela`. Quantitativos agregados: `pessoal` (força de trabalho por classe/escolaridade), `cargos-funcoes` (cargos em comissão e funções de confiança), `previsao-aposentadoria`, `senadores`. Listas nominais: `estagiarios` (ativos), `pensionistas`, `lotacoes` (setores), `cargos` (nomes de cargos). Retorna `{ tabela, count, total, aviso?, registros[] }` — registros agregados (nos quantitativos) ou nominais (nas listas), conforme a `tabela`, limitados por `limite` (padrão 100, máx 2000); `count` 0 e lista vazia quando a tabela não tem registros. O `filtro` textual opcional casa contra qualquer campo do registro. Para o cadastro nominal de servidores efetivos/comissionados use `senado_servidores`.",
    {
      tabela: z.enum([
        "pessoal", "cargos-funcoes", "previsao-aposentadoria", "senadores",
        "estagiarios", "pensionistas", "lotacoes", "cargos",
      ]).describe("Qual tabela de pessoal consultar (quantitativo agregado ou lista nominal)"),
      filtro: z.string().optional().describe("Filtro textual (nome, curso, setor...)"),
      limite: z.number().int().min(1).max(2000).optional().default(100).describe("Máximo de registros (padrão: 100)"),
    },
    async (params) => {
      try {
        const QUANTITATIVOS: Record<string, string> = {
          "pessoal": "/servidores/quantitativos/pessoal",
          "cargos-funcoes": "/servidores/quantitativos/cargos-funcoes",
          "previsao-aposentadoria": "/servidores/previsao-aposentadoria",
          "senadores": "/senadores/quantitativos/senadores",
        };
        const isQuantitativo = params.tabela in QUANTITATIVOS;
        const path = isQuantitativo ? QUANTITATIVOS[params.tabela] : `/servidores/${params.tabela}`;
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_pessoal_tabelas",
          { tabela: params.tabela },
          isQuantitativo ? CACHE_STATIC : CACHE_SEMI_STATIC,
          () => admFetch(path, {}, admBaseUrl),
        );
        // Some adm endpoints (estagiarios) wrap the payload in {statusCode,msg,data};
        // others serve a flat array. unwrapAdmEnvelope handles both.
        let registros = ensureArray(unwrapAdmEnvelope(response));
        if (params.filtro) {
          const f = params.filtro;
          registros = registros.filter((item: any) => matchesFiltro(JSON.stringify(item), f));
        }
        const limite = params.limite ?? 100;
        const prov = provenanceFor("SENADO_ADM", admBaseUrl, `/api/v1${path}`, {
          dataset_id: `tabela=${params.tabela}`, retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          tabela: params.tabela,
          count: Math.min(registros.length, limite),
          total: registros.length,
          ...(registros.length > limite ? { aviso: `Exibindo ${limite} de ${registros.length} registros.` } : {}),
          registros: registros.slice(0, limite),
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao consultar tabela de pessoal");
      }
    },
  );
}
