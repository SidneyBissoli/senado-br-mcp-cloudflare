/**
 * Group I — Speeches (3 tools)
 * senado_discursos_senador (enum `tipo`: discursos | apartes), senado_discursos_plenario,
 * senado_discurso_texto
 * (a tabela de tipos de uso da palavra migrou para senado_tabelas_referencia em referencia.ts)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { errorFrom, ensureArray, safeInt } from "../utils/validation.js";
import { digArrayRoot } from "../utils/upstream-parse.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
import { CACHE_DYNAMIC, CACHE_ON_DEMAND, UPSTREAM_TIMEOUT_MS } from "../types.js";
import { USER_AGENT } from "../version.js";

/** Parse a speech summary from the senator or plenary speeches endpoint. */
export function parseDiscursoResumo(d: any) {
  const pronunciamento = d.Pronunciamento || d;
  return {
    codigo: pronunciamento.CodigoPronunciamento || pronunciamento.codigoPronunciamento || null,
    data: pronunciamento.DataPronunciamento || pronunciamento.dataPronunciamento || null,
    casa: pronunciamento.SiglaCasaPronunciamento || pronunciamento.siglaCasa || null,
    tipoUsoPalavra: pronunciamento.TipoUsoPalavra?.Descricao ||
      pronunciamento.tipoUsoPalavra || null,
    resumo: pronunciamento.TextoResumo || pronunciamento.resumo || null,
    indexacao: pronunciamento.Indexacao || pronunciamento.indexacao || null,
    url: pronunciamento.UrlTexto || pronunciamento.urlTexto || null,
    nomeParlamentar: pronunciamento.NomeParlamentar || pronunciamento.nomeParlamentar || null,
  };
}

/**
 * Parse a plenary pronouncement from the v4 service
 * (DiscursosSessao.Sessoes.Sessao[].Pronunciamentos.Pronunciamento[]) — different field
 * names from the per-senator endpoint (Data/Resumo/NomeAutor, not DataPronunciamento/...).
 */
export function parseDiscursoPlenario(p: any) {
  return {
    codigo: p.CodigoPronunciamento || p.id || null,
    data: p.Data || null,
    casa: p.Casa || null,
    tipoUsoPalavra: p.TipoUsoPalavra?.Descricao || null,
    resumo: p.Resumo || null,
    indexacao: p.Indexacao || null,
    url: p.TextoIntegral || null,
    nomeParlamentar: p.NomeAutor || null,
    codigoParlamentar: p.CodigoParlamentar ? safeInt(p.CodigoParlamentar) : null,
    partido: p.Partido || null,
    uf: p.UF || null,
  };
}

