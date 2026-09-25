/**
 * Group D — Votes (3 tools)
 * senado_obter_votacao, senado_votos_materia, senado_search_votacoes
 *
 * Todos usam o endpoint /votacao (API nova, camelCase, datas ISO), exceto votos_materia
 * que faz a ponte por codigoMateria. search_votacoes absorve o que eram listar_votacoes
 * (janela por ano/mês via dataInicio/dataFim) e votacoes_recentes (parâmetro `dias`).
 */

import type { SenadoToolHost } from "../tool-host.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolError, errorFrom, buildParams, ensureArray } from "../utils/validation.js";
import { computarPlacar } from "../utils/placar.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
import { CACHE_ON_DEMAND } from "../types.js";

/** Convert YYYYMMDD → YYYY-MM-DD (required by /votacao endpoint). */
export function toISODate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** Format Date as YYYY-MM-DD. */
export function formatISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Last day of a month. */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Single-letter result codes returned by /votacao (OBS-4). */
export const RESULTADO_VOTACAO: Record<string, string> = {
  A: "Aprovada",
  R: "Rejeitada",
  P: "Prejudicada",
};

/**
 * Expand the raw `resultadoVotacao` code into a human/LLM-friendly label (OBS-4),
 * keeping the raw code in `resultadoCodigo`. Unknown codes (or already-expanded
 * text) pass through unchanged as `resultado`.
 */
export function expandirResultado(code: any): { resultado: string | null; resultadoCodigo: string | null } {
  if (code == null || code === "") return { resultado: null, resultadoCodigo: null };
  const raw = String(code).trim();
  return { resultado: RESULTADO_VOTACAO[raw.toUpperCase()] ?? raw, resultadoCodigo: raw };
}

/** Parse a single vote item from the /votacao endpoint (flat camelCase). */
export function parseVotacaoItem(v: any, includeVotos = false) {
  const votosRaw = Array.isArray(v.votos) ? v.votos : [];
  let totalSim = v.totalVotosSim ?? null;
  let totalNao = v.totalVotosNao ?? null;
  let totalAbstencao = v.totalVotosAbstencao ?? null;
  let placarComputado = false;
  // Open roll calls return null totals but still carry votos[]; recompute the tally
  // (counting only Sim/Nao/Abstencao and excluding non-vote codes like P-NRV/AP/LS).
  if (totalSim == null && totalNao == null && totalAbstencao == null && votosRaw.length > 0) {
    const placar = computarPlacar(votosRaw);
    totalSim = placar.sim;
    totalNao = placar.nao;
    totalAbstencao = placar.abstencao;
    placarComputado = true;
  }
  const { resultado, resultadoCodigo } = expandirResultado(v.resultadoVotacao);
  const result: any = {
    codigoSessao: v.codigoSessao || null,
    codigoVotacao: v.codigoSessaoVotacao || null,
    data: v.dataSessao ? v.dataSessao.split("T")[0] : "",
    materia: v.identificacao || (v.sigla ? `${v.sigla} ${v.numero}/${v.ano}` : null),
    codigoMateria: v.codigoMateria || null,
    ementa: v.ementa || null,
    descricao: v.descricaoVotacao || null,
    resultado,
    resultadoCodigo,
    totalSim,
    totalNao,
    totalAbstencao,
    ...(placarComputado ? { placarComputado: true } : {}),
    secreta: v.votacaoSecreta === "S",
  };
  if (includeVotos && votosRaw.length > 0) {
    result.votos = votosRaw.map((vt: any) => ({
      codigoSenador: vt.codigoParlamentar || 0,
      nomeSenador: vt.nomeParlamentar || "",
      partido: vt.siglaPartidoParlamentar || null,
      uf: vt.siglaUFParlamentar || null,
      voto: vt.descricaoVotoParlamentar || vt.siglaVotoParlamentar || "",
    }));
  }
  return result;
}

/**
 * Os DOIS espaços de numeração que o item de `/votacao` carrega ao mesmo tempo.
 *
 * | campo da fonte        | exemplo  | o que é                          |
 * |-----------------------|----------|----------------------------------|
 * | `codigoSessao`        | 581816   | a sessão plenária (6 dígitos)    |
 * | `codigoSessaoVotacao` | 7101     | a votação dentro dela (4 dígitos)|
 *
 * `/votacao` só filtra pelo primeiro: medido em 24/09/2026,
 * `?codigoSessao=581816` devolve 3 votações e 81 votos nominais, enquanto
 * `?codigoSessao=7101` devolve `[]`. E a fonte **ignora filtro desconhecido**
 * em vez de recusá-lo — `?codigoSessaoVotacao=7101` devolve a base inteira
 * (1,77 MB) —, então não existe filtro server-side pelo código da votação:
 * resolver é do nosso lado ([[esquema-que-nao-recusa-responde-outra-pergunta]]).
 */
export const CAMPO_SESSAO = "codigoSessao";
export const CAMPO_VOTACAO = "codigoSessaoVotacao";

