/**
 * Group E — Committees (8 tools)
 * senado_listar_comissoes, senado_obter_comissao, senado_membros_comissao,
 * senado_reunioes_comissao, senado_agenda_comissoes, senado_reuniao_comissao,
 * senado_requerimentos_cpi, senado_distribuicao_materias
 *
 * Endpoints:
 *   /comissao/lista/colegiados  — list all active committees
 *   /comissao/{codigo}          — committee detail (numeric code, not sigla)
 *   /composicao/comissao/{codigo} — committee members
 *   /comissao/agenda/{data}     — agenda for a single date
 *   /comissao/agenda/{dataInicio}/{dataFim} — agenda for date range
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, toolError, errorFrom, ensureArray } from "../utils/validation.js";
import { CACHE_SEMI_STATIC, CACHE_DYNAMIC, CACHE_ON_DEMAND, UPSTREAM_TIMEOUT_MS } from "../types.js";

export function formatDateYMD(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** Resolve a committee sigla to its numeric code via the list endpoint. */
export async function resolveComissaoCodigo(sigla: string, baseUrl: string): Promise<number | null> {
  const response = await cachedFetch("senado_listar_comissoes", {}, CACHE_SEMI_STATIC, () =>
    upstreamFetch("/comissao/lista/colegiados", {}, baseUrl),
  );
  const r = response as any;
  const comissoes = ensureArray(r?.ListaColegiados?.Colegiados?.Colegiado);
  const upper = sigla.toUpperCase();
  const match = comissoes.find((c: any) => (c.Sigla || "").toUpperCase() === upper);
  return match ? parseInt(match.Codigo || "0") : null;
}

