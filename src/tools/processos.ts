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
import { digArrayRoot } from "../utils/upstream-parse.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
import { CACHE_ON_DEMAND, CACHE_STATIC, CACHE_SEMI_STATIC } from "../types.js";

/** Convert YYYYMMDD → YYYY-MM-DD when needed (v3 endpoints require ISO dates). */
export function ensureISODate(d: string | undefined): string | undefined {
  if (!d) return undefined;
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
}

/**
 * Normalize the `tramitando` flag to a boolean (OBS-3). The v3 /processo family
 * returns it as the string "Sim"/"Não" (search and detail), while
 * buscar_materias/obter_materia already expose a boolean — unify on boolean.
 */
export function normalizeTramitando(v: any): boolean | null {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (s === "sim" || s === "s" || s === "true") return true;
  if (s === "não" || s === "nao" || s === "n" || s === "false") return false;
  return null;
}

/**
 * Compact a long authorship string (OBS-2). The search endpoint returns `autoria`
 * as a ~900-char comma-separated list of "Senador Nome (PARTIDO/UF)" — keep the
 * first `keep` authors and summarize the rest, returning the total count too.
 */
export function compactAutoria(autoria: any, keep = 3): { autoria: string | null; totalAutores: number } {
  if (typeof autoria !== "string" || !autoria.trim()) {
    return { autoria: autoria || null, totalAutores: 0 };
  }
  // Split on the "), " boundary between authors and re-append the ")".
  const parts = autoria
    .split(/\)\s*,\s*/)
    .map((p, i, arr) => (i < arr.length - 1 ? `${p})` : p))
    .map((s) => s.trim())
    .filter(Boolean);
  const total = parts.length;
  if (total <= keep) return { autoria: autoria.trim(), totalAutores: total };
  return {
    autoria: `${parts.slice(0, keep).join(", ")} … e mais ${total - keep} (${total} no total)`,
    totalAutores: total,
  };
}

/** Parse a JSON string, returning the original value on failure. */
function safeParseObject(d: any): any {
  if (typeof d !== "string") return d;
  try {
    return JSON.parse(d);
  } catch {
    return d;
  }
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
    // decisoes[] arrives as objects; the previous fallback JSON.stringify'd them into
    // strings (double-encode, OBS-18). Serve structured objects and trim descricaoTipo
    // (upstream carries a trailing space, e.g. "Rejeitada ").
    decisoes: ensureArray(e.decisoes).map((d: any) => {
      const obj = safeParseObject(d);
      if (!obj || typeof obj !== "object") return { descricao: String(d) };
      return {
        casa: obj.casa ?? null,
        data: obj.data ?? null,
        tipo: typeof obj.descricaoTipo === "string" ? obj.descricaoTipo.trim() : (obj.descricaoTipo ?? obj.tipo ?? null),
        comissao: obj.siglaColegiado ?? null,
        nomeComissao: obj.nomeColegiado ?? null,
      };
    }),
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
  const { autoria, totalAutores } = compactAutoria(p.autoria);
  return {
    id: p.id || null,
    codigoMateria: p.codigoMateria || null,
    identificacao: p.identificacao || null,
    ementa: p.ementa || null,
    tipoDocumento: p.tipoDocumento || null,
    dataApresentacao: p.dataApresentacao || null,
    autoria,
    totalAutores,
    tramitando: normalizeTramitando(p.tramitando),
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
    tramitando: normalizeTramitando(p.tramitando),
    // OBS-17: expose where the process is now — high-value fields the upstream
    // provides but the flattener used to discard.
    situacaoAtual: p.situacaoAtual || null,
    siglaSituacaoAtual: p.siglaSituacaoAtual || null,
    dataSituacaoAtual: p.dataSituacaoAtual || null,
    deliberacao: p.deliberacao && Object.keys(p.deliberacao).length > 0
      ? {
          data: p.deliberacao.data ?? null,
          tipo: p.deliberacao.tipoDeliberacao ?? p.deliberacao.siglaTipo ?? null,
          destino: p.deliberacao.destino ?? p.deliberacao.siglaDestino ?? null,
        }
      : null,
    normaGerada: p.normaGerada && Object.keys(p.normaGerada).length > 0 ? p.normaGerada : null,
  };
}

