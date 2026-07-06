/**
 * Group J — Composição / Blocs & Leadership (4 tools)
 * senado_listar_blocos, senado_obter_bloco, senado_liderancas,
 * senado_mesa (enum `casa`: senado | congresso)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { errorFrom, buildParams, ensureArray } from "../utils/validation.js";
import { digArrayRoot, digObjectRoot } from "../utils/upstream-parse.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
import { CACHE_SEMI_STATIC, CACHE_ON_DEMAND } from "../types.js";

/** Convert a "DD/MM/AAAA" date to ISO "AAAA-MM-DD"; passes through other strings. */
function brDateToISO(v: any): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}

/**
 * Parse a parliamentary bloc from the LIST dump (ListaBlocoParlamentar.Blocos.Bloco[]):
 * PascalCase, DataCriacao already ISO, members under Membros.Membro[].Partido.
 */
export function parseBlocoResumo(b: any) {
  const bloco = b.Bloco || b;
  return {
    codigo: bloco.CodigoBloco || bloco.codigoBloco || null,
    nome: bloco.NomeBloco || bloco.nomeBloco || null,
    nomeApelido: bloco.NomeApelido || bloco.nomeApelido || null,
    dataCriacao: bloco.DataCriacao || bloco.dataCriacao || null,
    dataExtincao: bloco.DataExtincao || bloco.dataExtincao || null,
    partidos: ensureArray(bloco.Membros?.Membro ?? bloco.membros).map((m: any) => ({
      sigla: m.Partido?.SiglaPartido || m.SiglaPartido || m.siglaPartido || null,
      nome: m.Partido?.NomePartido || m.NomePartido || m.nomePartido || null,
      dataAdesao: m.DataAdesao || m.dataAdesao || null,
    })),
  };
}

/**
 * Parse a parliamentary bloc from the DETAIL endpoint (blocos.bloco): lowercase keys,
 * dataCriacao as "DD/MM/AAAA", members under composicaoBloco.composicao_bloco[].partido.
 */
export function parseBlocoDetalhe(bloco: any) {
  return {
    codigo: bloco.id || bloco.idBloco || null,
    nome: bloco.nomeBloco || null,
    nomeApelido: bloco.nomeApelidoBloco || null,
    dataCriacao: brDateToISO(bloco.dataCriacao),
    dataExtincao: brDateToISO(bloco.dataExtincao),
    partidos: ensureArray(bloco.composicaoBloco?.composicao_bloco).map((c: any) => ({
      sigla: c.partido?.siglaPartido || null,
      nome: c.partido?.nomePartido || null,
      dataAdesao: brDateToISO(c.dataAdesao),
    })),
  };
}

/**
 * Parse a leadership entry from /composicao/lideranca (flat camelCase array).
 * The payload carries the parliamentarian fields flat on the item (no nested Lider,
 * no UF). Legacy PascalCase fallbacks are kept defensively.
 */
export function parseLideranca(l: any) {
  const hasParlamentar = l.codigoParlamentar != null || l.Lider != null;
  return {
    tipo: l.siglaTipoLideranca || l.SiglaTipoLideranca || l.TipoLideranca || null,
    descricao: l.descricaoTipoLideranca || l.DescricaoTipoLideranca || null,
    unidadeLideranca:
      l.descricaoTipoUnidadeLideranca ||
      l.UnidadeLideranca?.NomeUnidadeLideranca ||
      l.nomeUnidadeLideranca ||
      null,
    parlamentar: hasParlamentar
      ? {
          codigo: l.codigoParlamentar ?? l.Lider?.CodigoParlamentar ?? null,
          nome: l.nomeParlamentar || l.Lider?.NomeParlamentar || null,
          partido: l.siglaPartidoFiliacao || l.Lider?.SiglaPartido || null,
          uf: l.UfParlamentar || l.Lider?.SiglaUf || null,
        }
      : null,
  };
}

