/**
 * Group A — Senators (5 tools)
 * senado_listar_senadores (filtro `nome` absorve a antiga busca por nome),
 * senado_obter_senador, senado_votacoes_senador,
 * senado_senador_historico (tipo: licencas | comissoes | cargos | historico-academico |
 *   filiacoes | profissoes — estes dois substituem o antigo senado_senador_detail),
 * senado_senadores_afastados
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
    response?.ListaParlamentarLegislatura?.Parlamentares?.Parlamentar ??
    response?.AfastamentoAtual?.Parlamentares?.Parlamentar;
  return ensureArray(list);
}

/** Parse a senator leave-of-absence (licença) entry. */
export function parseLicenca(l: any) {
  return {
    codigo: parseInt(l.Codigo || "0") || null,
    dataInicio: l.DataInicio || null,
    dataFim: l.DataFim || l.DataFimPrevista || null,
    descricao: l.DescricaoFinalidade || l.Descricao || l.TipoAfastamento?.Descricao || null,
  };
}

/** Parse a committee membership entry from /senador/{codigo}/comissoes. */
export function parseComissaoMembro(c: any) {
  const id = c.IdentificacaoComissao || {};
  return {
    codigo: parseInt(id.CodigoComissao || "0") || null,
    sigla: id.SiglaComissao || null,
    nome: id.NomeComissao || null,
    casa: id.SiglaCasaComissao || null,
    participacao: c.DescricaoParticipacao || null,
    dataInicio: c.DataInicio || null,
    dataFim: c.DataFim || null,
  };
}

/** Parse a committee position entry from /senador/{codigo}/cargos. */
export function parseCargoSenador(c: any) {
  const id = c.IdentificacaoComissao || {};
  return {
    comissao: id.SiglaComissao || null,
    nomeComissao: id.NomeComissao || null,
    casa: id.SiglaCasaComissao || null,
    cargo: c.DescricaoCargo || c.Cargo?.DescricaoCargo || null,
    dataInicio: c.DataInicio || null,
    dataFim: c.DataFim || null,
  };
}

/** Parse a party affiliation entry from /senador/{codigo}/filiacoes. */
export function parseFiliacao(f: any) {
  return {
    partido: f.Partido?.SiglaPartido || f.SiglaPartido || "",
    nomePartido: f.Partido?.NomePartido || f.NomePartido || "",
    dataFiliacao: f.DataFiliacao || null,
    dataDesfiliacao: f.DataDesfiliacao || null,
  };
}

/** Parse a profession entry from /senador/{codigo}/profissao. */
export function parseProfissao(p: any) {
  return { nome: p.NomeProfissao || p.DescricaoProfissao || "" };
}

/** Case/accent-insensitive substring match against a senator's full or short name. */
export function matchesNome(s: { nome: string; nomeCompleto: string }, nome: string): boolean {
  const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const alvo = norm(nome);
  return norm(s.nomeCompleto).includes(alvo) || norm(s.nome).includes(alvo);
}

