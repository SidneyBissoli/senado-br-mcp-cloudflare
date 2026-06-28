/**
 * Group B — Bills / Matérias Legislativas (2 tools)
 * senado_buscar_materias,
 * senado_obter_materia (enum `secao`: detalhe | tramitacao | textos)
 * Note: senado_votos_materia is registered in votacoes.ts (Group D) as D4.
 *
 * Migrated to the v3 /processo API — the legacy /materia/* endpoints are
 * deprecated upstream. Tool names and output keys remain stable; codigoMateria
 * is still the primary input (v3 accepts it as a bridge parameter).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolError, errorFrom, buildParams, ensureArray, safeInt } from "../utils/validation.js";
import { provenanceFor, resultWithProvenance, type FieldSource } from "../utils/provenance.js";
import { CACHE_ON_DEMAND, CACHE_DYNAMIC } from "../types.js";

/** Convert YYYYMMDD → YYYY-MM-DD when needed (v3 endpoints require ISO dates). */
export function ensureISODate(d: string | undefined): string | undefined {
  if (!d) return undefined;
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
}

function datePart(d: string | null | undefined): string {
  return d ? String(d).split("T")[0] : "";
}

/** Parse a /processo search result item (flat camelCase). */
export function parseProcessoResumo(p: any) {
  const m = typeof p.identificacao === "string" ? p.identificacao.match(/^(\S+)\s+(\d+)\/(\d{4})/) : null;
  return {
    codigo: p.codigoMateria ?? null,
    idProcesso: p.id ?? null,
    sigla: p.sigla || (m ? m[1] : ""),
    numero: safeInt(p.numero ?? (m ? m[2] : 0)),
    ano: safeInt(p.ano ?? (m ? m[3] : 0)),
    identificacao: p.identificacao || null,
    ementa: p.ementa || null,
    autor: p.autoria || null,
    situacao: p.situacaoAtual || null,
    dataApresentacao: p.dataApresentacao || null,
    tramitando: p.tramitando === "Sim" || p.tramitando === "S" ? true
      : p.tramitando === "Não" || p.tramitando === "N" ? false : null,
    url: p.urlDocumento || null,
  };
}

/** Parse a /processo/{id} detail response (does not include ementa — that comes from search). */
export function parseProcessoDetalhe(det: any) {
  const autuacoes = ensureArray(det.autuacoes);
  const autorPrincipal = ensureArray(det.autoriaIniciativa)[0];
  const deliberacao = det.deliberacao && Object.keys(det.deliberacao).length > 0 ? {
    data: det.deliberacao.data || null,
    tipo: det.deliberacao.tipoDeliberacao || det.deliberacao.siglaTipo || null,
    destino: det.deliberacao.destino || null,
  } : null;
  const normaGerada = det.normaGerada && Object.keys(det.normaGerada).length > 0 ? det.normaGerada : null;
  return {
    codigo: det.codigoMateria ?? null,
    idProcesso: det.id ?? null,
    sigla: det.sigla || "",
    numero: safeInt(det.numero),
    ano: safeInt(det.ano),
    identificacao: det.identificacao || null,
    apelido: det.apelido || null,
    autor: autorPrincipal?.autor || null,
    tipoAutor: autorPrincipal?.descricaoTipo || null,
    situacao: det.situacaoAtual || null,
    localAtual: autuacoes[0]?.nomeEnteControleAtual || null,
    dataApresentacao: det.documento?.dataApresentacao || det.dataInicioEfetivo || null,
    dataUltimaAtualizacao: det.dataSituacaoAtual || null,
    indexacao: typeof det.documento?.indexacao === "string" ? det.documento.indexacao.trim() : null,
    url: det.documento?.url || null,
    tramitando: det.tramitando === "Sim" || det.tramitando === "S" ? true
      : det.tramitando === "Não" || det.tramitando === "N" ? false : null,
    classificacoes: ensureArray(det.classificacoes).map((c: any) => c.descricaoHierarquia || c.descricao).filter(Boolean),
    deliberacao,
    normaGerada,
  };
}

