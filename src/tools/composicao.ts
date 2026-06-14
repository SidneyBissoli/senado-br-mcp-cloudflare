/**
 * Group J — Composição / Blocs & Leadership (4 tools)
 * senado_listar_blocos, senado_obter_bloco, senado_liderancas,
 * senado_mesa (enum `casa`: senado | congresso)
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
    "Lista todos os blocos parlamentares do Senado e seus partidos membros. Retorna `{ count, blocos }`, onde cada bloco traz `codigo`, `nome`, `nomeApelido`, `dataCriacao`, `dataExtincao` e a lista `partidos` (cada um com `sigla`, `nome`, `dataAdesao`). Use para descobrir o `codigo` de um bloco e depois detalhá-lo via `senado_obter_bloco`; para lideranças use `senado_liderancas`.",
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
    "Obtém detalhes de um bloco parlamentar específico pelo seu código. Retorna um objeto com `codigo`, `nome`, `nomeApelido`, `dataCriacao`, `dataExtincao` e `partidos` (array com `sigla`, `nome`, `dataAdesao`). Obtenha o parâmetro `codigo` primeiro via `senado_listar_blocos`.",
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
    "Lista as lideranças do Senado e do Congresso Nacional (líderes, vice-líderes etc.). Retorna `{ count, liderancas }`, cada item com `tipo`, `descricao`, `unidadeLideranca` e `parlamentar` (`codigo`, `nome`, `partido`, `uf`). Filtre por `casa` (SF/CN), `codigoParlamentar`, `vigente` (S/N) ou `siglaTipoLideranca`; sem filtros retorna todas. Para a composição de blocos use `senado_listar_blocos`.",
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

  // J4. senado_mesa (casa: senado | congresso)
  server.tool(
    "senado_mesa",
    "Lista os membros da Mesa Diretora (presidente, vice-presidentes, secretários). O parâmetro `casa` (padrão `senado`) escolhe entre `senado` (Mesa do Senado Federal) e `congresso` (Mesa do Congresso Nacional). Retorna `{ casa, mesa, count, membros }`, cada membro com `cargo`, `codigo`, `nome`, `partido` e `uf`. Para lideranças partidárias use `senado_liderancas`.",
    {
      casa: z.enum(["senado", "congresso"]).optional().default("senado").describe("senado (Mesa do SF) ou congresso (Mesa do CN)"),
    },
    async (params) => {
      try {
        const casa = params.casa ?? "senado";
        const path = casa === "congresso" ? "/composicao/mesaCN" : "/composicao/mesaSF";
        const rotulo = casa === "congresso" ? "Congresso Nacional" : "Senado Federal";
        const response = await cachedFetch(
          "senado_mesa",
          { casa },
          CACHE_SEMI_STATIC,
          () => upstreamFetch(path, {}, baseUrl),
        );
        const r = response as any;
        const membros = ensureArray(
          r?.MesaSF?.Cargos?.Cargo ??
          r?.MesaCN?.Cargos?.Cargo ??
          r?.Cargos?.Cargo,
        ).map(parseMembroMesa);
        return toolResult({ casa, mesa: rotulo, count: membros.length, membros });
      } catch (e) {
        return errorFrom(e, "Erro ao obter Mesa Diretora");
      }
    },
  );
}