export function registerSenadoresTools(server: McpServer, baseUrl: string) {
  // A1. senado_listar_senadores (filtro `nome` substitui a antiga busca por nome)
  server.tool(
    "senado_listar_senadores",
    "Lista senadores em exercício ou de uma legislatura específica, com filtros opcionais por `nome`, `uf` e `partido`. Retorna `{ count, senadores }`, cada item com `codigo`, `nome`, `nomeCompleto`, `partido`, `uf`, `foto` e `emExercicio`. Use `emExercicio` (padrão `true`) ou `legislatura` para escolher o conjunto; `nome` faz correspondência parcial ignorando acentos/maiúsculas (use quando você só tem o nome e precisa do `codigo`); `uf`/`partido` filtram localmente. Use o `codigo` em `senado_obter_senador` ou `senado_votacoes_senador`. Para senadores fora de exercício veja `senado_senadores_afastados`.",
    {
      emExercicio: z.boolean().optional().default(true).describe("Filtrar apenas senadores em exercício"),
      legislatura: z.number().int().min(1).optional().describe("Número da legislatura (ex: 57 para 2023-2027)"),
      nome: z.string().optional().describe("Nome ou parte do nome (busca parcial, sem acento)"),
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
        if (params.nome) {
          senadores = senadores.filter((s) => matchesNome(s, params.nome!));
        }
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

  // A2. senado_obter_senador
  server.tool(
    "senado_obter_senador",
    "Obtém o detalhe biográfico de um senador específico. Retorna um objeto com `codigo`, `nome`, `nomeCompleto`, `nomeCivil`, `sexo`, `dataNascimento`, `naturalidade`/`ufNaturalidade`, `partido`, `uf`, `foto`, `email` e a lista `mandatos` (`legislatura`, `uf`, `participacao`, `dataInicio`, `dataFim`). Requer `codigoSenador` — obtenha-o via `senado_listar_senadores` (filtro `nome`). Para filiações, profissões, licenças, comissões ou cargos use `senado_senador_historico` (parâmetro `tipo`).",
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
    "Lista as votações nominais de um senador, mostrando como votou em cada matéria. Retorna `{ periodo, count, votos }`, cada voto com `codigoVotacao`, `data`, `materia`, `descricao`, `voto` e `resultado`, ordenados da mais recente para a mais antiga. Sem período usa o ano corrente; informe `ano` ou o par `dataInicio`/`dataFim` (YYYYMMDD). Requer `codigoSenador` (obtenha via `senado_listar_senadores`); para detalhes de uma votação específica use `senado_obter_votacao`.",
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

  // A4. senado_senador_historico (licencas | comissoes | cargos | historico-academico | filiacoes | profissoes)
  server.tool(
    "senado_senador_historico",
    "Histórico funcional de um senador conforme o parâmetro `tipo`. Valores: `licencas` (itens com `dataInicio`/`dataFim`/`descricao`), `comissoes` (`sigla`/`nome`/`casa`/`participacao`/datas), `cargos` (`comissao`/`cargo`/datas), `historico-academico` (cursos, registros brutos da API), `filiacoes` (`partido`/`nomePartido`/`dataFiliacao`/`dataDesfiliacao`) e `profissoes` (`nome`). Retorna `{ codigoSenador, tipo, count, itens }`, com a forma de cada item dependente do `tipo`; tipos sem registros para o senador retornam `count` 0 e `itens` vazio. Requer `codigoSenador` (obtenha via `senado_listar_senadores`). Para dados biográficos e mandatos use `senado_obter_senador`.",
    {
      codigoSenador: z.number().int().positive().describe("Código único do senador"),
      tipo: z.enum(["licencas", "comissoes", "cargos", "historico-academico", "filiacoes", "profissoes"]).describe("Qual histórico consultar"),
    },
    async (params) => {
      try {
        const paths: Record<string, string> = {
          "licencas": `/senador/${params.codigoSenador}/licencas`,
          "comissoes": `/senador/${params.codigoSenador}/comissoes`,
          "cargos": `/senador/${params.codigoSenador}/cargos`,
          "historico-academico": `/senador/${params.codigoSenador}/historicoAcademico`,
          "filiacoes": `/senador/${params.codigoSenador}/filiacoes`,
          "profissoes": `/senador/${params.codigoSenador}/profissao`,
        };
        const response = await cachedFetch(
          "senado_senador_historico",
          { codigo: params.codigoSenador, tipo: params.tipo },
          CACHE_ON_DEMAND,
          () => upstreamFetch(paths[params.tipo], {}, baseUrl),
        );
        const r = response as any;
        let itens: any[];
        switch (params.tipo) {
          case "licencas":
            itens = ensureArray(r?.LicencaParlamentar?.Parlamentar?.Licencas?.Licenca).map(parseLicenca);
            break;
          case "comissoes":
            itens = ensureArray(r?.MembroComissaoParlamentar?.Parlamentar?.MembroComissoes?.Comissao).map(parseComissaoMembro);
            break;
          case "cargos":
            itens = ensureArray(r?.CargoParlamentar?.Parlamentar?.Cargos?.Cargo).map(parseCargoSenador);
            break;
          case "filiacoes":
            itens = ensureArray(r?.FiliacaoParlamentar?.Parlamentar?.Filiacoes?.Filiacao ?? r?.Filiacoes?.Filiacao).map(parseFiliacao);
            break;
          case "profissoes":
            itens = ensureArray(r?.ProfissaoParlamentar?.Parlamentar?.Profissoes?.Profissao ?? r?.Profissoes?.Profissao).map(parseProfissao);
            break;
          default: {
            const p = r?.HistoricoAcademicoParlamentar?.Parlamentar;
            itens = ensureArray(p?.HistoricoAcademico?.Curso ?? p?.Cursos?.Curso);
            break;
          }
        }
        return toolResult({ codigoSenador: params.codigoSenador, tipo: params.tipo, count: itens.length, itens });
      } catch (e) {
        return errorFrom(e, "Erro ao obter histórico do senador");
      }
    },
  );

  // A7. senado_senadores_afastados
  server.tool(
    "senado_senadores_afastados",
    "Lista os senadores atualmente afastados (fora de exercício). Retorna `{ count, senadores }`, cada item com `codigo`, `nome`, `nomeCompleto`, `partido`, `uf`, `foto` e `emExercicio` (sempre `false`). Não requer parâmetros. Use `codigo` em `senado_obter_senador` para o detalhe; para os senadores em exercício (e busca por nome) use `senado_listar_senadores`.",
    {},
    async () => {
      try {
        const response = await cachedFetch("senado_senadores_afastados", {}, CACHE_SEMI_STATIC, () =>
          upstreamFetch("/senador/afastados", {}, baseUrl),
        );
        const senadores = extractParlamentares(response).map(parseSenadorResumo)
          .map((s) => ({ ...s, emExercicio: false }));
        return toolResult({ count: senadores.length, senadores });
      } catch (e) {
        return errorFrom(e, "Erro ao listar senadores afastados");
      }
    },
  );
}
