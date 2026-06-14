/**
 * Group O — Senadores/Administrativo (4 tools)
 * senado_ceaps, senado_auxilio_moradia, senado_escritorios_apoio,
 * senado_senadores_aposentados
 *
 * Consumes the ADMINISTRATIVE open data API. The CEAPS dataset is ~10 MB per
 * year with no server-side filters, so the tool fetches once (cached by year)
 * and filters/aggregates in the Worker — never returning the raw dump.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { admFetch, admFetchLarge } from "../throttle/adm.js";
import { toolResult, errorFrom, ensureArray } from "../utils/validation.js";
import { CACHE_SEMI_STATIC, CACHE_STATIC } from "../types.js";

export interface CeapsFiltros {
  mes?: number;
  codSenador?: number;
  nomeSenador?: string;
  tipoDespesa?: string;
  fornecedor?: string;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Apply in-Worker filters to raw CEAPS items. */
export function filtrarCeaps(itens: any[], f: CeapsFiltros): any[] {
  return itens.filter((d: any) => {
    if (f.mes && d.mes !== f.mes) return false;
    if (f.codSenador && d.codSenador !== f.codSenador) return false;
    if (f.nomeSenador && !(typeof d.nomeSenador === "string" && norm(d.nomeSenador).includes(norm(f.nomeSenador)))) return false;
    if (f.tipoDespesa && !(typeof d.tipoDespesa === "string" && norm(d.tipoDespesa).includes(norm(f.tipoDespesa)))) return false;
    if (f.fornecedor && !(typeof d.fornecedor === "string" && norm(d.fornecedor).includes(norm(f.fornecedor)))) return false;
    return true;
  });
}

/** Aggregate CEAPS items by a key extractor. */
export function agregarCeaps(itens: any[], chave: (d: any) => string | number, extra?: (d: any) => Record<string, unknown>) {
  const grupos = new Map<string | number, { total: number; qtd: number; extra?: Record<string, unknown> }>();
  for (const d of itens) {
    const k = chave(d);
    const g = grupos.get(k) ?? { total: 0, qtd: 0, extra: extra ? extra(d) : undefined };
    g.total += typeof d.valorReembolsado === "number" ? d.valorReembolsado : 0;
    g.qtd += 1;
    grupos.set(k, g);
  }
  return Array.from(grupos.entries())
    .map(([k, g]) => ({ chave: k, ...(g.extra ?? {}), total: Math.round(g.total * 100) / 100, despesas: g.qtd }))
    .sort((a, b) => b.total - a.total);
}

/** Trim a raw CEAPS item for detail output. */
export function parseCeapsItem(d: any) {
  return {
    mes: d.mes ?? null,
    data: d.data || null,
    senador: d.nomeSenador || null,
    codSenador: d.codSenador ?? null,
    tipoDespesa: d.tipoDespesa || null,
    fornecedor: d.fornecedor || null,
    cnpjCpf: d.cpfCnpj || null,
    detalhamento: d.detalhamento || null,
    valor: d.valorReembolsado ?? null,
  };
}

