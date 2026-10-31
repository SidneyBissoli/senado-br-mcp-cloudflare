/**
 * Group I — Speeches (3 tools)
 * senado_discursos_senador (enum `tipo`: discursos | apartes), senado_discursos_plenario,
 * senado_discurso_texto
 * (a tabela de tipos de uso da palavra migrou para senado_tabelas_referencia em referencia.ts)
 */

import type { SenadoToolHost } from "../tool-host.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { errorFrom, ensureArray, safeInt } from "../utils/validation.js";
import { digArrayRoot } from "../utils/upstream-parse.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
import { CACHE_DYNAMIC, CACHE_ON_DEMAND } from "../types.js";
import {
  camposDePeriodosNaoLidos, carimboDaJanela, fatiar, filtrarPeriodo, lerFatias, maisAntigo, paraCompacta,
  recusarJanelaInvertida, type Fatia,
} from "../utils/janela.js";

/**
 * Aviso anexado quando `tipo=discursos` é chamado sem período. O upstream
 * `/senador/{cod}/discursos` limita a resposta aos últimos 30 dias quando
 * `dataInicio`/`dataFim` são omitidos (documentado no próprio Metadados:
 * "Se não informar o período, serão retornados os discursos dos últimos
 * 30 dias") — o que costuma vir vazio e induzir a conclusão errada de que
 * o senador não discursou. `apartes` não tem essa janela (traz o histórico).
 */
export const DISCURSOS_SEM_PERIODO_AVISO =
  "Sem dataInicio/dataFim, a fonte retorna apenas os discursos dos últimos 30 dias — " +
  "esta lista NÃO é o histórico completo do senador. Para consultar o histórico, informe " +
  "o período explícito (YYYYMMDD), por exemplo desde o início do mandato.";

/**
 * Monta o payload de `senado_discursos_senador`, anexando `aviso` quando
 * `tipo=discursos` foi consultado sem período (janela upstream de 30 dias —
 * ver DISCURSOS_SEM_PERIODO_AVISO).
 */
export function buildDiscursosSenadorResult(
  codigoSenador: number,
  tipo: string,
  discursos: any[],
  temPeriodo: boolean,
  falhas: ReadonlyArray<{ fatia: Fatia }> = [],
): Record<string, unknown> {
  const payload: Record<string, unknown> = { codigoSenador, tipo, count: discursos.length, discursos };
  if (tipo === "discursos" && !temPeriodo) payload.aviso = DISCURSOS_SEM_PERIODO_AVISO;
  return { ...payload, ...camposDePeriodosNaoLidos(falhas) };
}

/**
 * Pronunciamentos (ou apartes) de uma resposta de `/senador/{cod}/{tipo}`, com o nome do
 * parlamentar — que a fonte manda uma vez só, em Parlamentar.IdentificacaoParlamentar — em cada item.
 */
export function pronunciamentosDaResposta(response: unknown, tipo: string) {
  const r = response as any;
  const nomeParlamentar =
    r?.DiscursosParlamentar?.Parlamentar?.IdentificacaoParlamentar?.NomeParlamentar ??
    r?.ApartesParlamentar?.Parlamentar?.IdentificacaoParlamentar?.NomeParlamentar ??
    null;
  return ensureArray(
    tipo === "apartes"
      ? (r?.ApartesParlamentar?.Parlamentar?.Apartes?.Aparte ?? r?.Apartes?.Aparte)
      : (r?.DiscursosParlamentar?.Parlamentar?.Pronunciamentos?.Pronunciamento ?? r?.Pronunciamentos?.Pronunciamento),
  )
    .map(parseDiscursoResumo)
    .map((d) => ({ ...d, nomeParlamentar: d.nomeParlamentar ?? nomeParlamentar }));
}