/**
 * Parse a Mesa Diretora member from the current dump
 * (MesaSenado/MesaCongresso.Colegiados.Colegiado[].Cargos.Cargo[]).
 * `Cargo` is a string array, `Http` is the parliamentarian code, and `Bancada`
 * embeds party/UF as "(UNIAO-AP)". Legacy flat fields are kept as fallbacks.
 */
export function parseMembroMesa(m: any) {
  const bancada = typeof m.Bancada === "string" ? m.Bancada : "";
  const match = bancada.match(/\(([^)]+)-([A-Za-z]{2})\)/);
  return {
    cargo: ensureArray(m.Cargo)[0] ?? m.DescricaoCargo ?? null,
    codigo: m.Http ?? m.CodigoParlamentar ?? null,
    nome: (m.NomeParlamentar || "").trim() || null,
    partido: match ? match[1].trim() : m.SiglaPartido ?? null,
    uf: match ? match[2].trim() : m.SiglaUf ?? null,
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
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_listar_blocos",
          {},
          CACHE_SEMI_STATIC,
          () => upstreamFetch("/composicao/lista/blocos", {}, baseUrl),
        );
        const blocos = digArrayRoot(
          response,
          [["ListaBlocoParlamentar", "Blocos", "Bloco"]],
          "senado_listar_blocos",
        ).map(parseBlocoResumo);
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/composicao/lista/blocos", {
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({ count: blocos.length, blocos }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao listar blocos parlamentares");
      }
    },
  );

  // J2. senado_obter_bloco
  server.tool(
    "senado_obter_bloco",
    "Obtém detalhes de um bloco parlamentar específico pelo seu código. Retorna um objeto com `codigo`, `nome`, `nomeApelido`, `dataCriacao`, `dataExtincao` e `partidos` (array com `sigla`, `nome`, `dataAdesao`); `dataExtincao` é `null` para blocos vigentes. Obtenha o parâmetro `codigo` primeiro via `senado_listar_blocos`; código inexistente retorna erro (\"Bloco parlamentar não encontrado\").",
    {
      codigo: z.number().int().positive().describe("Código do bloco parlamentar"),
    },
    async (params) => {
      try {
        const path = `/composicao/bloco/${params.codigo}`;
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_obter_bloco",
          { codigo: params.codigo },
          CACHE_ON_DEMAND,
          () => upstreamFetch(path, {}, baseUrl),
        );
        const bloco = digObjectRoot(
          response,
          [["blocos", "bloco"], ["BlocoParlamentar", "Bloco"]],
          "senado_obter_bloco",
          { notFoundMessage: "Bloco parlamentar nao encontrado" },
        );
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          dataset_id: `bloco=${params.codigo}`, retrieved_at: fetchedAt,
        });
        return resultWithProvenance(parseBlocoDetalhe(bloco), prov);
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
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_liderancas",
          qp,
          CACHE_SEMI_STATIC,
          () => upstreamFetch("/composicao/lideranca", qp, baseUrl),
        );
        // Upstream serves a flat JSON array at the root and honors the query params
        // server-side (casa, codigoParlamentar, siglaTipoLideranca, vigente).
        const liderancas = digArrayRoot(response, [[]], "senado_liderancas").map(parseLideranca);
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/composicao/lideranca", {
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({ count: liderancas.length, liderancas }, prov);
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
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_mesa",
          { casa },
          CACHE_SEMI_STATIC,
          () => upstreamFetch(path, {}, baseUrl),
        );
        const colegiados = digArrayRoot(
          response,
          [
            ["MesaSenado", "Colegiados", "Colegiado"],
            ["MesaCongresso", "Colegiados", "Colegiado"],
          ],
          "senado_mesa",
        );
        const membros = colegiados.flatMap((col: any) =>
          ensureArray(col?.Cargos?.Cargo).map(parseMembroMesa),
        );
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          dataset_id: `mesa=${casa}`, retrieved_at: fetchedAt,
        });
        return resultWithProvenance({ casa, mesa: rotulo, count: membros.length, membros }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao obter Mesa Diretora");
      }
    },
  );
}
