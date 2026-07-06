/**
 * Group C — Processes (5 tools)
 * senado_search_processos, senado_obter_processo,
 * senado_processo_detalhe (enum `secao`: emendas | relatorias | prazos),
 * senado_autores_atuais, senado_tabelas_processo
 *
 * All use the v3 /processo family (flat JSON, camelCase, ISO dates),
 * except /autor/lista/atual which still returns a legacy PascalCase wrapper.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolError, errorFrom, buildParams, ensureArray, safeInt, normalizeText } from "../utils/validation.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
import { CACHE_ON_DEMAND, CACHE_STATIC, CACHE_SEMI_STATIC } from "../types.js";

/** Convert YYYYMMDD → YYYY-MM-DD when needed (v3 endpoints require ISO dates). */
export function ensureISODate(d: string | undefined): string | undefined {
  if (!d) return undefined;
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
}

/** Parse a /processo/emenda item. */
export function parseEmendaProcesso(e: any) {
  return {
    id: e.id ?? null,
    identificacao: e.identificacao || null,
    numero: e.numero ?? null,
    tipo: e.tipo || null,
    autoria: e.autoria || null,
    data: e.dataApresentacao || null,
    colegiado: e.siglaColegiado || e.nomeColegiado || null,
    descricao: e.descricaoDocumentoEmenda || null,
    decisoes: ensureArray(e.decisoes).map((d: any) =>
      typeof d === "string" ? d : d.descricao || d.tipo || JSON.stringify(d)),
    url: e.urlDocumentoEmenda || null,
  };
}

/** Parse a /processo/relatoria item. */
export function parseRelatoriaProcesso(r: any) {
  return {
    idProcesso: r.idProcesso ?? null,
    codigoMateria: r.codigoMateria ?? null,
    processo: r.identificacaoProcesso || null,
    relator: r.nomeParlamentar || r.nomeCompleto || "",
    partido: r.siglaPartidoParlamentar || null,
    uf: r.ufParlamentar || null,
    tipoRelator: r.descricaoTipoRelator || null,
    comissao: r.siglaColegiado || null,
    nomeComissao: r.nomeColegiado || null,
    dataDesignacao: r.dataDesignacao || null,
    dataDestituicao: r.dataDestituicao || null,
    motivoEncerramento: r.descricaoTipoEncerramento || null,
  };
}

/** Parse an /autor/lista/atual entry (legacy PascalCase). */
export function parseAutorAtual(a: any) {
  return {
    codigo: safeInt(a.CodigoParlamentar),
    nome: a.NomeParlamentar || "",
    tratamento: (a.FormaTratamento || "").trim() || null,
    uf: a.UfParlamentar || null,
    quantidadeMaterias: safeInt(a.QuantidadeMaterias),
  };
}

/** Reference tables available via senado_tabelas_processo. */
export const TABELAS_PROCESSO: Record<string, string> = {
  "siglas": "/processo/siglas",
  "assuntos": "/processo/assuntos",
  "classes": "/processo/classes",
  "destinos": "/processo/destinos",
  "entes": "/processo/entes",
  "tipos-situacao": "/processo/tipos-situacao",
  "tipos-decisao": "/processo/tipos-decisao",
  "tipos-autor": "/processo/tipos-autor",
  "tipos-atualizacao": "/processo/tipos-atualizacao",
  "tipos-documento": "/processo/documento/tipos",
  "tipos-conteudo-documento": "/processo/documento/tipos-conteudo",
  "tipos-prazo": "/processo/prazo/tipos",
};

/** Parse a process item from the search endpoint (flat camelCase). */
export function parseProcessoResumo(p: any) {
  return {
    id: p.id || null,
    codigoMateria: p.codigoMateria || null,
    identificacao: p.identificacao || null,
    ementa: p.ementa || null,
    tipoDocumento: p.tipoDocumento || null,
    dataApresentacao: p.dataApresentacao || null,
    autoria: p.autoria || null,
    tramitando: p.tramitando || null,
    dataDeliberacao: p.dataDeliberacao || null,
    normaGerada: p.normaGerada || null,
  };
}