/** Pick the current rapporteur from /processo/relatoria results (or the most recent one). */
export function pickRelatorAtual(relatorias: any[]) {
  const list = ensureArray(relatorias);
  if (list.length === 0) return null;
  const atual = list.find((r: any) => !r.dataDestituicao) ??
    list.slice().sort((a: any, b: any) =>
      String(b.dataDesignacao || "").localeCompare(String(a.dataDesignacao || "")))[0];
  return {
    nome: atual.nomeParlamentar || atual.nomeCompleto || "",
    partido: atual.siglaPartidoParlamentar || null,
    uf: atual.ufParlamentar || null,
    tipo: atual.descricaoTipoRelator || null,
    comissao: atual.siglaColegiado || null,
    dataDesignacao: atual.dataDesignacao || null,
    dataDestituicao: atual.dataDestituicao || null,
  };
}

/** Flatten autuacoes[].informesLegislativos into a chronological tramitação list. */
export function parseInformesTramitacao(det: any) {
  const informes: any[] = [];
  for (const aut of ensureArray(det.autuacoes)) {
    for (const inf of ensureArray((aut as any).informesLegislativos)) {
      informes.push({
        data: inf.data || "",
        local: inf.colegiado?.nome || inf.enteAdministrativo?.nome || null,
        descricao: inf.descricao || null,
      });
    }
  }
  informes.sort((a, b) => String(a.data).localeCompare(String(b.data)));
  return informes;
}

/** Parse a /processo/documento item. */
export function parseDocumentoProcesso(d: any) {
  return {
    tipo: d.descricaoTipo || d.siglaTipo || "Documento",
    formato: d.siglaTipo || null,
    identificacao: d.identificacao || null,
    data: d.dataDocumento || null,
    autoria: d.autoria || null,
    url: d.urlDocumento || "",
  };
}

/**
 * Resolve codigoMateria → processo summary item via /processo?codigoMateria=.
 * Devolve também o `fetchedAt` do cache p/ a granularidade por-campo (o resumo dá a `ementa`).
 */
async function resolveProcesso(
  codigoMateria: number,
  baseUrl: string,
): Promise<{ item: any; fetchedAt: string }> {
  const { value: response, fetchedAt } = await cachedFetchWithMeta(
    "_processo_por_materia",
    { codigoMateria },
    CACHE_ON_DEMAND,
    () => upstreamFetch("/processo", { codigoMateria: String(codigoMateria) }, baseUrl),
  );
  const item = ensureArray(response)[0];
  if (!item || !(item as any).id) {
    throw new Error(`Matéria ${codigoMateria} não encontrada na API de processos`);
  }
  return { item, fetchedAt };
}