export function registerSenadoresAdminTools(server: McpServer, admBaseUrl: string) {
  // O1. senado_ceaps
  server.tool(
    "senado_ceaps",
    "Despesas da Cota para Exercício da Atividade Parlamentar (CEAPS) dos senadores em um ano. Retorna `{ ano, modo, totalDespesas, valorTotal, ... }`: nos modos agregados (`por-senador`/`por-tipo`/`por-mes`/`por-fornecedor`, padrão `por-senador`) traz `agregado[]` ordenado por `total` desc com `chave`, `total` e `despesas` (contagem); em `modo='detalhe'` traz `despesas[]` (mês, data, senador, tipoDespesa, fornecedor, cnpjCpf, valor). Filtre por `mes`, `codSenador`, `nomeSenador`, `tipoDespesa` ou `fornecedor` (busca parcial); `limite` cap 100 com `aviso` ao truncar. Obtenha `codSenador` via `senado_listar_senadores`.",
    {
      ano: z.number().int().min(2008).max(2100).describe("Ano das despesas"),
      modo: z.enum(["por-senador", "por-tipo", "por-mes", "por-fornecedor", "detalhe"]).optional().default("por-senador").describe("Agregação ou detalhe (padrão: por-senador)"),
      mes: z.number().int().min(1).max(12).optional().describe("Filtrar por mês"),
      codSenador: z.number().int().optional().describe("Filtrar por código do senador"),
      nomeSenador: z.string().optional().describe("Filtrar por nome do senador (busca parcial)"),
      tipoDespesa: z.string().optional().describe("Filtrar por tipo de despesa (busca parcial)"),
      fornecedor: z.string().optional().describe("Filtrar por fornecedor (busca parcial)"),
      limite: z.number().int().min(1).max(1000).optional().default(100).describe("Máximo de linhas no resultado (padrão: 100)"),
    },
    async (params) => {
      try {
        // Cache the full year dataset once; filters/aggregation run per call.
        const bruto = await cachedFetch(
          "senado_ceaps",
          { ano: params.ano },
          CACHE_STATIC,
          () => admFetchLarge(`/senadores/despesas_ceaps/${params.ano}`, {}, admBaseUrl),
        );
        const filtrado = filtrarCeaps(ensureArray(bruto), {
          mes: params.mes,
          codSenador: params.codSenador,
          nomeSenador: params.nomeSenador,
          tipoDespesa: params.tipoDespesa,
          fornecedor: params.fornecedor,
        });
        const totalGeral = Math.round(filtrado.reduce((s, d) => s + (d.valorReembolsado || 0), 0) * 100) / 100;
        const limite = params.limite ?? 100;
        const modo = params.modo ?? "por-senador";

        let resultado: any;
        if (modo === "detalhe") {
          resultado = {
            despesas: filtrado.slice(0, limite).map(parseCeapsItem),
            ...(filtrado.length > limite ? { aviso: `Exibindo ${limite} de ${filtrado.length} despesas. Refine os filtros ou use um modo agregado.` } : {}),
          };
        } else if (modo === "por-tipo") {
          resultado = { agregado: agregarCeaps(filtrado, (d) => d.tipoDespesa || "(sem tipo)").slice(0, limite) };
        } else if (modo === "por-mes") {
          resultado = { agregado: agregarCeaps(filtrado, (d) => d.mes ?? 0).sort((a: any, b: any) => Number(a.chave) - Number(b.chave)) };
        } else if (modo === "por-fornecedor") {
          resultado = { agregado: agregarCeaps(filtrado, (d) => d.cpfCnpj || d.fornecedor || "(sem fornecedor)", (d) => ({ fornecedor: d.fornecedor || null })).slice(0, limite) };
        } else {
          resultado = { agregado: agregarCeaps(filtrado, (d) => d.codSenador ?? 0, (d) => ({ senador: d.nomeSenador || null })).slice(0, limite) };
        }

        return toolResult({
          ano: params.ano,
          modo,
          totalDespesas: filtrado.length,
          valorTotal: totalGeral,
          ...resultado,
        });
      } catch (e) {
        return errorFrom(e, "Erro ao consultar despesas CEAPS");
      }
    },
  );

  // O2. senado_auxilio_moradia
  server.tool(
    "senado_auxilio_moradia",
    "Lista senadores que recebem auxílio-moradia ou ocupam imóvel funcional em Brasília. Retorna `{ count, senadores }`, onde cada item traz `nome`, `uf`, `partido`, `auxilioMoradia` e `imovelFuncional`. Não requer parâmetros e cobre apenas a legislatura atual; para gastos com cota parlamentar use `senado_ceaps`.",
    {},
    async () => {
      try {
        const response = await cachedFetch("senado_auxilio_moradia", {}, CACHE_SEMI_STATIC, () =>
          admFetch("/senadores/auxilio-moradia", {}, admBaseUrl),
        );
        const senadores = ensureArray(response).map((s: any) => ({
          nome: s.nomeParlamentar || "",
          uf: s.estadoEleito || null,
          partido: s.partidoEleito || null,
          auxilioMoradia: s.auxilioMoradia || null,
          imovelFuncional: s.imovelFuncional || null,
        }));
        return toolResult({ count: senadores.length, senadores });
      } catch (e) {
        return errorFrom(e, "Erro ao consultar auxílio-moradia");
      }
    },
  );

  // O3. senado_escritorios_apoio
  server.tool(
    "senado_escritorios_apoio",
    "Lista escritórios de apoio dos senadores nos estados, com endereço e telefone. Retorna `{ count, escritorios }`, cada item com `senador`, `uf`, `partido`, `setor`, `endereco` e `telefone`. Filtre opcionalmente por `uf` (sigla, ex: SP) e/ou `nome` do senador (busca parcial); sem filtros lista todos. Para dados gerais do senador use `senado_listar_senadores`.",
    {
      uf: z.string().max(2).optional().describe("Filtrar por estado (ex: SP)"),
      nome: z.string().optional().describe("Filtrar por nome do senador (busca parcial)"),
    },
    async (params) => {
      try {
        const response = await cachedFetch("senado_escritorios_apoio", {}, CACHE_SEMI_STATIC, () =>
          admFetch("/senadores/escritorios", {}, admBaseUrl),
        );
        let escritorios = ensureArray(response).map((e: any) => ({
          senador: e.nome || "",
          uf: e.estado || null,
          partido: e.partido || null,
          setor: e.setor || null,
          endereco: e.endereco || null,
          telefone: e.telefone || null,
        }));
        if (params.uf) {
          const uf = params.uf.toUpperCase();
          escritorios = escritorios.filter((e) => e.uf?.toUpperCase() === uf);
        }
        if (params.nome) {
          escritorios = escritorios.filter((e) => norm(e.senador).includes(norm(params.nome!)));
        }
        return toolResult({ count: escritorios.length, escritorios });
      } catch (e) {
        return errorFrom(e, "Erro ao consultar escritórios de apoio");
      }
    },
  );

  // O4. senado_senadores_aposentados
  server.tool(
    "senado_senadores_aposentados",
    "Lista ex-senadores aposentados pelos planos de previdência do Congresso (IPC/PSSC), com remuneração. Retorna `{ count, aposentados }`, cada item com `nome`, `tipo` (plano), `dataInicial` da aposentadoria e `remuneracao`. Não requer parâmetros; cobre apenas ex-parlamentares aposentados. Para remuneração de servidores ativos use `senado_remuneracoes_servidores`.",
    {},
    async () => {
      try {
        const response = await cachedFetch("senado_senadores_aposentados", {}, CACHE_SEMI_STATIC, () =>
          admFetch("/senadores/aposentados", {}, admBaseUrl),
        );
        const aposentados = ensureArray(response).map((a: any) => ({
          nome: a.nome || "",
          tipo: a.tipo || null,
          dataInicial: a.dataInicial || null,
          remuneracao: a.remuneracao ?? null,
        }));
        return toolResult({ count: aposentados.length, aposentados });
      } catch (e) {
        return errorFrom(e, "Erro ao consultar ex-senadores aposentados");
      }
    },
  );
}
