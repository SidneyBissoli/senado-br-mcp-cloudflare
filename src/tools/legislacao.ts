/**
 * Group L — Legislação / Federal Law (2 tools)
 * senado_buscar_legislacao, senado_obter_legislacao
 * (a tabela de tipos de norma migrou para senado_tabelas_referencia em referencia.ts)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolError, errorFrom, buildParams, ensureArray } from "../utils/validation.js";
import { digArrayRoot } from "../utils/upstream-parse.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
import { CACHE_ON_DEMAND } from "../types.js";

/** Convert a "DD/MM/AAAA" date to ISO "AAAA-MM-DD"; passes through other strings. */
function brDateToISO(v: any): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}

/** Parse a legislation search result (ListaDocumento.documentos.documento[], lowercase). */
export function parseLegislacaoResumo(l: any) {
  const data = brDateToISO(l.dataassinatura || l.Data || l.data);
  return {
    codigo: l.id || l.Codigo || l.codigo || null,
    tipo: l.tipo || l.TipoNorma || null,
    descricaoTipo: l.descricao || null,
    numero: l.numero || l.Numero || null,
    ano: l.anoassinatura || l.ano || (data ? data.slice(0, 4) : null),
    data,
    norma: l.normaNome || null,
    ementa: l.ementa || l.Ementa || null,
    apelido: l.apelido || null,
  };
}

/** Parse a legislation detail (DetalheDocumento.documentos.documento[0], identificacao nested). */
export function parseLegislacaoDetalhe(doc: any) {
  const id = doc.identificacao || doc;
  const data = brDateToISO(id.dataassinatura || id.Data || id.data);
  return {
    codigo: doc.id || id.id || null,
    tipo: id.tipo || null,
    descricaoTipo: id.descricao || null,
    numero: id.numero || null,
    ano: data ? data.slice(0, 4) : null,
    data,
    norma: id.normaNome || null,
    apelido: id.apelido || null,
    ementa: doc.ementa || null,
    indexacao: ensureArray(doc.indexacao?.frase).join(" ").replace(/\s+/g, " ").trim() || null,
    url: id.urlDocumento || null,
  };
}

export function registerLegislacaoTools(server: McpServer, baseUrl: string) {
  // L1. senado_buscar_legislacao
  server.tool(
    "senado_buscar_legislacao",
    "Busca normas jurídicas federais **já promulgadas** (leis, decretos, leis complementares, emendas constitucionais etc.) combinando os filtros `tipo`, `numero`, `ano` e `data` em modo AND; informe ao menos um: uma chamada sem nenhum filtro retorna erro determinístico, não uma lista vazia. Somente leitura, sem efeitos colaterais; consulta ao vivo à base oficial de dados abertos, cujos resultados podem variar entre chamadas. Retorna `{ count, normas }` sem paginação: `count` é o total de normas que casam (0, sem erro, quando nenhuma casa) e cada item traz `codigo`, `tipo`, `descricaoTipo`, `numero`, `ano`, `data` (ISO AAAA-MM-DD), `norma`, `ementa` e `apelido`, com `null` nos campos ausentes. Passe o `codigo` a `senado_obter_legislacao` para obter a indexação temática e a URL do texto integral. Para **proposições ainda em tramitação** (PEC, PL, PLP, MPV) use `senado_buscar_materias`; esta ferramenta cobre apenas normas já promulgadas.",
    {
      tipo: z.string().optional().describe("Sigla oficial da espécie normativa: LEI, DEC (decreto), LCP (lei complementar), EMC (emenda constitucional), entre outras; catálogo completo em senado_tabelas_referencia (tabela=tipos-norma). Omitir alarga a busca a todas as espécies."),
      numero: z.number().int().positive().optional().describe("Número sequencial da norma (inteiro > 0), ex.: 14133 para a Lei n. 14.133/2021. Combina com `tipo` e `ano` em modo AND."),
      ano: z.number().int().min(1900).max(2100).optional().describe("Ano de assinatura/promulgação da norma, entre 1900 e 2100; ex.: 2021."),
      data: z.string().regex(/^\d{8}$/, "Use o formato compacto AAAAMMDD: 8 dígitos, sem separadores (ex.: 20210401).").optional().describe("Data exata de assinatura no formato compacto AAAAMMDD (8 dígitos, sem separadores), ex.: 20210401. Atenção: difere do campo `data` retornado, que vem em ISO AAAA-MM-DD."),
    },
    async (params) => {
      try {
        const qp = buildParams({
          tipo: params.tipo,
          numero: params.numero,
          ano: params.ano,
          data: params.data,
        });
        if (Object.keys(qp).length === 0) {
          return toolError("É obrigatório informar pelo menos um parâmetro de busca.");
        }
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_buscar_legislacao", qp, CACHE_ON_DEMAND,
          () => upstreamFetch("/legislacao/lista", qp, baseUrl),
        );
        const normas = digArrayRoot(
          response,
          [["ListaDocumento", "documentos", "documento"]],
          "senado_buscar_legislacao",
        ).map(parseLegislacaoResumo);
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/legislacao/lista", {
          reference_period: params.ano ? String(params.ano) : undefined,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({ count: normas.length, normas }, prov);
      } catch (e) {
        return errorFrom(e, "Erro na busca de legislação");
      }
    },
  );

  // L2. senado_obter_legislacao
  server.tool(
    "senado_obter_legislacao",
    "Obtém o detalhe de uma norma federal já promulgada pelo seu `codigo` interno. Somente leitura, sem efeitos colaterais; consulta ao vivo à base oficial de dados abertos. Retorna um objeto com `codigo`, `tipo`, `descricaoTipo`, `numero`, `ano`, `data` (ISO AAAA-MM-DD), `norma`, `apelido`, `ementa`, `indexacao` (termos temáticos) e `url` do texto integral — campos ausentes na norma vêm `null`, e `codigo` inexistente retorna erro \"Norma não encontrada\", não um objeto vazio. Obtenha o `codigo` antes via `senado_buscar_legislacao` (é o identificador interno da norma, não o número da lei). Para localizar normas por tipo/número/ano use `senado_buscar_legislacao`; esta serve só para o detalhe de uma norma já identificada.",
    {
      codigo: z.number().int().positive().describe("Identificador interno da norma no acervo do Senado (inteiro > 0) — o campo `codigo` retornado por senado_buscar_legislacao. Não confundir com o número da lei: a Lei n. 14.133/2021 tem numero=14133, mas seu codigo interno é outro valor."),
    },
    async (params) => {
      try {
        const path = `/legislacao/${params.codigo}`;
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_obter_legislacao",
          { codigo: params.codigo },
          CACHE_ON_DEMAND,
          () => upstreamFetch(path, {}, baseUrl),
        );
        const docs = digArrayRoot(
          response,
          [["DetalheDocumento", "documentos", "documento"]],
          "senado_obter_legislacao",
        );
        if (docs.length === 0) return toolError("Norma não encontrada.");
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          dataset_id: `norma=${params.codigo}`, retrieved_at: fetchedAt,
        });
        return resultWithProvenance(parseLegislacaoDetalhe(docs[0]), prov);
      } catch (e) {
        return errorFrom(e, "Norma não encontrada");
      }
    },
  );
}