/**
 * Acha, numa lista crua de `/votacao`, o item cujo `codigoSessaoVotacao` é
 * `codigo`. Devolve `undefined` quando não está na janela.
 *
 * Existe separada do handler para a guarda poder exercitá-la sem montar URL —
 * o conferidor não pode reusar o caminho do defeito
 * ([[guarda-que-reusa-o-padrao-do-defeito]]).
 */
export function acharPorCodigoVotacao(lista: unknown, codigo: number): any | undefined {
  return ensureArray(lista).find((v: any) => {
    const bruto = v?.[CAMPO_VOTACAO];
    if (bruto === null || bruto === undefined || bruto === "") return false;
    return Number(bruto) === codigo;
  });
}

export function registerVotacoesTools(server: SenadoToolHost, baseUrl: string) {
  // D3. senado_obter_votacao
  server.tool(
    "senado_obter_votacao",
    "Obtém detalhes de uma votação de **plenário**, incluindo votos nominais. `codigoVotacao` aceita OS DOIS códigos que a fonte publica para a mesma votação: o `codigoVotacao` de 4 dígitos (ex.: 7101 — o que `senado_search_votacoes` e `senado_votacoes_senador` devolvem nesse campo) ou o `codigoSessao` de 6 dígitos da sessão plenária (ex.: 581816). Com o código da votação retorna aquela votação; com o da sessão retorna `{ codigoSessao, count, votacoes }` com todas as votações da sessão. Cada votação traz placar, `resultado` legível + `resultadoCodigo` bruto, `secreta` e `votos[]` (`codigoSenador`, `nomeSenador`, `partido`, `uf`, `voto`). Resolver o código de 4 dígitos exige varrer uma janela temporal: por padrão a janela recente da fonte (~12 meses); para votação mais antiga informe `ano`. Código que não existe em nenhum dos dois espaços retorna erro — nunca lista vazia. Atenção: códigos de `senado_votacao_comissao` e o `codigoVotacao` de `senado_orientacao_bancada` pertencem a OUTROS espaços de numeração e não são válidos aqui.",
    {
      codigoVotacao: z.number().int().positive().describe("Código da votação (4 dígitos, ex. 7101) OU o codigoSessao da sessão plenária (6 dígitos, ex. 581816) — os dois são aceitos"),
      ano: z.number().int().min(1990).max(2100).optional().describe("Só para código de votação de 4 dígitos ANTERIOR aos últimos ~12 meses: o ano em que a votação ocorreu, para abrir a janela de busca"),
    },
    async (params) => {
      try {
        const codigo = params.codigoVotacao;
        // PASSO 1 — tentar como codigoSessao, o ÚNICO filtro que a fonte honra.
        const qp = { [CAMPO_SESSAO]: String(codigo) };
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_obter_votacao",
          { codigo },
          CACHE_ON_DEMAND,
          () => upstreamFetch("/votacao", qp, baseUrl),
        );
        const votacoes = ensureArray(response).map((v: any) => parseVotacaoItem(v, true));
        if (votacoes.length > 0) {
          const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/votacao", {
            dataset_id: `${CAMPO_SESSAO}=${codigo}`,
            reference_period: votacoes[0]?.data || undefined,
            retrieved_at: fetchedAt,
          });
          if (votacoes.length === 1) return resultWithProvenance(votacoes[0], prov);
          return resultWithProvenance({ codigoSessao: codigo, count: votacoes.length, votacoes }, prov);
        }

        // PASSO 2 — vazio não é resposta: o número pode ser do OUTRO espaço.
        // Até 24/09/2026 o handler paravaaqui e devolvia `{count: 0}` — para
        // 7101, que é a votação do PLP 124/2022 com 69 Sim. Pior que zero
        // calado: indistinguível do zero de um id inventado.
        const janela: Record<string, string> = params.ano
          ? { dataInicio: `${params.ano}-01-01`, dataFim: `${params.ano}-12-31` }
          : {};
        const { value: cru, fetchedAt: fetchedAtJanela } = await cachedFetchWithMeta(
          "senado_obter_votacao_janela",
          janela,
          CACHE_ON_DEMAND,
          () => upstreamFetch("/votacao", janela, baseUrl),
        );
        const achado = acharPorCodigoVotacao(cru, codigo);
        if (achado) {
          const votacao = parseVotacaoItem(achado, true);
          return resultWithProvenance(
            votacao,
            provenanceFor("SENADO_LEGIS", baseUrl, "/votacao", {
              dataset_id: `${CAMPO_VOTACAO}=${codigo}`,
              reference_period: votacao.data || undefined,
              retrieved_at: fetchedAtJanela,
            }),
          );
        }

        // PASSO 3 — não está em nenhum dos dois espaços: ausência TIPADA.
        const ondeProcurou = params.ano
          ? `no ano ${params.ano}`
          : "na janela recente da fonte (~12 meses)";
        return toolError(
          `Não existe votação de plenário com o código ${codigo}: ele não é ` +
            `codigoSessao de nenhuma sessão nem codigoVotacao ${ondeProcurou}.` +
            (params.ano
              ? " Confira o ano e o código em senado_search_votacoes."
              : " Se a votação é anterior, informe o `ano`; ou obtenha o código em" +
                " senado_search_votacoes. O `codigoVotacao` de senado_orientacao_bancada" +
                " pertence a outro espaço de numeração e não é aceito aqui."),
        );
      } catch (e) {
        return errorFrom(e, "Votação não encontrada");
      }
    },
  );

  // D4. senado_votos_materia (migrated to v3 /votacao?codigoMateria — legacy endpoint deprecated)
  server.tool(
    "senado_votos_materia",
    "Obtém as votações de uma matéria pelo `codigoMateria`. Retorna `{ codigoMateria, count, votacoes }`, cada item com `data`, `descricao`, `resultado` e placar (`totalSim`/`totalNao`/`totalAbstencao`); com `incluirVotos: true` (padrão false) acrescenta `votos[]` (nome, partido, uf e voto de cada senador). Obtenha o `codigoMateria` via `senado_buscar_materias` ou `senado_obter_materia`.",
    {
      codigoMateria: z.number().int().positive().describe("Código único da matéria"),
      incluirVotos: z.boolean().optional().default(false).describe("Incluir votos nominais de cada senador"),
    },
    async (params) => {
      try {
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_votos_materia",
          { codigo: params.codigoMateria },
          CACHE_ON_DEMAND,
          () => upstreamFetch("/votacao", { codigoMateria: String(params.codigoMateria) }, baseUrl),
        );
        const votacoes = ensureArray(response).map((v: any) =>
          parseVotacaoItem(v, params.incluirVotos ?? false),
        );
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/votacao", {
          dataset_id: `codigoMateria=${params.codigoMateria}`,
          reference_period: votacoes[0]?.data || undefined,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance(
          { codigoMateria: params.codigoMateria, count: votacoes.length, votacoes },
          prov,
        );
      } catch (e) {
        return errorFrom(e, "Erro ao obter votações da matéria");
      }
    },
  );

  // D5. senado_search_votacoes (GET /votacao — busca/listagem flexível do plenário)
  server.tool(
    "senado_search_votacoes",
    "Busca e lista votações do plenário combinando critérios opcionais. Janela temporal: informe `dias` (últimos N dias, 1-365) para atividade recente, OU `dataInicio`/`dataFim` (YYYYMMDD) para um período arbitrário — para um ano inteiro use `dataInicio: \"AAAA0101\"` e `dataFim: \"AAAA1231\"`. Demais filtros: `idProcesso`, `codigoMateria`, `sigla`/`numero`/`ano` da matéria, `codigoParlamentar` e `siglaVotoParlamentar`. Retorna `{ count, votacoes }` ordenadas da mais recente para a mais antiga; cada item traz `codigoSessao`, `data`, `materia`, `codigoMateria`, `resultado` e placar (`totalSim`/`totalNao`/`totalAbstencao`), sem votos nominais. Use `senado_obter_votacao` com o `codigoSessao` para os votos de cada senador.",
    {
      dias: z.number().int().min(1).max(365).optional().describe("Janela: votações dos últimos N dias (ignorado se dataInicio/dataFim forem informados)"),
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim (YYYYMMDD)"),
      idProcesso: z.number().int().optional().describe("ID do processo legislativo"),
      codigoMateria: z.number().int().optional().describe("Código da matéria"),
      sigla: z.string().optional().describe("Sigla do tipo de matéria"),
      numero: z.number().int().optional().describe("Número da matéria"),
      ano: z.number().int().optional().describe("Ano da matéria"),
      codigoParlamentar: z.number().int().optional().describe("Código do parlamentar"),
      siglaVotoParlamentar: z.string().optional().describe("Tipo de voto do parlamentar"),
    },
    async (params) => {
      try {
        let di = params.dataInicio ? toISODate(params.dataInicio) : undefined;
        let df = params.dataFim ? toISODate(params.dataFim) : undefined;
        if (params.dias && !di && !df) {
          const hoje = new Date();
          const inicio = new Date(hoje);
          inicio.setDate(inicio.getDate() - params.dias);
          di = formatISO(inicio);
          df = formatISO(hoje);
        }
        const qp = buildParams({
          dataInicio: di,
          dataFim: df,
          idProcesso: params.idProcesso,
          codigoMateria: params.codigoMateria,
          sigla: params.sigla,
          numero: params.numero,
          ano: params.ano,
          codigoParlamentar: params.codigoParlamentar,
          siglaVotoParlamentar: params.siglaVotoParlamentar,
        });
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_search_votacoes",
          qp,
          CACHE_ON_DEMAND,
          () => upstreamFetch("/votacao", qp, baseUrl),
        );
        const votacoes = ensureArray(response)
          .map((v: any) => parseVotacaoItem(v))
          .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/votacao", {
          reference_period: di && df ? `${di}/${df}` : di || df || undefined,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({ count: votacoes.length, votacoes }, prov);
      } catch (e) {
        return errorFrom(e, "Erro na busca de votações");
      }
    },
  );
}