export function registerMateriasTools(server: McpServer, baseUrl: string) {
  // B1. senado_buscar_materias
  server.tool(
    "senado_buscar_materias",
    "Busca matérias legislativas por tipo (PEC, PL, PLP, MPV), número, ano, palavras-chave, autor, período de apresentação ou situação de tramitação; informe ao menos um critério. Para pedidos como 'matérias recentes sobre X', use `palavraChave`, `ano` ou `dataInicioApresentacao`/`dataFimApresentacao`, `ordenarPor: 'dataApresentacao'`, `ordem: 'desc'` e `limite` baixo (ex: 10); não é necessário chamar detalhes para listar resultados. Retorna `{ count, total, materias[] }`, cada item com `codigo` (codigoMateria), `sigla`, `numero`, `ano`, `ementa`, `autor`, `situacao`, `dataApresentacao`, `url` e `tramitando`. Use `codigo` em `senado_obter_materia` apenas quando o usuário pedir detalhe/tramitação/textos. `limite` padrão 100 (máx. 500); ao truncar inclui `aviso`.",
    {
      sigla: z.string().optional().describe("Tipo: PEC, PL, PLP, MPV, PDL, PRS, etc."),
      numero: z.number().int().positive().optional().describe("Número da matéria"),
      ano: z.number().int().min(1900).max(2100).optional().describe("Ano da matéria"),
      palavraChave: z.string().optional().describe("Termo livre buscado nas palavras-chave do processo"),
      autorNome: z.string().optional().describe("Nome do autor"),
      tramitando: z.boolean().optional().describe("Apenas em tramitação"),
      dataInicioApresentacao: z.string().regex(/^(\d{8}|\d{4}-\d{2}-\d{2})$/).optional().describe("Data inicial de apresentação (YYYYMMDD ou YYYY-MM-DD)"),
      dataFimApresentacao: z.string().regex(/^(\d{8}|\d{4}-\d{2}-\d{2})$/).optional().describe("Data final de apresentação (YYYYMMDD ou YYYY-MM-DD)"),
      ordenarPor: z.enum(["relevancia", "dataApresentacao"]).optional().default("dataApresentacao").describe("Ordenação local; padrão dataApresentacao para favorecer pedidos recentes"),
      ordem: z.enum(["asc", "desc"]).optional().default("desc").describe("Direção da ordenação quando ordenarPor=dataApresentacao"),
      limite: z.number().int().min(1).max(500).optional().default(100).describe("Máximo de resultados (padrão: 100)"),
    },
    async (params) => {
      try {
        const di = ensureISODate(params.dataInicioApresentacao);
        const df = ensureISODate(params.dataFimApresentacao);
        const qp = buildParams({
          sigla: params.sigla?.toUpperCase(),
          numero: params.numero,
          ano: params.ano,
          termo: params.palavraChave,
          autor: params.autorNome,
          tramitando: params.tramitando !== undefined ? (params.tramitando ? "S" : "N") : undefined,
          dataInicioApresentacao: di,
          dataFimApresentacao: df,
        });
        if (Object.keys(qp).length === 0) {
          return toolError("É obrigatório informar pelo menos um critério de busca.");
        }
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_buscar_materias",
          qp,
          CACHE_ON_DEMAND,
          () => upstreamFetch("/processo", qp, baseUrl),
        );
        let todos = ensureArray(response).map(parseProcessoResumo);
        if (di) {
          todos = todos.filter((m) => datePart(m.dataApresentacao) >= di);
        }
        if (df) {
          todos = todos.filter((m) => datePart(m.dataApresentacao) <= df);
        }
        if (params.ordenarPor === "dataApresentacao") {
          const multiplier = (params.ordem ?? "desc") === "asc" ? 1 : -1;
          todos = todos.slice().sort((a, b) =>
            multiplier * datePart(a.dataApresentacao).localeCompare(datePart(b.dataApresentacao)));
        }
        const limite = params.limite ?? 100;
        const materias = todos.slice(0, limite);
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/processo", {
          reference_period: di && df ? `${di}/${df}` : params.ano ? String(params.ano) : di || df || undefined,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          count: materias.length,
          total: todos.length,
          ...(todos.length > limite ? { aviso: `Exibindo ${limite} de ${todos.length} resultados. Refine a busca ou aumente o limite.` } : {}),
          materias,
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro na busca de matérias");
      }
    },
  );

  // B2. senado_obter_materia (secao: detalhe | tramitacao | textos)
  server.tool(
    "senado_obter_materia",
    "Obtém dados de uma matéria pelo `codigoMateria`, conforme `secao` (padrão `detalhe`): " +
      "`detalhe` → objeto com `identificacao`, `apelido`, `ementa`, `autor`, `situacao`, `localAtual`, `dataApresentacao`, `indexacao`, `classificacoes[]`, `tramitando`, `relator` (nome/partido/uf/comissão), `deliberacao` e `normaGerada`. " +
      "`tramitacao` → histórico de tramitação cronológico em `tramitacoes[]` (`data`, `local`, `descricao`), com `count`/`total` (mantém os mais recentes ao truncar). " +
      "`textos` → documentos da matéria em `textos[]` (`tipo`, `formato`, `identificacao`, `data`, `autoria`, `url`), do mais recente ao mais antigo. " +
      "`limite` aplica-se a tramitacao/textos (padrão 100 e 50; ao truncar inclui `aviso`). Obtenha o `codigoMateria` via `senado_buscar_materias`.",
    {
      codigoMateria: z.number().int().positive().describe("Código único da matéria"),
      secao: z.enum(["detalhe", "tramitacao", "textos"]).optional().default("detalhe").describe("detalhe (situação/relator), tramitacao (histórico) ou textos (documentos)"),
      limite: z.number().int().min(1).max(1000).optional().describe("Máximo de itens em tramitacao/textos (padrão: 100 tramitacao, 50 textos)"),
    },
    async (params) => {
      try {
        const secao = params.secao ?? "detalhe";

        if (secao === "tramitacao") {
          const { item: resumo } = await resolveProcesso(params.codigoMateria, baseUrl);
          const { value: detalheRes, fetchedAt } = await cachedFetchWithMeta(
            "senado_tramitacao_materia",
            { idProcesso: resumo.id },
            CACHE_DYNAMIC,
            () => upstreamFetch(`/processo/${resumo.id}`, {}, baseUrl),
          );
          const todas = parseInformesTramitacao(detalheRes as any);
          const limite = params.limite ?? 100;
          const tramitacoes = todas.length > limite ? todas.slice(-limite) : todas;
          const prov = provenanceFor("SENADO_LEGIS", baseUrl, `/processo/${resumo.id}`, {
            dataset_id: `codigoMateria=${params.codigoMateria}`,
            reference_period: todas[todas.length - 1]?.data || undefined,
            retrieved_at: fetchedAt,
          });
          return resultWithProvenance({
            codigoMateria: params.codigoMateria,
            secao,
            idProcesso: resumo.id,
            count: tramitacoes.length,
            total: todas.length,
            ...(todas.length > limite ? { aviso: `Exibindo os ${limite} eventos mais recentes de ${todas.length}.` } : {}),
            tramitacoes,
          }, prov);
        }

        if (secao === "textos") {
          const { value: response, fetchedAt } = await cachedFetchWithMeta(
            "senado_textos_materia",
            { codigo: params.codigoMateria },
            CACHE_ON_DEMAND,
            () => upstreamFetch("/processo/documento", { codigoMateria: String(params.codigoMateria) }, baseUrl),
          );
          const todos = ensureArray(response)
            .map(parseDocumentoProcesso)
            .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
          const limite = params.limite ?? 50;
          const textos = todos.slice(0, limite);
          const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/processo/documento", {
            dataset_id: `codigoMateria=${params.codigoMateria}`,
            reference_period: todos[0]?.data || undefined,
            retrieved_at: fetchedAt,
          });
          return resultWithProvenance({
            codigoMateria: params.codigoMateria,
            secao,
            count: textos.length,
            total: todos.length,
            ...(todos.length > limite ? { aviso: `Exibindo ${limite} de ${todos.length} documentos.` } : {}),
            textos,
          }, prov);
        }

        // secao === "detalhe" (padrão) — funde 3 endpoints numa só resposta, então a
        // proveniência ganha granularidade por-campo (field_sources): a fonte de topo é o
        // detalhe (/processo/{id}); a `ementa` vem do resumo (/processo) e o `relator` da
        // relatoria (/processo/relatoria), cada um com o seu retrieved_at real.
        const [resumoRes, relatoriasRes] = await Promise.all([
          resolveProcesso(params.codigoMateria, baseUrl),
          cachedFetchWithMeta(
            "_processo_relatoria",
            { codigoMateria: params.codigoMateria },
            CACHE_ON_DEMAND,
            () => upstreamFetch("/processo/relatoria", { codigoMateria: String(params.codigoMateria) }, baseUrl),
          ).catch(() => null),
        ]);
        const resumo = resumoRes.item;
        const { value: detalheRes, fetchedAt } = await cachedFetchWithMeta(
          "senado_obter_materia",
          { idProcesso: resumo.id },
          CACHE_ON_DEMAND,
          () => upstreamFetch(`/processo/${resumo.id}`, {}, baseUrl),
        );
        const detalhe = parseProcessoDetalhe(detalheRes as any);
        const relator = pickRelatorAtual(ensureArray(relatoriasRes?.value));
        const base = baseUrl.replace(/\/$/, "");
        const dataset_id = `codigoMateria=${params.codigoMateria}`;
        const fieldSources: FieldSource[] = [
          { fields: ["ementa"], source_url: `${base}/processo`, dataset_id, retrieved_at: resumoRes.fetchedAt },
        ];
        if (relator) {
          fieldSources.push({
            fields: ["relator"],
            source_url: `${base}/processo/relatoria`,
            dataset_id,
            retrieved_at: relatoriasRes?.fetchedAt,
          });
        }
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, `/processo/${resumo.id}`, {
          dataset_id,
          reference_period: detalhe.dataApresentacao || (detalhe.ano ? String(detalhe.ano) : undefined),
          retrieved_at: fetchedAt,
          field_sources: fieldSources,
        });
        return resultWithProvenance({
          ...detalhe,
          secao,
          ementa: resumo.ementa || null,
          relator,
        }, prov);
      } catch (e) {
        return errorFrom(e, "Matéria não encontrada");
      }
    },
  );

  // senado_votos_materia is in votacoes.ts (Group D) as D4
}
