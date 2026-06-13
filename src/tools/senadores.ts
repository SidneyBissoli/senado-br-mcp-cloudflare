/**
 * Group A — Senators (5 tools)
 * senado_listar_senadores, senado_buscar_senador_por_nome, senado_obter_senador,
 * senado_votacoes_senador, senado_senador_detail
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, toolError, errorFrom, buildParams, ensureArray } from "../utils/validation.js";
import { CACHE_SEMI_STATIC, CACHE_DYNAMIC, CACHE_ON_DEMAND } from "../types.js";

export function parseSenadorResumo(parlamentar: any) {
  const id = parlamentar.IdentificacaoParlamentar || parlamentar;
  const m = parlamentar.Mandato || {};
  return {
    codigo: parseInt(id.CodigoParlamentar || "0"),
    nome: id.NomeParlamentar || "",
    nomeCompleto: id.NomeCompletoParlamentar || id.NomeParlamentar || "",
    partido: m.Partido?.SiglaPartido || id.SiglaPartidoParlamentar || null,
    uf: m.UfParlamentar || id.UfParlamentar || "",
    foto: id.UrlFotoParlamentar || null,
    emExercicio: parlamentar.DescricaoParticipacao !== "Suplente" && !parlamentar.DataFim,
  };
}

export function parseSenadorDetalhe(dados: any) {
  const p = dados.Parlamentar || dados;
  const id = p.IdentificacaoParlamentar || {};
  const db = p.DadosBasicosParlamentar || {};
  return {
    codigo: parseInt(id.CodigoParlamentar || "0"),
    nome: id.NomeParlamentar || "",
    nomeCompleto: id.NomeCompletoParlamentar || "",
    nomeCivil: db.NomeCivilParlamentar || null,
    sexo: id.SexoParlamentar || null,
    dataNascimento: db.DataNascimento || null,
    naturalidade: db.Naturalidade || null,
    ufNaturalidade: db.UfNaturalidade || null,
    partido: id.SiglaPartidoParlamentar || null,
    uf: id.UfParlamentar || "",
    foto: id.UrlFotoParlamentar || null,
    email: id.EmailParlamentar || null,
    emExercicio: true,
    mandatos: ensureArray(p.Mandatos?.Mandato).map((m: any) => ({
      legislatura: parseInt(m.PrimeiraLegislaturaDoMandato?.NumeroLegislatura || "0"),
      uf: m.UfParlamentar || "",
      participacao: m.DescricaoParticipacao || "",
      dataInicio: m.DataInicio || null,
      dataFim: m.DataFim || null,
    })),
  };
}

/**
 * Extract a senator's own vote from a v3 /votacao item.
 * Returns the legacy senado_votacoes_senador output shape.
 */
export function parseVotoSenador(v: any, codigoSenador: number) {
  const voto = ensureArray(v.votos).find(
    (vt: any) => vt.codigoParlamentar === codigoSenador,
  ) as any;
  return {
    codigoVotacao: v.codigoSessaoVotacao || v.codigoSessao || 0,
    data: v.dataSessao ? String(v.dataSessao).split("T")[0] : "",
    materia: v.identificacao || (v.sigla ? `${v.sigla} ${v.numero}/${v.ano}` : ""),
    descricao: v.descricaoVotacao || null,
    voto: voto?.descricaoVotoParlamentar || voto?.siglaVotoParlamentar || "",
    resultado: v.resultadoVotacao || null,
  };
}

export function extractParlamentares(response: any): any[] {
  const list =
    response?.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar ??
    response?.ListaParlamentarLegislatura?.Parlamentares?.Parlamentar;
  return ensureArray(list);
}