/** Parse a process detail from the /{id} endpoint (flat camelCase). */
export function parseProcessoDetalhe(p: any) {
  return {
    id: p.id || null,
    codigoMateria: p.codigoMateria || null,
    identificacao: p.identificacao || null,
    sigla: p.sigla || null,
    descricaoSigla: p.descricaoSigla || null,
    numero: p.numero || null,
    ano: p.ano || null,
    objetivo: p.objetivo || null,
    ementa: p.conteudo?.ementa || null,
    tipoConteudo: p.conteudo?.tipo || null,
    dataApresentacao: p.documento?.dataApresentacao || null,
    autoria: p.documento?.resumoAutoria || null,
    indexacao: p.documento?.indexacao || null,
    urlDocumento: p.documento?.url || null,
    tramitando: p.tramitando || null,
  };
}

export function registerProcessosTools(server: McpServer, baseUrl: string) {
  // C1. senado_search_processos
  server.tool(
    "senado_search_processos",
    "Busca processos legislativos no endpoint v3 `/processo` (parâmetros complementares ao `senado_buscar_materias`). Retorna `{ count, processos }`, cada item com `id`, `codigoMateria`, `identificacao`, `ementa`, `tipoDocumento`, `dataApresentacao`, `autoria`, `tramitando` e `normaGerada`. É obrigatório ao menos um filtro (sigla, número, ano, autor ou período; janela de datas máx. 1 ano). Use o `id` retornado em `senado_obter_processo` para detalhes.",
    {
      sigla: z.string().optional().describe("Sigla do tipo de processo (ex: PL, PEC)"),
      numero: z.number().int().optional().describe("Número do processo"),
      ano: z.number().int().optional().describe("Ano do processo"),
      autor: z.string().optional().describe("Nome do autor"),
      codigoParlamentarAutor: z.number().int().optional().describe("Código do parlamentar autor"),
      tramitando: z.enum(["S", "N"]).optional().describe("Em tramitação (S/N)"),
      dataInicioApresentacao: z.string().optional().describe("Data início da apresentação (YYYYMMDD ou YYYY-MM-DD; janela máxima de 1 ano)"),
      dataFimApresentacao: z.string().optional().describe("Data fim da apresentação (YYYYMMDD ou YYYY-MM-DD)"),
    },
    async (params) => {
      try {
        const qp = buildParams({
          sigla: params.sigla,
          numero: params.numero,
          ano: params.ano,
          autor: params.autor,
          codigoParlamentarAutor: params.codigoParlamentarAutor,
          tramitando: params.tramitando,
          dataInicioApresentacao: ensureISODate(params.dataInicioApresentacao),
          dataFimApresentacao: ensureISODate(params.dataFimApresentacao),
        });
        if (Object.keys(qp).length === 0) {
          return toolError("É obrigatório informar pelo menos um parâmetro de busca.");
        }
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_search_processos",
          qp,
          CACHE_ON_DEMAND,
          () => upstreamFetch("/processo", qp, baseUrl),
        );
        const processos = ensureArray(response).map(parseProcessoResumo);
        const di = ensureISODate(params.dataInicioApresentacao);
        const df = ensureISODate(params.dataFimApresentacao);
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/processo", {
          reference_period: di && df ? `${di}/${df}` : params.ano ? String(params.ano) : di || df || undefined,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({ count: processos.length, processos }, prov);
      } catch (e) {
        return errorFrom(e, "Erro na busca de processos");
      }
    },
  );

  // C2. senado_obter_processo
  server.tool(
    "senado_obter_processo",
    "Obtém detalhes completos de um processo legislativo específico pelo seu `id`. Retorna um objeto com `id`, `codigoMateria`, `identificacao`, `sigla`, `numero`, `ano`, `objetivo`, `ementa`, `tipoConteudo`, `dataApresentacao`, `autoria`, `indexacao`, `urlDocumento` e `tramitando`. Obtenha o `idProcesso` antes via `senado_search_processos` ou `senado_buscar_materias`; para emendas, relatorias ou prazos use `senado_processo_detalhe` (parâmetro `secao`).",
    {
      idProcesso: z.number().int().positive().describe("ID do processo legislativo"),
    },
    async (params) => {
      try {
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_obter_processo",
          { id: params.idProcesso },
          CACHE_ON_DEMAND,
          () => upstreamFetch(`/processo/${params.idProcesso}`, {}, baseUrl),
        );
        const detalhe = parseProcessoDetalhe(response as any);
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, `/processo/${params.idProcesso}`, {
          dataset_id: detalhe.codigoMateria
            ? `codigoMateria=${detalhe.codigoMateria}`
            : `idProcesso=${params.idProcesso}`,
          reference_period: detalhe.dataApresentacao || (detalhe.ano ? String(detalhe.ano) : undefined),
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance(detalhe, prov);
      } catch (e) {
        return errorFrom(e, "Processo não encontrado");
      }
    },
  );

  // C3. senado_processo_detalhe (secao: emendas | relatorias | prazos)
  server.tool(
    "senado_processo_detalhe",
    "Detalha um aspecto de processos legislativos conforme o parâmetro `secao`: " +
      "`emendas` → emendas apresentadas (`id`, `identificacao`, `numero`, `tipo`, `autoria`, `data`, `colegiado`, `descricao`, `decisoes`, `url`; aceita filtro `codigoParlamentarAutor`); " +
      "`relatorias` → relatorias designadas (`idProcesso`, `processo`, `relator`, `partido`, `uf`, `tipoRelator`, `comissao`, `dataDesignacao`, `dataDestituicao`, `motivoEncerramento`; aceita `codigoParlamentar`/`codigoColegiado`/`dataReferencia`); " +
      "`prazos` → prazos regimentais/constitucionais (registros brutos da API; aceita `dataReferencia`). " +
      "Todos aceitam `idProcesso` e/ou `codigoMateria` e período `dataInicio`/`dataFim` (YYYYMMDD ou ISO) — informe pelo menos um filtro. Retorna `{ secao, count, total, aviso?, itens }`, limitado a `limite` (padrão 100, máx. 500). " +
      "Obtenha o `idProcesso` via `senado_search_processos`; tipos de prazo via `senado_tabelas_processo`.",
    {
      secao: z.enum(["emendas", "relatorias", "prazos"]).describe("Qual aspecto detalhar: emendas, relatorias ou prazos"),
      idProcesso: z.number().int().positive().optional().describe("ID do processo"),
      codigoMateria: z.number().int().positive().optional().describe("Código legado da matéria"),
      codigoParlamentarAutor: z.number().int().optional().describe("secao=emendas: código do parlamentar autor"),
      codigoParlamentar: z.number().int().optional().describe("secao=relatorias: código do parlamentar relator"),
      codigoColegiado: z.number().int().optional().describe("secao=relatorias: código do colegiado"),
      dataReferencia: z.string().optional().describe("secao=relatorias/prazos: vigentes nesta data (YYYYMMDD ou YYYY-MM-DD)"),
      dataInicio: z.string().optional().describe("A partir desta data (YYYYMMDD ou YYYY-MM-DD)"),
      dataFim: z.string().optional().describe("Até esta data (YYYYMMDD ou YYYY-MM-DD)"),
      limite: z.number().int().min(1).max(500).optional().default(100).describe("Máximo de resultados (padrão: 100)"),
    },
    async (params) => {
      try {
        const di = ensureISODate(params.dataInicio);
        const df = ensureISODate(params.dataFim);
        const dref = ensureISODate(params.dataReferencia);
        const limite = params.limite ?? 100;

        let path: string;
        let qp: Record<string, string>;
        let mapper: (x: any) => any;
        if (params.secao === "relatorias") {
          path = "/processo/relatoria";
          qp = buildParams({
            idProcesso: params.idProcesso,
            codigoMateria: params.codigoMateria,
            codigoParlamentar: params.codigoParlamentar,
            codigoColegiado: params.codigoColegiado,
            dataReferencia: dref,
            dataInicio: di,
            dataFim: df,
          });
          mapper = parseRelatoriaProcesso;
        } else if (params.secao === "prazos") {
          path = "/processo/prazo";
          qp = buildParams({
            idProcesso: params.idProcesso,
            codigoMateria: params.codigoMateria,
            dataReferencia: dref,
            dataInicio: di,
            dataFim: df,
          });
          mapper = (x: any) => x;
        } else {
          path = "/processo/emenda";
          qp = buildParams({
            idProcesso: params.idProcesso,
            codigoMateria: params.codigoMateria,
            codigoParlamentarAutor: params.codigoParlamentarAutor,
            dataInicio: di,
            dataFim: df,
          });
          mapper = parseEmendaProcesso;
        }

        if (Object.keys(qp).length === 0) {
          return toolError("Informe pelo menos um filtro (idProcesso, codigoMateria ou período).");
        }

        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_processo_detalhe",
          { secao: params.secao, ...qp },
          CACHE_ON_DEMAND,
          () => upstreamFetch(path, qp, baseUrl),
        );
        const todos = ensureArray(response).map(mapper);
        const itens = todos.slice(0, limite);
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          dataset_id: params.idProcesso
            ? `idProcesso=${params.idProcesso}`
            : params.codigoMateria
              ? `codigoMateria=${params.codigoMateria}`
              : undefined,
          reference_period: di && df ? `${di}/${df}` : dref || di || df || undefined,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          secao: params.secao,
          count: itens.length,
          total: todos.length,
          ...(todos.length > limite ? { aviso: `Exibindo ${limite} de ${todos.length} registros.` } : {}),
          itens,
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao obter detalhe do processo");
      }
    },
  );

  // C6. senado_autores_atuais
  server.tool(
    "senado_autores_atuais",
    "Lista parlamentares autores de processos em tramitação, ordenados por produção (maior número de matérias primeiro). Retorna `{ count, total, autores }`, cada autor com `codigo`, `nome`, `tratamento`, `uf` e `quantidadeMaterias`. Filtros opcionais `uf` e `nome` (busca parcial sem acento); `limite` padrão 50 (máx. 1000). Use o `codigo` em `senado_obter_senador` ou `senado_search_processos` (codigoParlamentarAutor).",
    {
      uf: z.string().max(2).optional().describe("Filtrar por UF (ex: SP)"),
      nome: z.string().optional().describe("Filtrar por nome (busca parcial)"),
      limite: z.number().int().min(1).max(1000).optional().default(50).describe("Máximo de resultados (padrão: 50)"),
    },
    async (params) => {
      try {
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_autores_atuais",
          {},
          CACHE_SEMI_STATIC,
          () => upstreamFetch("/autor/lista/atual", {}, baseUrl),
        );
        const r = response as any;
        let autores = ensureArray(r?.ListaAutores?.Autores?.Parlamentar ?? r?.Autores?.Parlamentar)
          .map(parseAutorAtual)
          .sort((a, b) => b.quantidadeMaterias - a.quantidadeMaterias);
        if (params.uf) {
          const uf = params.uf.toUpperCase();
          autores = autores.filter((a) => a.uf?.toUpperCase() === uf);
        }
        if (params.nome) {
          const alvo = normalizeText(params.nome);
          autores = autores.filter((a) => normalizeText(a.nome).includes(alvo));
        }
        const limite = params.limite ?? 50;
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/autor/lista/atual", {
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          count: Math.min(autores.length, limite),
          total: autores.length,
          autores: autores.slice(0, limite),
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao obter autores");
      }
    },
  );

  // C7. senado_tabelas_processo (consolidated reference tables)
  server.tool(
    "senado_tabelas_processo",
    "Consulta tabelas de referência do processo legislativo (parâmetro `tabela`): siglas, assuntos, classes, destinos, entes, tipos-situacao/decisao/autor/atualizacao/documento/conteudo-documento/prazo. Retorna `{ tabela, count, total, linhas }` com as linhas brutas da tabela escolhida — cada linha traz tipicamente um código/sigla e a descrição do domínio (campos conforme a API). `filtro` textual opcional (sobre sigla/descrição) e `limite` padrão 200 (máx. 1000); `count` 0 quando o filtro não casa. Use para resolver códigos/siglas antes de filtrar em `senado_search_processos` e ferramentas afins.",
    {
      tabela: z.enum([
        "siglas", "assuntos", "classes", "destinos", "entes",
        "tipos-situacao", "tipos-decisao", "tipos-autor", "tipos-atualizacao",
        "tipos-documento", "tipos-conteudo-documento", "tipos-prazo",
      ]).describe("Tabela de referência a consultar"),
      filtro: z.string().optional().describe("Filtro textual aplicado sobre sigla/descrição"),
      limite: z.number().int().min(1).max(1000).optional().default(200).describe("Máximo de linhas (padrão: 200)"),
    },
    async (params) => {
      try {
        const path = TABELAS_PROCESSO[params.tabela];
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_tabelas_processo",
          { tabela: params.tabela },
          CACHE_STATIC,
          () => upstreamFetch(path, {}, baseUrl),
        );
        let linhas = ensureArray(response);
        if (params.filtro) {
          const f = params.filtro.toLowerCase();
          linhas = linhas.filter((l: any) => JSON.stringify(l).toLowerCase().includes(f));
        }
        const limite = params.limite ?? 200;
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          dataset_id: `tabela=${params.tabela}`,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          tabela: params.tabela,
          count: Math.min(linhas.length, limite),
          total: linhas.length,
          linhas: linhas.slice(0, limite),
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao consultar tabela de referência");
      }
    },
  );
}
