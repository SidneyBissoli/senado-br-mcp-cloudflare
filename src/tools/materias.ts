/**
 * Group B — Bills / Matérias Legislativas (4 tools)
 * senado_buscar_materias, senado_obter_materia, senado_tramitacao_materia,
 * senado_textos_materia
 * Note: senado_votos_materia is registered in votacoes.ts (Group D) as D4.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, toolError, buildParams, ensureArray } from "../utils/validation.js";
import { CACHE_ON_DEMAND, CACHE_DYNAMIC } from "../types.js";

function parseMateriaResumo(materia: any) {
  const id = materia.IdentificacaoMateria || materia;
  return {
    codigo: parseInt(id.CodigoMateria || materia.CodigoMateria || "0"),
    sigla: id.SiglaSubtipoMateria || materia.SiglaMateria || "",
    numero: parseInt(id.NumeroMateria || materia.NumeroMateria || "0"),
    ano: parseInt(id.AnoMateria || materia.AnoMateria || "0"),
    ementa: materia.EmentaMateria || materia.Ementa || null,
    autor: materia.AutorPrincipal?.NomeAutor || materia.Autor || null,
    situacao: materia.SituacaoAtual?.DescricaoSituacao || materia.Situacao || null,
    dataApresentacao: materia.DataApresentacao || null,
    url: materia.UrlDetalheMateria || null,
  };
}

function parseMateriaDetalhe(dados: any) {
  const mat = dados.Materia || dados;
  const id = mat.IdentificacaoMateria || {};
  const db = mat.DadosBasicosMateria || {};
  const sit = mat.SituacaoAtual || {};
  const aut = mat.Autoria || {};
  let relator = null;
  const rel = mat.Relator || sit.Relator;
  if (rel) {
    relator = { nome: rel.NomeRelator || rel.NomeParlamentar || "", partido: rel.SiglaPartido || null, uf: rel.UfRelator || null };
  }
  return {
    codigo: parseInt(id.CodigoMateria || "0"),
    sigla: id.SiglaSubtipoMateria || "",
    numero: parseInt(id.NumeroMateria || "0"),
    ano: parseInt(id.AnoMateria || "0"),
    ementa: db.EmentaMateria || null,
    ementaDetalhada: db.ExplicacaoEmentaMateria || null,
    autor: aut.Autor?.[0]?.NomeAutor || aut.AutorPrincipal?.NomeAutor || null,
    tipoAutor: aut.Autor?.[0]?.TipoAutor || null,
    situacao: sit.DescricaoSituacao || null,
    localAtual: sit.Local?.NomeLocal || sit.NomeLocal || null,
    dataApresentacao: db.DataApresentacao || null,
    dataUltimaAtualizacao: mat.DataUltimaAtualizacao || null,
    indexacao: db.IndexacaoMateria || null,
    url: id.UrlDetalheMateria || null,
    relator,
  };
}

export function registerMateriasTools(server: McpServer, baseUrl: string) {
  // B1. senado_buscar_materias
  server.tool(
    "senado_buscar_materias",
    "Busca matérias legislativas por diversos critérios: tipo (PEC, PL, PLP, MPV), número, ano, palavras-chave, autor ou relator.",
    {
      sigla: z.string().optional().describe("Tipo: PEC, PL, PLP, MPV, PDL, PRS, etc."),
      numero: z.number().int().positive().optional().describe("Número da matéria"),
      ano: z.number().int().min(1900).max(2100).optional().describe("Ano da matéria"),
      palavraChave: z.string().optional().describe("Busca na ementa"),
      autorNome: z.string().optional().describe("Nome do autor"),
      relatorNome: z.string().optional().describe("Nome do relator"),
      tramitando: z.boolean().optional().describe("Apenas em tramitação"),
    },
    async (params) => {
      try {
        const qp = buildParams({
          sigla: params.sigla?.toUpperCase(),
          numero: params.numero,
          ano: params.ano,
          palavraChave: params.palavraChave,
          nomeAutor: params.autorNome,
          nomeRelator: params.relatorNome,
          tramitando: params.tramitando !== undefined ? (params.tramitando ? "S" : "N") : undefined,
        });
        const response = await cachedFetch("senado_buscar_materias", qp, CACHE_ON_DEMAND, () =>
          upstreamFetch("/materia/pesquisa/lista", qp, baseUrl),
        );
        const r = response as any;
        const materias = ensureArray(
          r?.PesquisaBasicaMateria?.Materias?.Materia ?? r?.ListaMaterias?.Materias?.Materia,
        ).map(parseMateriaResumo);
        return toolResult({ count: materias.length, materias });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Erro na busca de matérias");
      }
    },
  );

  // B2. senado_obter_materia
  server.tool(
    "senado_obter_materia",
    "Obtém detalhes completos de uma matéria legislativa, incluindo ementa, autoria, situação atual e relator.",
    {
      codigoMateria: z.number().int().positive().describe("Código único da matéria"),
    },
    async (params) => {
      try {
        const response = await cachedFetch(
          "senado_obter_materia",
          { codigo: params.codigoMateria },
          CACHE_ON_DEMAND,
          () => upstreamFetch(`/materia/${params.codigoMateria}`, {}, baseUrl),
        );
        const dados = (response as any).DetalheMateria || response;
        return toolResult(parseMateriaDetalhe(dados));
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Matéria não encontrada");
      }
    },
  );

  // B3. senado_tramitacao_materia
  server.tool(
    "senado_tramitacao_materia",
    "Obtém histórico de tramitação de uma matéria, mostrando todas as movimentações em ordem cronológica.",
    {
      codigoMateria: z.number().int().positive().describe("Código único da matéria"),
    },
    async (params) => {
      try {
        const response = await cachedFetch(
          "senado_tramitacao_materia",
          { codigo: params.codigoMateria },
          CACHE_DYNAMIC,
          () => upstreamFetch(`/materia/${params.codigoMateria}`, {}, baseUrl),
        );
        const dados =
          (response as any).DetalheMateria?.Materia ||
          (response as any).Materia ||
          response;
        const tramitacoes = ensureArray(
          dados?.Tramitacoes?.Tramitacao ?? dados?.HistoricoTramitacao?.Tramitacao,
        ).map((t: any) => ({
          data: t.DataTramitacao || t.Data || "",
          local: t.Local?.NomeLocal || t.DescricaoLocal || null,
          situacao: t.Situacao?.DescricaoSituacao || t.DescricaoSituacao || null,
          descricao: t.TextoTramitacao || t.Descricao || null,
        }));
        return toolResult({ codigoMateria: params.codigoMateria, count: tramitacoes.length, tramitacoes });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Erro ao obter tramitação");
      }
    },
  );

  // B4. senado_textos_materia
  server.tool(
    "senado_textos_materia",
    "Obtém textos disponíveis de uma matéria (inicial, substitutivo, final) com URLs para download.",
    {
      codigoMateria: z.number().int().positive().describe("Código único da matéria"),
    },
    async (params) => {
      try {
        const response = await cachedFetch(
          "senado_textos_materia",
          { codigo: params.codigoMateria },
          CACHE_ON_DEMAND,
          () => upstreamFetch(`/materia/textos/${params.codigoMateria}`, {}, baseUrl),
        );
        const r = response as any;
        const textos = ensureArray(
          r?.TextoMateria?.Materia?.Textos?.Texto ?? r?.Textos?.Texto,
        ).map((t: any) => ({
          tipo: t.TipoTexto?.DescricaoTipoTexto || t.DescricaoTipoTexto || "Texto",
          data: t.DataTexto || null,
          url: t.UrlTexto || "",
          formato: t.FormatoTexto || t.TipoDocumento || null,
        }));
        return toolResult({ codigoMateria: params.codigoMateria, count: textos.length, textos });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Erro ao obter textos");
      }
    },
  );

  // senado_votos_materia is in votacoes.ts (Group D) as D4
}