export function registerComissoesTools(server: McpServer, baseUrl: string) {
  // E1. senado_listar_comissoes
  server.tool(
    "senado_listar_comissoes",
    "Lista comissões do Senado. Pode filtrar por tipo (permanente, temporária, CPI, mista) e status (ativa/inativa).",
    {
      tipo: z.enum(["permanente", "temporaria", "cpi", "mista"]).optional().describe("Tipo: permanente, temporaria, cpi, mista"),
      ativa: z.boolean().optional().describe("Apenas comissões ativas"),
    },
    async (params) => {
      try {
        const response = await cachedFetch("senado_listar_comissoes", {}, CACHE_SEMI_STATIC, () =>
          upstreamFetch("/comissao/lista/colegiados", {}, baseUrl),
        );
        const r = response as any;
        let comissoes = ensureArray(
          r?.ListaColegiados?.Colegiados?.Colegiado,
        ).map((c: any) => ({
          codigo: parseInt(c.Codigo || "0"),
          sigla: c.Sigla || "",
          nome: c.Nome || "",
          tipo: c.DescricaoTipoColegiado || null,
          casa: c.SiglaCasa || null,
          ativa: true, // this endpoint only returns active committees
        }));
        if (params.tipo) {
          const tipoMap: Record<string, string[]> = {
            permanente: ["permanente"],
            temporaria: ["temporária", "temporaria"],
            cpi: ["cpi", "comissão parlamentar de inquérito"],
            mista: ["mista"],
          };
          const valid = tipoMap[params.tipo] || [];
          comissoes = comissoes.filter((c) => c.tipo && valid.some((t) => c.tipo!.toLowerCase().includes(t)));
        }
        if (params.ativa === false) {
          comissoes = []; // this endpoint only returns active ones
        }
        return toolResult({ count: comissoes.length, comissoes });
      } catch (e) {
        return errorFrom(e, "Erro ao listar comissões");
      }
    },
  );

  // E2. senado_obter_comissao
  server.tool(
    "senado_obter_comissao",
    "Obtém detalhes de uma comissão, incluindo presidente, vice-presidente e finalidade.",
    {
      sigla: z.string().min(2).describe("Sigla da comissão (ex: CCJ, CAE)"),
    },
    async (params) => {
      try {
        const sigla = params.sigla.toUpperCase();
        const codigo = await resolveComissaoCodigo(sigla, baseUrl);
        if (!codigo) return toolError(`Comissão com sigla "${sigla}" não encontrada.`);

        const response = await cachedFetch("senado_obter_comissao", { codigo }, CACHE_SEMI_STATIC, () =>
          upstreamFetch(`/comissao/${codigo}`, {}, baseUrl),
        );
        const r = response as any;
        const colegiado = ensureArray(
          r?.ComissoesCongressoNacional?.Colegiados?.Colegiado,
        )[0];
        if (!colegiado) return toolError("Dados da comissão não encontrados.");

        const cargos = ensureArray(colegiado.Cargos?.Cargo);
        const presidente = cargos.find((c: any) => c.TipoCargo === "PRESIDENTE");
        const vicePresidente = cargos.find((c: any) => c.TipoCargo === "VICE-PRESIDENTE");

        return toolResult({
          codigo: parseInt(colegiado.CodigoColegiado || "0"),
          sigla: colegiado.SiglaColegiado || sigla,
          nome: colegiado.NomeColegiado || "",
          finalidade: colegiado.Finalidade || null,
          presidente: presidente
            ? { nome: presidente.NomeParlamentar || "", codigo: parseInt(presidente.CodigoParlamentar || "0"), bancada: presidente.Bancada || null }
            : null,
          vicePresidente: vicePresidente
            ? { nome: vicePresidente.NomeParlamentar || "", codigo: parseInt(vicePresidente.CodigoParlamentar || "0"), bancada: vicePresidente.Bancada || null }
            : null,
          totalMembros: parseInt(colegiado.QuantidadesMembros?.Distribuicao?.Senadores || "0") || null,
          titulares: parseInt(colegiado.QuantidadesMembros?.Distribuicao?.SenadoresTitulares || "0") || null,
          suplentes: parseInt(colegiado.QuantidadesMembros?.Distribuicao?.SenadoresSuplentes || "0") || null,
        });
      } catch (e) {
        return errorFrom(e, "Comissão não encontrada");
      }
    },
  );

  // E3. senado_membros_comissao
  server.tool(
    "senado_membros_comissao",
    "Lista membros atuais de uma comissão, incluindo cargo (presidente, vice, titular, suplente).",
    {
      sigla: z.string().min(2).describe("Sigla da comissão"),
    },
    async (params) => {
      try {
        const sigla = params.sigla.toUpperCase();
        const codigo = await resolveComissaoCodigo(sigla, baseUrl);
        if (!codigo) return toolError(`Comissão com sigla "${sigla}" não encontrada.`);

        const response = await cachedFetch("senado_membros_comissao", { codigo }, CACHE_SEMI_STATIC, () =>
          upstreamFetch(`/composicao/comissao/${codigo}`, {}, baseUrl),
        );
        const r = response as any;
        const membros = ensureArray(
          r?.UltimaComposicaoComissaoSf?.ComposicaoComissao?.Membros?.Membro,
        ).map((m: any) => ({
          codigo: parseInt(m.CodigoParlamentar || "0"),
          nome: m.NomeMembro || "",
          tipoVaga: m.TipoVaga || null,
          ativo: m.IndicadorVagaAtiva === "Sim",
          dataInicio: m.DataInicioMembroVaga || null,
        }));
        return toolResult({ sigla, count: membros.length, membros });
      } catch (e) {
        return errorFrom(e, "Erro ao obter membros da comissão");
      }
    },
  );

  // E4. senado_reunioes_comissao
  server.tool(
    "senado_reunioes_comissao",
    "Lista reuniões agendadas ou realizadas de uma comissão, com data, hora, local e pauta.",
    {
      sigla: z.string().min(2).describe("Sigla da comissão"),
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim (YYYYMMDD)"),
    },
    async (params) => {
      try {
        const sigla = params.sigla.toUpperCase();
        // Default to last 30 days if no dates provided
        const hoje = new Date();
        const inicio30 = new Date(hoje);
        inicio30.setDate(inicio30.getDate() - 30);
        const di = params.dataInicio || formatDateYMD(inicio30);
        const df = params.dataFim || formatDateYMD(hoje);

        // The /comissao/agenda endpoint doesn't support cross-year ranges.
        // Split into per-year requests if needed.
        const yearDi = parseInt(di.slice(0, 4));
        const yearDf = parseInt(df.slice(0, 4));
        let todas: any[] = [];
        if (yearDi === yearDf) {
          const response = await cachedFetch(
            "senado_reunioes_comissao",
            { sigla, dataInicio: di, dataFim: df },
            CACHE_DYNAMIC,
            () => upstreamFetch(`/comissao/agenda/${di}/${df}`, {}, baseUrl),
          );
          todas = ensureArray((response as any)?.AgendaReuniao?.reunioes?.reuniao);
        } else {
          // Split: [di..yearDi-12-31] + [yearDf-01-01..df]
          const r1 = await cachedFetch(
            "senado_reunioes_comissao_p1",
            { sigla, dataInicio: di, dataFim: `${yearDi}1231` },
            CACHE_DYNAMIC,
            () => upstreamFetch(`/comissao/agenda/${di}/${yearDi}1231`, {}, baseUrl),
          );
          const r2 = await cachedFetch(
            "senado_reunioes_comissao_p2",
            { sigla, dataInicio: `${yearDf}0101`, dataFim: df },
            CACHE_DYNAMIC,
            () => upstreamFetch(`/comissao/agenda/${yearDf}0101/${df}`, {}, baseUrl),
          );
          todas = [
            ...ensureArray((r1 as any)?.AgendaReuniao?.reunioes?.reuniao),
            ...ensureArray((r2 as any)?.AgendaReuniao?.reunioes?.reuniao),
          ];
        }
        const reunioes = todas
          .filter((re: any) => {
            const s = re.colegiadoCriador?.sigla || "";
            return s.toUpperCase() === sigla;
          })
          .map((re: any) => ({
            codigo: parseInt(re.codigo || "0"),
            descricao: re.descricao || re.titulo || "",
            data: re.dataInicio ? re.dataInicio.split("T")[0] : "",
            hora: re.dataInicio ? re.dataInicio.split("T")[1]?.slice(0, 5) || null : null,
            local: re.local || null,
            tipo: re.tipo?.descricao || null,
            situacao: re.situacao || null,
          }));
        return toolResult({ sigla, periodo: { dataInicio: di, dataFim: df }, count: reunioes.length, reunioes });
      } catch (e) {
        return errorFrom(e, "Erro ao obter reuniões da comissão");
      }
    },
  );

  // E5. senado_agenda_comissoes
  server.tool(
    "senado_agenda_comissoes",
    "Obtém agenda de reuniões das comissões do Senado. Pode filtrar por data e comissão específica.",
    {
      data: z.string().regex(/^\d{8}$/).optional().describe("Data específica (YYYYMMDD)"),
      siglaComissao: z.string().min(2).optional().describe("Filtrar por comissão específica"),
    },
    async (params) => {
      try {
        const data = params.data || formatDateYMD(new Date());
        const response = await cachedFetch("senado_agenda_comissoes", { data }, CACHE_DYNAMIC, () =>
          upstreamFetch(`/comissao/agenda/${data}`, {}, baseUrl),
        );
        const r = response as any;
        let reunioes = ensureArray(r?.AgendaReuniao?.reunioes?.reuniao).map((re: any) => {
          const com = re.colegiadoCriador || {};
          return {
            codigo: parseInt(re.codigo || "0"),
            comissao: { sigla: com.sigla || "", nome: com.nome || "" },
            descricao: re.descricao || re.titulo || "",
            data: re.dataInicio ? re.dataInicio.split("T")[0] : "",
            hora: re.dataInicio ? re.dataInicio.split("T")[1]?.slice(0, 5) || null : null,
            local: re.local || null,
            tipo: re.tipo?.descricao || null,
            situacao: re.situacao || null,
          };
        });
        if (params.siglaComissao) {
          const s = params.siglaComissao.toUpperCase();
          reunioes = reunioes.filter((r: any) => r.comissao.sigla.toUpperCase() === s);
        }
        return toolResult({ data, siglaComissao: params.siglaComissao || null, count: reunioes.length, reunioes });
      } catch (e) {
        return errorFrom(e, "Erro ao obter agenda das comissões");
      }
    },
  );

  // E6. senado_reuniao_comissao
  server.tool(
    "senado_reuniao_comissao",
    "Detalhes de uma reunião de comissão: partes da pauta, itens apreciados, presidente, situação e links de pauta/resultado/ata. O código vem da agenda de comissões.",
    {
      codigoReuniao: z.number().int().positive().describe("Código da reunião (campo 'codigo' na agenda de comissões)"),
    },
    async (params) => {
      try {
        const response = await cachedFetch(
          "senado_reuniao_comissao",
          { codigo: params.codigoReuniao },
          CACHE_ON_DEMAND,
          () => upstreamFetch(`/comissao/reuniao/${params.codigoReuniao}`, {}, baseUrl),
        );
        const re = (response as any)?.DetalheReuniao?.reuniao ?? (response as any)?.reuniao ?? response;
        const com = re.colegiadoCriador || {};
        return toolResult({
          codigo: parseInt(re.codigo || "0"),
          titulo: re.titulo || re.descricao || null,
          comissao: { sigla: com.sigla || null, nome: com.nome || null, casa: com.siglaCasa || null },
          data: re.dataInicio ? String(re.dataInicio).split("T")[0] : null,
          hora: re.dataInicio ? String(re.dataInicio).split("T")[1]?.slice(0, 5) || null : null,
          local: re.local || null,
          situacao: re.situacao || null,
          realizada: re.realizada === "S" || re.realizada === true,
          secreta: re.secreta === "S" || re.secreta === true,
          presidente: re.presidente?.nome || re.presidente || null,
          urlPauta: re.urlUltimaPautaCheiaPublicada || re.urlUltimaPautaSimplesPublicada || null,
          urlResultado: re.urlUltimoResultadoPublicado || null,
          urlAta: re.urlUltimaAtaPublicada || null,
          partes: ensureArray(re.partes?.parte ?? re.partes).map((p: any) => ({
            parte: p.sequencialFormatado || null,
            titulo: p.nome || p.descricaoTipo || null,
            deliberativa: p.isDeliberativa === "true" || p.isDeliberativa === true,
            evento: p.evento ? {
              finalidade: p.evento.finalidade || null,
              resultado: p.evento.resultadoTexto || null,
              convidados: ensureArray(p.evento.convidados).map((c: any) => c.nome).filter(Boolean),
            } : undefined,
            itens: ensureArray(p.itens?.item ?? p.itens).map((i: any) => ({
              identificacao: i.nomeFormatado || i.identificacao || i.materia || null,
              ementa: i.ementa || null,
              relator: i.relator || i.nomeRelator || null,
              resultado: i.resultado || i.descricaoResultado || i.resultadoTexto || null,
            })),
          })),
        });
      } catch (e) {
        return errorFrom(e, "Reunião de comissão não encontrada");
      }
    },
  );

  // E7. senado_requerimentos_cpi
  // The upstream returns HTTP 200 with an empty body when a CPI has no
  // requerimentos, which upstreamFetch treats as an error — so this tool
  // fetches directly and maps empty to an empty list.
  server.tool(
    "senado_requerimentos_cpi",
    "Lista requerimentos de uma CPI (Comissão Parlamentar de Inquérito) em atividade, paginados. Use senado_listar_comissoes com tipo=cpi para descobrir as siglas.",
    {
      siglaCpi: z.string().min(3).describe("Sigla da CPI (ex: CPIVD, CPIPED)"),
      pagina: z.number().int().min(0).optional().default(0).describe("Página da lista (padrão: 0)"),
    },
    async (params) => {
      try {
        const sigla = params.siglaCpi.toUpperCase();
        const pagina = params.pagina ?? 0;
        const requerimentos = await cachedFetch(
          "senado_requerimentos_cpi",
          { sigla, pagina },
          CACHE_DYNAMIC,
          async () => {
            const url = `${baseUrl}/comissao/cpi/${sigla}/requerimentos.json?pagina=${pagina}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
            try {
              const resp = await fetch(url, {
                headers: { Accept: "application/json", "User-Agent": "senado-br-mcp/2.2.0" },
                signal: controller.signal,
              });
              clearTimeout(timeout);
              if (!resp.ok) {
                const body = await resp.text();
                const detail = (() => { try { return JSON.parse(body)?.detail; } catch { return null; } })();
                throw new Error(detail || `Upstream retornou HTTP ${resp.status} para requerimentos da ${sigla}`);
              }
              const text = await resp.text();
              if (!text.trim()) return [];
              const data = JSON.parse(text);
              if (Array.isArray(data)) return data;
              for (const v of Object.values(data as Record<string, unknown>)) {
                if (Array.isArray(v)) return v;
                if (v && typeof v === "object") {
                  for (const v2 of Object.values(v as Record<string, unknown>)) {
                    if (Array.isArray(v2)) return v2;
                  }
                }
              }
              return [data];
            } catch (e) {
              clearTimeout(timeout);
              if ((e as Error).name === "AbortError") {
                throw new Error(`Timeout ao obter requerimentos da ${sigla}`);
              }
              throw e;
            }
          },
        );
        return toolResult({
          siglaCpi: sigla,
          pagina,
          count: (requerimentos as any[]).length,
          requerimentos,
        });
      } catch (e) {
        return errorFrom(e, "Erro ao obter requerimentos da CPI");
      }
    },
  );

  // E8. senado_distribuicao_materias
  server.tool(
    "senado_distribuicao_materias",
    "Estatísticas de distribuição de matérias numa comissão: quantas matérias cada parlamentar tem como autor (autoria) ou como relator (relatoria). Útil para medir carga de trabalho legislativo.",
    {
      siglaComissao: z.string().min(2).describe("Sigla da comissão (ex: CCJ, CAE)"),
      tipo: z.enum(["autoria", "relatoria"]).optional().default("autoria").describe("autoria = matérias de autoria por parlamentar (padrão); relatoria = matérias relatadas"),
      codigoParlamentar: z.number().int().optional().describe("Filtrar por parlamentar (apenas tipo=autoria)"),
    },
    async (params) => {
      try {
        const sigla = params.siglaComissao.toUpperCase();
        const tipo = params.tipo ?? "autoria";
        let parlamentares: any[];
        if (tipo === "autoria") {
          const qp: Record<string, string> = { siglaComissao: sigla };
          if (params.codigoParlamentar) qp.codParlamentar = String(params.codigoParlamentar);
          const response = await cachedFetch(
            "senado_distribuicao_materias",
            { tipo, ...qp },
            CACHE_DYNAMIC,
            () => upstreamFetch("/materia/distribuicao/autoria", qp, baseUrl),
          );
          const r = response as any;
          const comissao = ensureArray(r?.ParlamentarcomMaterianaComissao?.Comissoes?.Comissao)[0];
          parlamentares = ensureArray((comissao as any)?.Parlamentares?.Parlamentar).map((p: any) => ({
            codigo: parseInt(p.Codigo || "0") || null,
            nome: p.Nome || "",
            partido: p.SiglaPartido || null,
            uf: typeof p.Uf === "string" ? p.Uf : (Array.isArray(p.Uf) ? p.Uf[0] : null),
            quantidade: parseInt(p.Quantidade || "0"),
          }));
        } else {
          const response = await cachedFetch(
            "senado_distribuicao_materias",
            { tipo, sigla },
            CACHE_DYNAMIC,
            () => upstreamFetch(`/materia/distribuicao/relatoria/${sigla}`, {}, baseUrl),
          );
          const r = response as any;
          parlamentares = ensureArray(r?.DistribuicaodeRelatoria?.Totais?.Parlamentares).map((p: any) => ({
            codigo: parseInt(p.CodigoParlamentar || "0") || null,
            nome: p.Parlamentar || "",
            partido: p.Partido || null,
            uf: typeof p.Uf === "string" ? p.Uf : (Array.isArray(p.Uf) ? p.Uf[0] : null),
            quantidade: parseInt(p.Quantidade || "0"),
          }));
        }
        parlamentares.sort((a, b) => b.quantidade - a.quantidade);
        return toolResult({
          siglaComissao: sigla,
          tipo,
          count: parlamentares.length,
          parlamentares,
        });
      } catch (e) {
        return errorFrom(e, "Erro ao obter distribuição de matérias");
      }
    },
  );
}