export function registerDiscursosTools(server: McpServer, baseUrl: string) {
  // I1. senado_discursos_senador (tipo: discursos | apartes)
  server.tool(
    "senado_discursos_senador",
    "Lista pronunciamentos de um senador, filtráveis por período e casa legislativa. O parâmetro `tipo` (padrão `discursos`) escolhe entre `discursos` (pronunciamentos próprios) e `apartes` (intervenções em discursos de outros parlamentares). Retorna `{ codigoSenador, tipo, count, discursos }`, cada item com `codigo`, `data`, `casa`, `tipoUsoPalavra`, `resumo`, `indexacao`, `url` e `nomeParlamentar` (sem texto integral; para `tipo: apartes` os itens são apartes, com a mesma estrutura). Obtenha o `codigoSenador` via `senado_listar_senadores`; use o `codigo` do pronunciamento em `senado_discurso_texto` para o texto completo.",
    {
      codigoSenador: z.number().int().positive().describe("Código único do senador"),
      tipo: z.enum(["discursos", "apartes"]).optional().default("discursos").describe("discursos (próprios) ou apartes (intervenções em discursos de outros)"),
      casa: z.string().optional().describe("Casa legislativa (SF=Senado, CN=Congresso)"),
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim (YYYYMMDD)"),
    },
    async (params) => {
      try {
        const tipo = params.tipo ?? "discursos";
        const qp: Record<string, string> = {};
        if (params.casa) qp.casa = params.casa;
        if (params.dataInicio) qp.dataInicio = params.dataInicio;
        if (params.dataFim) qp.dataFim = params.dataFim;

        const path = `/senador/${params.codigoSenador}/${tipo}`;
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_discursos_senador",
          { codigo: params.codigoSenador, tipo, ...qp },
          CACHE_DYNAMIC,
          () => upstreamFetch(path, qp, baseUrl),
        );
        const r = response as any;
        // The parliamentarian name lives once at Parlamentar.IdentificacaoParlamentar,
        // not per pronunciamento — inject it into each item.
        const nomeParlamentar =
          r?.DiscursosParlamentar?.Parlamentar?.IdentificacaoParlamentar?.NomeParlamentar ??
          r?.ApartesParlamentar?.Parlamentar?.IdentificacaoParlamentar?.NomeParlamentar ??
          null;
        const discursos = ensureArray(
          tipo === "apartes"
            ? (r?.ApartesParlamentar?.Parlamentar?.Apartes?.Aparte ?? r?.Apartes?.Aparte)
            : (r?.DiscursosParlamentar?.Parlamentar?.Pronunciamentos?.Pronunciamento ?? r?.Pronunciamentos?.Pronunciamento),
        )
          .map(parseDiscursoResumo)
          .map((d) => ({ ...d, nomeParlamentar: d.nomeParlamentar ?? nomeParlamentar }));
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          dataset_id: `codigoParlamentar=${params.codigoSenador}; tipo=${tipo}`,
          reference_period: params.dataInicio && params.dataFim
            ? `${params.dataInicio}/${params.dataFim}` : undefined,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance(
          { codigoSenador: params.codigoSenador, tipo, count: discursos.length, discursos },
          prov,
        );
      } catch (e) {
        return errorFrom(e, "Erro ao obter pronunciamentos do senador");
      }
    },
  );

  // I2. senado_discursos_plenario
  server.tool(
    "senado_discursos_plenario",
    "Lista todos os discursos realizados em plenário num período de datas (`dataInicio`/`dataFim` obrigatórias, formato YYYYMMDD). Retorna `{ periodo, count, discursos }`, cada item com `codigo`, `data`, `casa`, `tipoUsoPalavra`, `resumo`, `indexacao`, `url`, `nomeParlamentar`, `codigoParlamentar`, `partido` e `uf`. Para discursos de um parlamentar específico use `senado_discursos_senador`; obtenha o texto integral com `senado_discurso_texto`.",
    {
      dataInicio: z.string().regex(/^\d{8}$/).describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).describe("Data fim (YYYYMMDD)"),
    },
    async (params) => {
      try {
        const path = `/plenario/lista/discursos/${params.dataInicio}/${params.dataFim}`;
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_discursos_plenario",
          { dataInicio: params.dataInicio, dataFim: params.dataFim },
          CACHE_DYNAMIC,
          () => upstreamFetch(path, {}, baseUrl),
        );
        // v4: DiscursosSessao.Sessoes.Sessao[] each carrying Pronunciamentos.Pronunciamento[].
        // Sessao/Pronunciamento come as arrays even when unitary; ensureArray defends the rest.
        const sessoes = digArrayRoot(
          response,
          [["DiscursosSessao", "Sessoes", "Sessao"]],
          "senado_discursos_plenario",
        );
        const discursos = sessoes.flatMap((s: any) =>
          ensureArray(s?.Pronunciamentos?.Pronunciamento).map(parseDiscursoPlenario),
        );
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          reference_period: `${params.dataInicio}/${params.dataFim}`,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance(
          { periodo: { dataInicio: params.dataInicio, dataFim: params.dataFim }, count: discursos.length, discursos },
          prov,
        );
      } catch (e) {
        return errorFrom(e, "Erro ao obter discursos do plenário");
      }
    },
  );

  // I3. senado_discurso_texto
  // This endpoint returns plain text, not JSON. Use direct fetch with cachedFetch.
  server.tool(
    "senado_discurso_texto",
    "Obtém o texto integral de um pronunciamento/discurso específico. Retorna `{ codigoPronunciamento, texto }`, onde `texto` é o conteúdo completo do discurso (string). Obtenha o `codigoPronunciamento` primeiro via `senado_discursos_senador` ou `senado_discursos_plenario` (campo `codigo`).",
    {
      codigoPronunciamento: z.number().int().positive().describe("Código do pronunciamento"),
    },
    async (params) => {
      try {
        const { value: texto, fetchedAt } = await cachedFetchWithMeta<string>(
          "senado_discurso_texto",
          { codigo: params.codigoPronunciamento },
          CACHE_ON_DEMAND,
          async () => {
            // This endpoint serves ONLY text/plain; the ".json" suffix (or Accept:
            // application/json) forces content negotiation to JSON -> HTTP 406. No suffix
            // + Accept including text/plain -> 200.
            const url = `${baseUrl}/discurso/texto-integral/${params.codigoPronunciamento}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
            try {
              const resp = await fetch(url, {
                method: "GET",
                headers: {
                  Accept: "text/plain, application/json",
                  "User-Agent": USER_AGENT,
                },
                signal: controller.signal,
              });
              clearTimeout(timeout);
              if (!resp.ok) {
                throw new Error(`Upstream retornou HTTP ${resp.status} para texto do discurso ${params.codigoPronunciamento}`);
              }
              const text = await resp.text();
              if (!text.trim()) {
                throw new Error(`Texto do discurso ${params.codigoPronunciamento} vazio`);
              }
              // Try to parse as JSON first — API might wrap the text
              try {
                const json = JSON.parse(text);
                // If it's an object with a text field, extract it
                if (json && typeof json === "object") {
                  return json.TextoIntegral || json.textoIntegral || json.texto || text;
                }
                return text;
              } catch {
                // Not JSON — return raw text
                return text;
              }
            } catch (e) {
              clearTimeout(timeout);
              if ((e as Error).name === "AbortError") {
                throw new Error(`Timeout ao obter texto do discurso ${params.codigoPronunciamento}`);
              }
              throw e;
            }
          },
        );
        const prov = provenanceFor(
          "SENADO_LEGIS", baseUrl, `/discurso/texto-integral/${params.codigoPronunciamento}`,
          { dataset_id: `codigoPronunciamento=${params.codigoPronunciamento}`, retrieved_at: fetchedAt },
        );
        return resultWithProvenance(
          { codigoPronunciamento: params.codigoPronunciamento, texto },
          prov,
        );
      } catch (e) {
        return errorFrom(e, "Erro ao obter texto do discurso");
      }
    },
  );
}
