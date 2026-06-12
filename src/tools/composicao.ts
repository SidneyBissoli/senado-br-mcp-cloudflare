/**
 * Group J — Composição / Blocs & Leadership (5 tools)
 * senado_listar_blocos, senado_obter_bloco, senado_liderancas,
 * senado_mesa_senado, senado_mesa_congresso
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, errorFrom, buildParams, ensureArray } from "../utils/validation.js";
import { CACHE_SEMI_STATIC, CACHE_ON_DEMAND } from "../types.js";

/** Parse a parliamentary bloc summary. */
export function parseBlocoResumo(b: any) {
  const bloco = b.Bloco || b;
  return {
    codigo: bloco.CodigoBloco || bloco.codigoBloco || null,
    nome: bloco.NomeBloco || bloco.nomeBloco || null,
    nomeApelido: bloco.NomeApelido || bloco.nomeApelido || null,
    dataCriacao: bloco.DataCriacao || bloco.dataCriacao || null,
    dataExtincao: bloco.DataExtincao || bloco.dataExtincao || null,
    partidos: ensureArray(bloco.Membros?.Membro ?? bloco.membros).map((m: any) => ({
      sigla: m.SiglaPartido || m.siglaPartido || m.Sigla || null,
      nome: m.NomePartido || m.nomePartido || m.Nome || null,
      dataAdesao: m.DataAdesao || m.dataAdesao || null,
    })),
  };
}

/** Parse a leadership entry. */
export function parseLideranca(l: any) {
  return {
    tipo: l.SiglaTipoLideranca || l.TipoLideranca || l.tipo || null,
    descricao: l.DescricaoTipoLideranca || l.descricao || null,
    unidadeLideranca: l.UnidadeLideranca?.NomeUnidadeLideranca ||
      l.nomeUnidadeLideranca || null,
    parlamentar: l.Lider ? {
      codigo: l.Lider.CodigoParlamentar || null,
      nome: l.Lider.NomeParlamentar || null,
      partido: l.Lider.SiglaPartido || null,
      uf: l.Lider.SiglaUf || null,
    } : null,
  };
}

/** Parse a Mesa Diretora member. */
export function parseMembroMesa(m: any) {
  return {
    cargo: m.DescricaoCargo || m.Cargo || null,
    codigo: m.CodigoParlamentar || null,
    nome: m.NomeParlamentar || null,
    partido: m.SiglaPartido || null,
    uf: m.SiglaUf || null,
  };
}

export function registerComposicaoTools(server: McpServer, baseUrl: string) {
  // J1. senado_listar_blocos
  server.tool(
    "senado_listar_blocos",
    "Lista os blocos parlamentares do Senado e seus partidos membros.",
    {},
    async () => {
      try {
        const response = await cachedFetch(
          "senado_listar_blocos",
          {},
          CACHE_SEMI_STATIC,
          () => upstreamFetch("/composicao/lista/blocos", {}, baseUrl),
        );
        const r = response as any;
        const blocos = ensureArray(
          r?.ListaBlocoParlamentar?.BlocosParlamentares?.BlocoParlamentar ??
          r?.BlocosParlamentares?.BlocoParlamentar,
        ).map(parseBlocoResumo);
        return toolResult({ count: blocos.length, blocos });
      } catch (e) {
        return errorFrom(e, "Erro ao listar blocos parlamentares");
      }
    },
  );

  // J2. senado_obter_bloco
  server.tool(
    "senado_obter_bloco",
    "Obtém detalhes de um bloco parlamentar específico, incluindo partidos membros.",
    {
      codigo: z.number().int().positive().describe("Código do bloco parlamentar"),
    },
    async (params) => {
      try {
        const response = await cachedFetch(
          "senado_obter_bloco",
          { codigo: params.codigo },
          CACHE_ON_DEMAND,
          () => upstreamFetch(`/composicao/bloco/${params.codigo}`, {}, baseUrl),
        );
        const r = response as any;
        const bloco = r?.BlocoParlamentar?.Bloco || r?.Bloco || r;
        return toolResult(parseBlocoResumo(bloco));
      } catch (e) {
        return errorFrom(e, "Bloco parlamentar não encontrado");
      }
    },
  );

  // J3. senado_liderancas
  server.tool(
    "senado_liderancas",
    "Lista as lideranças do Senado e do Congresso Nacional (líderes, vice-líderes, etc.).",
    {
      casa: z.string().optional().describe("Casa legislativa (SF=Senado, CN=Congresso)"),
      codigoParlamentar: z.number().int().optional().describe("Código do parlamentar"),
      vigente: z.string().optional().describe("Apenas vigentes (S/N)"),
      siglaTipoLideranca: z.string().optional().describe("Tipo de liderança (ex: LIDER, VICE-LIDER)"),
    },
    async (params) => {
      try {
        const qp = buildParams({
          casa: params.casa,
          codigoParlamentar: params.codigoParlamentar,
          vigente: params.vigente,
          siglaTipoLideranca: params.siglaTipoLideranca,
        });
        const response = await cachedFetch(
          "senado_liderancas",
          qp,
          CACHE_SEMI_STATIC,
          () => upstreamFetch("/composicao/lideranca", qp, baseUrl),
        );
        const r = response as any;
        const liderancas = ensureArray(
          r?.LiderancaList?.Liderancas?.Lideranca ??
          r?.Liderancas?.Lideranca,
        ).map(parseLideranca);
        return toolResult({ count: liderancas.length, liderancas });
      } catch (e) {
        return errorFrom(e, "Erro ao obter lideranças");
      }
    },
  );

  // J4. senado_mesa_senado
  server.tool(
    "senado_mesa_senado",
    "Lista os membros da Mesa Diretora do Senado Federal (presidente, vice-presidentes, secretários).",
    {},
    async () => {
      try {
        const response = await cachedFetch(
          "senado_mesa_senado",
          {},
          CACHE_SEMI_STATIC,
          () => upstreamFetch("/composicao/mesaSF", {}, baseUrl),
        );
        const r = response as any;
        const membros = ensureArray(
          r?.MesaSF?.Cargos?.Cargo ??
          r?.Cargos?.Cargo,
        ).map(parseMembroMesa);
        return toolResult({ mesa: "Senado Federal", count: membros.length, membros });
      } catch (e) {
        return errorFrom(e, "Erro ao obter Mesa do Senado");
      }
    },
  );

  // J5. senado_mesa_congresso
  server.tool(
    "senado_mesa_congresso",
    "Lista os membros da Mesa Diretora do Congresso Nacional.",
    {},
    async () => {
      try {
        const response = await cachedFetch(
          "senado_mesa_congresso",
          {},
          CACHE_SEMI_STATIC,
          () => upstreamFetch("/composicao/mesaCN", {}, baseUrl),
        );
        const r = response as any;
        const membros = ensureArray(
          r?.MesaCN?.Cargos?.Cargo ??
          r?.Cargos?.Cargo,
        ).map(parseMembroMesa);
        return toolResult({ mesa: "Congresso Nacional", count: membros.length, membros });
      } catch (e) {
        return errorFrom(e, "Erro ao obter Mesa do Congresso");
      }
    },
  );
}