export function registerSenadoresTools(server: McpServer, baseUrl: string) {
  // A1. senado_listar_senadores
  server.tool(
    "senado_listar_senadores",
    "Lista senadores em exercício ou de uma legislatura específica. Pode filtrar por UF e partido.",
    {
      emExercicio: z.boolean().optional().default(true).describe("Filtrar apenas senadores em exercício"),
      legislatura: z.number().int().min(1).optional().describe("Número da legislatura (ex: 57 para 2023-2027)"),
      uf: z.string().max(2).optional().describe("Sigla do estado (ex: SP, RJ, MG)"),
      partido: z.string().optional().describe("Sigla do partido (ex: PT, PL, MDB)"),
    },
    async (params) => {
      try {
        const path = params.legislatura
          ? `/senador/lista/legislatura/${params.legislatura}`
          : "/senador/lista/atual";
        const response = await cachedFetch("senado_listar_senadores", { path }, CACHE_SEMI_STATIC, () =>
          upstreamFetch(path, {}, baseUrl),
        );
        let senadores = extractParlamentares(response).map(parseSenadorResumo);
        if (params.uf) {
          const uf = params.uf.toUpperCase();
          senadores = senadores.filter((s) => s.uf.toUpperCase() === uf);
        }
        if (params.partido) {
          const p = params.partido.toUpperCase();
          senadores = senadores.filter((s) => s.partido?.toUpperCase() === p);
        }
        return toolResult({ count: senadores.length, senadores });
      } catch (e) {
        return errorFrom(e, "Erro ao listar senadores");
      }
    },
  );

  // A2. senado_buscar_senador_por_nome
  server.tool(
    "senado_buscar_senador_por_nome",
    "Busca senadores por nome (útil quando não se tem o código). Retorna lista de senadores correspondentes.",
    {
      nome: z.string().min(2).describe("Nome ou parte do nome do senador"),
    },
    async (params) => {
      try {
        const response = await cachedFetch("_senadores_atuais_busca", {}, CACHE_SEMI_STATIC, () =>
          upstreamFetch("/senador/lista/atual", {}, baseUrl),
        );
        const norm = params.nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const senadores = extractParlamentares(response)
          .map(parseSenadorResumo)
          .filter((s) => {
            const full = s.nomeCompleto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const short = s.nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return full.includes(norm) || short.includes(norm);
          });
        return toolResult({ count: senadores.length, senadores });
      } catch (e) {
        return errorFrom(e, "Erro na busca por nome");
      }
    },
  );

  // A3. senado_obter_senador
  server.tool(
    "senado_obter_senador",
    "Obtém informações detalhadas de um senador específico, incluindo dados biográficos, mandatos e comissões.",
    {
      codigoSenador: z.number().int().positive().describe("Código único do senador no sistema do Senado"),
    },
    async (params) => {
      try {
        const response = await cachedFetch(
          "senado_obter_senador",
          { codigo: params.codigoSenador },
          CACHE_ON_DEMAND,
          () => upstreamFetch(`/senador/${params.codigoSenador}`, {}, baseUrl),
        );
        const dados = (response as any).DetalheParlamentar || response;
        return toolResult(parseSenadorDetalhe(dados));
      } catch (e) {
        return errorFrom(e, "Senador não encontrado");
      }
    },
  );

  // A4. senado_votacoes_senador (migrated to v3 /votacao?codigoParlamentar — legacy endpoint deprecated)
  server.tool(
    "senado_votacoes_senador",
    "Lista votações nominais de um senador, mostrando como votou em cada matéria. Sem período informado, usa o ano corrente.",
    {
      codigoSenador: z.number().int().positive().describe("Código único do senador"),
      ano: z.number().int().min(1900).max(2100).optional().describe("Ano das votações"),
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim (YYYYMMDD)"),
    },
    async (params) => {
      try {
        let di: string;
        let df: string;
        if (params.dataInicio && params.dataFim) {
          di = `${params.dataInicio.slice(0, 4)}-${params.dataInicio.slice(4, 6)}-${params.dataInicio.slice(6, 8)}`;
          df = `${params.dataFim.slice(0, 4)}-${params.dataFim.slice(4, 6)}-${params.dataFim.slice(6, 8)}`;
        } else {
          const ano = params.ano ?? new Date().getFullYear();
          di = `${ano}-01-01`;
          df = `${ano}-12-31`;
        }
        const qp = {
          codigoParlamentar: String(params.codigoSenador),
          dataInicio: di,
          dataFim: df,
        };
        const response = await cachedFetch(
          "senado_votacoes_senador",
          qp,
          CACHE_DYNAMIC,
          () => upstreamFetch("/votacao", qp, baseUrl),
        );
        const votos = ensureArray(response)
          .map((v: any) => parseVotoSenador(v, params.codigoSenador))
          .sort((a, b) => b.data.localeCompare(a.data));
        return toolResult({ periodo: { dataInicio: di, dataFim: df }, count: votos.length, votos });
      } catch (e) {
        return errorFrom(e, "Erro ao obter votações do senador");
      }
    },
  );

  // A5. senado_senador_detail (NEW — aggregated view)
  server.tool(
    "senado_senador_detail",
    "Visão agregada e enriquecida de um senador, combinando mandatos, filiações e profissão numa única chamada.",
    {
      codigoSenador: z.number().int().positive().describe("Código único do senador"),
    },
    async (params) => {
      try {
        const code = params.codigoSenador;
        const [mandatosRes, filiacoesRes, profissaoRes] = await Promise.all([
          cachedFetch("senador_mandatos", { code }, CACHE_ON_DEMAND, () =>
            upstreamFetch(`/senador/${code}/mandatos`, {}, baseUrl),
          ).catch(() => null),
          cachedFetch("senador_filiacoes", { code }, CACHE_ON_DEMAND, () =>
            upstreamFetch(`/senador/${code}/filiacoes`, {}, baseUrl),
          ).catch(() => null),
          cachedFetch("senador_profissao", { code }, CACHE_ON_DEMAND, () =>
            upstreamFetch(`/senador/${code}/profissao`, {}, baseUrl),
          ).catch(() => null),
        ]);

        const mandatos = mandatosRes
          ? ensureArray((mandatosRes as any)?.MandatoParlamentar?.Parlamentar?.Mandatos?.Mandato ??
              (mandatosRes as any)?.Mandatos?.Mandato)
          : [];
        const filiacoes = filiacoesRes
          ? ensureArray((filiacoesRes as any)?.FiliacaoParlamentar?.Parlamentar?.Filiacoes?.Filiacao ??
              (filiacoesRes as any)?.Filiacoes?.Filiacao)
          : [];
        const profissoes = profissaoRes
          ? ensureArray((profissaoRes as any)?.ProfissaoParlamentar?.Parlamentar?.Profissoes?.Profissao ??
              (profissaoRes as any)?.Profissoes?.Profissao)
          : [];

        return toolResult({
          codigoSenador: code,
          mandatos: mandatos.map((m: any) => ({
            legislatura: parseInt(m.PrimeiraLegislaturaDoMandato?.NumeroLegislatura || m.NumeroLegislatura || "0"),
            uf: m.UfParlamentar || "",
            participacao: m.DescricaoParticipacao || "",
            dataInicio: m.DataInicio || null,
            dataFim: m.DataFim || null,
          })),
          filiacoes: filiacoes.map((f: any) => ({
            partido: f.Partido?.SiglaPartido || f.SiglaPartido || "",
            nomePartido: f.Partido?.NomePartido || f.NomePartido || "",
            dataFiliacao: f.DataFiliacao || null,
            dataDesfiliacao: f.DataDesfiliacao || null,
          })),
          profissoes: profissoes.map((p: any) => ({
            nome: p.NomeProfissao || p.DescricaoProfissao || "",
          })),
        });
      } catch (e) {
        return errorFrom(e, "Erro ao obter detalhes do senador");
      }
    },
  );
}