/** Discursos de uma resposta de `/plenario/lista/discursos/{di}/{df}` (v4: Sessoes.Sessao[].Pronunciamentos). */
export function discursosDoPlenario(response: unknown) {
  // Sessao/Pronunciamento come as arrays even when unitary; ensureArray defends the rest.
  const sessoes = digArrayRoot(response, [["DiscursosSessao", "Sessoes", "Sessao"]], "senado_discursos_plenario");
  return sessoes.flatMap((s: any) => ensureArray(s?.Pronunciamentos?.Pronunciamento).map(parseDiscursoPlenario));
}

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

export function registerDiscursosTools(server: SenadoToolHost, baseUrl: string) {
  // I1. senado_discursos_senador (tipo: discursos | apartes)
  server.tool(
    "senado_discursos_senador",
    "Lista pronunciamentos de um senador, filtráveis por período e casa. `tipo` (padrão `discursos`) alterna entre `discursos` (falas próprias) e `apartes` (intervenções em falas de outros) — muda a fonte upstream e o conteúdo, mantendo a mesma estrutura. Retorna `{ codigoSenador, tipo, count, discursos, periodosNaoLidos?, aviso? }` sem paginação (`count` 0 e lista vazia quando não há pronunciamentos no período), cada item com `codigo`, `data`, `casa`, `tipoUsoPalavra`, `resumo`, `indexacao`, `url` e `nomeParlamentar` — sem o texto integral. ATENÇÃO: para `tipo=discursos`, omitir `dataInicio`/`dataFim` faz a fonte retornar SOMENTE os últimos 30 dias (frequentemente vazio) — para o histórico, informe o período explícito (ex.: desde o início do mandato; períodos de mais de 1 ano são lidos ano a ano por dentro, e um ano que a fonte não entregar aparece em `periodosNaoLidos`); `apartes` traz o histórico completo sem período e, com período, só os apartes dentro dele. Obtenha o `codigoSenador` via `senado_listar_senadores` e o texto completo em `senado_discurso_texto` (campo `codigo`). Para discursos de todos os senadores num período use `senado_discursos_plenario`, não esta.",
    {
      codigoSenador: z.number().int().positive().describe("Código único do senador"),
      tipo: z.enum(["discursos", "apartes"]).optional().default("discursos").describe("discursos = pronunciamentos próprios (padrão); apartes = intervenções em discursos de outros — altera a fonte e o conteúdo retornado"),
      casa: z.string().optional().describe("Restringe à casa: SF (Senado Federal) ou CN (Congresso Nacional); vazio traz ambas"),
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Início do período (YYYYMMDD); use junto com dataFim. Para tipo=discursos, sem período a fonte retorna só os últimos 30 dias"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Fim do período (YYYYMMDD); para tipo=discursos, omitir o período limita a resposta aos últimos 30 dias"),
    },
    async (params) => {
      try {
        const invertida = recusarJanelaInvertida(params.dataInicio, params.dataFim);
        if (invertida) return invertida;
        const tipo = params.tipo ?? "discursos";
        const path = `/senador/${params.codigoSenador}/${tipo}`;
        const ler = (qp: Record<string, string>) =>
          cachedFetchWithMeta(
            "senado_discursos_senador",
            { codigo: params.codigoSenador, tipo, ...qp },
            CACHE_DYNAMIC,
            () => upstreamFetch(path, qp, baseUrl),
          );
        const base: Record<string, string> = params.casa ? { casa: params.casa } : {};

        let leituras: Array<{ value: unknown; fetchedAt: string }>;
        let falhas: Array<{ fatia: Fatia }> = [];
        if (tipo === "apartes") {
          // The source ignores the period for apartes (always the full history, measured
          // 30/10/2026); the window is applied below, in-Worker.
          leituras = [await ler(base)];
        } else if (params.dataInicio && params.dataFim) {
          // Over 1 year the source keeps only the LAST 12 months, silently (measured 30/10/2026:
          // 2024–2026 came back from 11/11/2025 on): read one calendar year per call.
          const r = await lerFatias(fatiar(params.dataInicio, params.dataFim, "ano"), (f) =>
            ler({ ...base, dataInicio: paraCompacta(f.inicio), dataFim: paraCompacta(f.fim) }),
          );
          if (r.lidas.length === 0 && r.falhas.length > 0) throw r.falhas[0].erro;
          leituras = r.lidas.map((l) => l.valor);
          falhas = r.falhas;
        } else {
          leituras = [await ler({
            ...base,
            ...(params.dataInicio ? { dataInicio: params.dataInicio } : {}),
            ...(params.dataFim ? { dataFim: params.dataFim } : {}),
          })];
        }
        let discursos = leituras.flatMap((l) => pronunciamentosDaResposta(l.value, tipo));
        if (tipo === "apartes") discursos = filtrarPeriodo(discursos, (d) => d.data, params.dataInicio, params.dataFim);
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          dataset_id: `codigoParlamentar=${params.codigoSenador}; tipo=${tipo}`,
          reference_period: params.dataInicio && params.dataFim
            ? carimboDaJanela(params.dataInicio, params.dataFim) : undefined,
          retrieved_at: maisAntigo(leituras.map((l) => l.fetchedAt)),
        });
        return resultWithProvenance(
          buildDiscursosSenadorResult(
            params.codigoSenador, tipo, discursos,
            Boolean(params.dataInicio || params.dataFim),
            falhas,
          ),
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
        const invertida = recusarJanelaInvertida(params.dataInicio, params.dataFim);
        if (invertida) return invertida;
        // The source refuses (HTTP 400, generic) a window over 1 month — fim ≤ início + 1 mês,
        // measured 30/10/2026: read one calendar month per call.
        const fatias = fatiar(params.dataInicio, params.dataFim, "mes");
        const caminho = (f: Fatia) => `/plenario/lista/discursos/${paraCompacta(f.inicio)}/${paraCompacta(f.fim)}`;
        const { lidas, falhas } = await lerFatias(fatias, (f) =>
          cachedFetchWithMeta(
            "senado_discursos_plenario",
            { dataInicio: paraCompacta(f.inicio), dataFim: paraCompacta(f.fim) },
            CACHE_DYNAMIC,
            () => upstreamFetch(caminho(f), {}, baseUrl),
          ),
        );
        if (lidas.length === 0 && falhas.length > 0) throw falhas[0].erro;
        const discursos = lidas.flatMap(({ valor }) => discursosDoPlenario(valor.value));
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, caminho(fatias[0]), {
          ...(fatias.length > 1 ? { dataset_id: `discursos do plenário lidos mês a mês (${fatias.length} meses)` } : {}),
          reference_period: carimboDaJanela(params.dataInicio, params.dataFim),
          retrieved_at: maisAntigo(lidas.map((l) => l.valor.fetchedAt)),
        });
        return resultWithProvenance(
          {
            periodo: { dataInicio: params.dataInicio, dataFim: params.dataFim },
            count: discursos.length,
            discursos,
            ...camposDePeriodosNaoLidos(falhas),
          },
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
    "Obtém o texto integral de um único pronunciamento pelo `codigoPronunciamento`. Retorna `{ codigoPronunciamento, texto }`, onde `texto` é a transcrição completa (string, podendo ter dezenas de KB — não é truncada nem paginada); `codigo` inexistente ou discurso sem texto retorna erro. Obtenha o `codigoPronunciamento` antes via `senado_discursos_senador` ou `senado_discursos_plenario` (campo `codigo`). Para apenas listar/filtrar discursos (resumo, data, autor) use aquelas ferramentas; esta traz o texto de um discurso já identificado.",
    {
      codigoPronunciamento: z.number().int().positive().describe("Código do pronunciamento (campo `codigo` de senado_discursos_senador ou senado_discursos_plenario); um por discurso"),
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
            // + Accept including text/plain -> 200. Pelo `upstreamFetch` em modo texto
            // desde a 3.11.0 (antes: `fetch` cru, sem retry nem contagem no `retrieval`).
            const text = (await upstreamFetch(
              `/discurso/texto-integral/${params.codigoPronunciamento}`,
              {},
              baseUrl,
              { noJsonSuffix: true, text: true, accept: "text/plain, application/json" },
            )) as string;
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