export function registerProcessosTools(server: McpServer, baseUrl: string) {
  // C1. senado_search_processos
  server.tool(
    "senado_search_processos",
    "Busca processos legislativos no endpoint v3 `/processo` (parâmetros complementares ao `senado_buscar_materias`). Retorna `{ count, total, aviso?, processos }`, cada item com `id`, `codigoMateria`, `identificacao`, `ementa`, `tipoDocumento`, `dataApresentacao`, `autoria` (compactada: primeiros autores + total), `totalAutores`, `tramitando` (boolean) e `normaGerada`. É obrigatório ao menos um filtro (sigla, número, ano, autor ou período). Limitado a `limite` (padrão 20, máx. 200), com `aviso` ao truncar. Use o `id` retornado em `senado_obter_processo` para detalhes.",
    {
      sigla: z.string().optional().describe("Sigla do tipo de processo (ex: PL, PEC)"),
      numero: z.number().int().optional().describe("Número do processo"),
      ano: z.number().int().optional().describe("Ano do processo"),
      autor: z.string().optional().describe("Nome do autor"),
      codigoParlamentarAutor: z.number().int().optional().describe("Código do parlamentar autor"),
      tramitando: z.enum(["S", "N"]).optional().describe("Em tramitação (S/N)"),
      dataInicioApresentacao: z.string().optional().describe("Data início da apresentação (YYYYMMDD ou YYYY-MM-DD)"),
      dataFimApresentacao: z.string().optional().describe("Data fim da apresentação (YYYYMMDD ou YYYY-MM-DD)"),
      limite: z.number().int().min(1).max(200).optional().default(20).describe("Máximo de resultados (padrão: 20)"),
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
        const todos = ensureArray(response).map(parseProcessoResumo);
        const limite = params.limite ?? 20;
        const processos = todos.slice(0, limite);
        const di = ensureISODate(params.dataInicioApresentacao);
        const df = ensureISODate(params.dataFimApresentacao);
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/processo", {
          reference_period: di && df ? `${di}/${df}` : params.ano ? String(params.ano) : di || df || undefined,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          count: processos.length,
          total: todos.length,
          ...(todos.length > limite ? { aviso: `Exibindo ${limite} de ${todos.length} processos.` } : {}),
          processos,
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro na busca de processos");
      }
    },
  );

  // C2. senado_obter_processo
  server.tool(
    "senado_obter_processo",
    "Obtém detalhes completos de um processo legislativo específico pelo seu `id`. Retorna um objeto com `id`, `codigoMateria`, `identificacao`, `sigla`, `numero`, `ano`, `objetivo`, `ementa`, `tipoConteudo`, `dataApresentacao`, `autoria`, `indexacao`, `urlDocumento`, `tramitando` (boolean) e o estado atual do processo: `situacaoAtual` (+`siglaSituacaoAtual`/`dataSituacaoAtual`), `deliberacao` (data, tipo, destino) e `normaGerada` (quando o processo virou norma). Obtenha o `idProcesso` antes via `senado_search_processos` ou `senado_buscar_materias`; para emendas, relatorias ou prazos use `senado_processo_detalhe` (parâmetro `secao`).",
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
      "`emendas` → emendas apresentadas (`id`, `identificacao`, `numero`, `tipo`, `autoria`, `data`, `colegiado`, `descricao`, `decisoes` (objetos com `casa`/`data`/`tipo`/`comissao`/`nomeComissao`), `url`; aceita filtro `codigoParlamentarAutor`); " +
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
    "Lista parlamentares autores de processos em tramitação, ordenados por produção (maior número de matérias primeiro). Atenção à semântica: 'atual' significa 'com processo AINDA EM TRAMITAÇÃO', não 'mandato vigente' — a lista mistura senadores, deputados e ex-parlamentares, e a mesma pessoa pode aparecer 2× com códigos distintos (ex.: como 'Senador' e como 'Deputado', pelo `tratamento`); não use como lista de senadores em exercício (para isso, `senado_listar_senadores`). Retorna `{ count, total, autores }`, cada autor com `codigo`, `nome`, `tratamento`, `uf` e `quantidadeMaterias`. Filtros opcionais `uf` e `nome` (busca parcial sem acento); `limite` padrão 50 (máx. 1000). Use o `codigo` em `senado_obter_senador` ou `senado_search_processos` (codigoParlamentarAutor).",
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
        let autores = digArrayRoot(
          response,
          [["ListaAutores", "Autores", "Autor"]],
          "senado_autores_atuais",
        )
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
    "Consulta tabelas de referência do processo legislativo para resolver códigos/siglas, conforme `tabela`. Domínios de entidade: `siglas` (siglas de proposição), `assuntos`, `classes`, `destinos`, `entes`. Domínios de tipo (código→descrição): `tipos-situacao`, `tipos-decisao`, `tipos-autor`, `tipos-atualizacao`, `tipos-documento`, `tipos-conteudo-documento`, `tipos-prazo`. Retorna `{ tabela, count, total, linhas }` — `count` é o nº após o corte por `limite` e `total` o disponível; `count < total` indica truncagem (aumente `limite`); `count` 0 quando o `filtro` não casa. Cada linha traz código/sigla e descrição (campos conforme a API). Use antes de filtrar em `senado_search_processos`/`senado_processo_detalhe`. Para as tabelas do plenário (tipos de sessão, legislaturas) use `senado_tabelas_plenario`.",
    {
      tabela: z.enum([
        "siglas", "assuntos", "classes", "destinos", "entes",
        "tipos-situacao", "tipos-decisao", "tipos-autor", "tipos-atualizacao",
        "tipos-documento", "tipos-conteudo-documento", "tipos-prazo",
      ]).describe("Tabela a consultar — entidades (siglas, assuntos, classes, destinos, entes) ou tipos (tipos-situacao, tipos-decisao, tipos-autor, tipos-atualizacao, tipos-documento, tipos-conteudo-documento, tipos-prazo)"),
      filtro: z.string().optional().describe("Busca textual sobre sigla/descrição; count 0 se nada casar"),
      limite: z.number().int().min(1).max(1000).optional().default(200).describe("Máximo de linhas (padrão 200, máx 1000); count < total sinaliza corte"),
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
