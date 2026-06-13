/**
 * Group P — Servidores / Gestão de Pessoas (5 tools)
 * senado_servidores, senado_remuneracoes_servidores, senado_horas_extras,
 * senado_quantitativos_pessoal, senado_pessoal_listas
 *
 * Consumes the ADMINISTRATIVE open data API. The remunerações dataset is
 * ~5.5 MB/month and the servidores lists are ~3 MB, so both use the raised
 * size guard and are filtered in-Worker.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { admFetch, admFetchLarge } from "../throttle/adm.js";
import { toolResult, errorFrom, ensureArray } from "../utils/validation.js";
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
    "Lista servidores do Senado por situação (ativos, efetivos, comissionados ou inativos), com filtros por nome, lotação e cargo.",
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
        const response = await cachedFetch(
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
        return toolResult({
          situacao,
          count: Math.min(lista.length, limite),
          total: lista.length,
          ...(lista.length > limite ? { aviso: `Exibindo ${limite} de ${lista.length} servidores. Refine os filtros.` } : {}),
          servidores: lista.slice(0, limite),
        });
      } catch (e) {
        return errorFrom(e, "Erro ao listar servidores");
      }
    },
  );

  // P2. senado_remuneracoes_servidores
  server.tool(
    "senado_remuneracoes_servidores",
    "Remunerações dos servidores do Senado num mês de referência. Modo 'resumo' agrega totais por tipo de folha; modo 'detalhe' lista a composição da remuneração (filtre por nome para evitar listas longas).",
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
        const bruto = await cachedFetch(
          "senado_remuneracoes_servidores",
          { ano: params.ano, mes: params.mes },
          CACHE_STATIC,
          () => admFetchLarge(`/servidores/remuneracoes/${params.ano}/${params.mes}`, {}, admBaseUrl),
        );
        let itens = ensureArray(bruto);
        if (params.nome) itens = itens.filter((r: any) => matchesFiltro(r.nome, params.nome!));
        if (params.tipoFolha) itens = itens.filter((r: any) => matchesFiltro(r.tipo_folha || "", params.tipoFolha!));

        if ((params.modo ?? "resumo") === "detalhe") {
          const limite = params.limite ?? 50;
          return toolResult({
            ano: params.ano,
            mes: params.mes,
            count: Math.min(itens.length, limite),
            total: itens.length,
            ...(itens.length > limite ? { aviso: `Exibindo ${limite} de ${itens.length} registros. Filtre por nome ou use modo=resumo.` } : {}),
            remuneracoes: itens.slice(0, limite).map(resumoRemuneracao),
          });
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
        return toolResult({ ano: params.ano, mes: params.mes, totalRegistros: itens.length, resumo });
      } catch (e) {
        return errorFrom(e, "Erro ao consultar remunerações");
      }
    },
  );

  // P3. senado_horas_extras
  server.tool(
    "senado_horas_extras",
    "Horas extras pagas a servidores do Senado num mês de referência, com valor e detalhamento.",
    {
      ano: z.number().int().min(2013).max(2100).describe("Ano de referência"),
      mes: z.number().int().min(1).max(12).describe("Mês de referência"),
      nome: z.string().optional().describe("Nome do servidor (busca parcial)"),
      limite: z.number().int().min(1).max(500).optional().default(100).describe("Máximo de resultados (padrão: 100)"),
    },
    async (params) => {
      try {
        const response = await cachedFetch(
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
        return toolResult({
          ano: params.ano,
          mes: params.mes,
          count: Math.min(itens.length, limite),
          total: itens.length,
          valorTotal,
          horasExtras: itens.slice(0, limite),
        });
      } catch (e) {
        return errorFrom(e, "Erro ao consultar horas extras");
      }
    },
  );

  // P4. senado_quantitativos_pessoal
  server.tool(
    "senado_quantitativos_pessoal",
    "Quantitativos de pessoal do Senado: força de trabalho por classe/escolaridade, cargos em comissão e funções de confiança, previsão de aposentadorias ou quantitativo de senadores.",
    {
      tabela: z.enum(["pessoal", "cargos-funcoes", "previsao-aposentadoria", "senadores"]).describe("Qual quantitativo consultar"),
      limite: z.number().int().min(1).max(2000).optional().default(200).describe("Máximo de linhas (padrão: 200)"),
    },
    async (params) => {
      try {
        const path = params.tabela === "senadores"
          ? "/senadores/quantitativos/senadores"
          : params.tabela === "previsao-aposentadoria"
            ? "/servidores/previsao-aposentadoria"
            : `/servidores/quantitativos/${params.tabela}`;
        const response = await cachedFetch(
          "senado_quantitativos_pessoal",
          { tabela: params.tabela },
          CACHE_STATIC,
          () => admFetch(path, {}, admBaseUrl),
        );
        const linhas = ensureArray(response);
        const limite = params.limite ?? 200;
        return toolResult({
          tabela: params.tabela,
          count: Math.min(linhas.length, limite),
          total: linhas.length,
          linhas: linhas.slice(0, limite),
        });
      } catch (e) {
        return errorFrom(e, "Erro ao consultar quantitativos de pessoal");
      }
    },
  );

  // P5. senado_pessoal_listas
  server.tool(
    "senado_pessoal_listas",
    "Listas de pessoal do Senado: estagiários ativos, pensionistas, lotações (setores) ou nomes de cargos.",
    {
      tipo: z.enum(["estagiarios", "pensionistas", "lotacoes", "cargos"]).describe("Qual lista consultar"),
      filtro: z.string().optional().describe("Filtro textual (nome, curso, setor...)"),
      limite: z.number().int().min(1).max(500).optional().default(50).describe("Máximo de resultados (padrão: 50)"),
    },
    async (params) => {
      try {
        const response = await cachedFetch(
          "senado_pessoal_listas",
          { tipo: params.tipo },
          CACHE_SEMI_STATIC,
          () => admFetch(`/servidores/${params.tipo}`, {}, admBaseUrl),
        );
        let lista = ensureArray(response);
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
        return errorFrom(e, "Erro ao consultar lista de pessoal");
      }
    },
  );
}
