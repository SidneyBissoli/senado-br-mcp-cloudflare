/**
 * Group P — Servidores / Gestão de Pessoas (4 tools)
 * senado_servidores, senado_remuneracoes_servidores, senado_horas_extras,
 * senado_pessoal_tabelas (funde os antigos quantitativos_pessoal + pessoal_listas)
 *
 * Consumes the ADMINISTRATIVE open data API. The remunerações dataset is
 * ~5.5 MB/month and the servidores lists are ~3 MB, so both use the raised
 * size guard and are filtered in-Worker.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { admFetch, admFetchLarge } from "../throttle/adm.js";
import { errorFrom, ensureArray, parseBRL } from "../utils/validation.js";
import { unwrapAdmEnvelope } from "../utils/upstream-parse.js";
import { provenanceFor, resultWithProvenance } from "../utils/provenance.js";
import {
  computarEstatisticas,
  arredondarEstatisticas,
  arredondarEntradas,
  type Estatisticas,
  type EstatisticasPorGrupo,
} from "../utils/estatisticas.js";
import { CACHE_SEMI_STATIC, CACHE_STATIC } from "../types.js";
import { matchesFiltro, matchesFiltroCampo } from "./contratacoes.js";
import { toolError } from "../utils/validation.js";
import {
  indiceEstrutura,
  provenanceEstrutura,
} from "./estrutura.js";
import {
  resolverOrgao,
  sugerirOrgaos,
  conjuntoCasamento,
  lotacaoNoConjunto,
  lotacaoReconhecida,
  casarLotacaoAproximado,
  ehLotacaoParlamentar,
  subarvore,
  ESTRUTURA_VINTAGE,
  type CasamentoAproximado,
} from "../estrutura/resolver.js";
import { withFieldSources } from "../utils/provenance.js";

/** Parse a civil-servant list item (snake_case). */
export function parseServidor(s: any) {
  return {
    nome: s.nome || "",
    vinculo: s.vinculo || null,
    situacao: s.situacao || null,
    cargo: s.cargo || null,
    especialidade: s.especialidade || null,
    funcao: s.funcao || null,
    lotacao: s.lotacao || null,
    categoria: s.categoria || null,
    cedido: s.cedido || null,
    anoAdmissao: s.ano_admissao ?? null,
  };
}

/** Sum the numeric fields of a remuneration item (gross composition). */
export function resumoRemuneracao(r: any) {
  // Values arrive as pt-BR strings ("41.441,26", "-2.777,41"); a plain Number() -> NaN -> 0.
  const num = (v: unknown) => parseBRL(v);
  return {
    nome: r.nome || "",
    tipoFolha: r.tipo_folha || null,
    remuneracaoBasica: num(r.remuneracao_basica),
    vantagensPessoais: num(r.vantagens_pessoais),
    funcaoComissionada: num(r.funcao_comissionada),
    gratificacaoNatalina: num(r.gratificacao_natalina),
    horasExtras: num(r.horas_extras),
    outrasEventuais: num(r.outras_eventuais),
    abonoPermanencia: num(r.abono_permanencia),
    diarias: num(r.diarias),
    auxilios: num(r.auxilios),
    bruto: Math.round((num(r.remuneracao_basica) + num(r.vantagens_pessoais) + num(r.funcao_comissionada) +
      num(r.gratificacao_natalina) + num(r.horas_extras) + num(r.outras_eventuais) + num(r.abono_permanencia)) * 100) / 100,
  };
}

/** The 7 columns that sum into `bruto` (identical composition to `resumoRemuneracao`). */
const COMPONENTES_BRUTO = [
  "remuneracaoBasica", "vantagensPessoais", "funcaoComissionada", "gratificacaoNatalina",
  "horasExtras", "outrasEventuais", "abonoPermanencia",
] as const;

/** Every numeric column carried through consolidation (summed line-by-line per servant). */
const COLUNAS_NUMERICAS = [
  ...COMPONENTES_BRUTO,
  "previdencia", "faltas", "diarias", "auxilios", "impostoRenda",
  "reversaoTetoConstitucional", "vantagensIndenizatorias", "liquida",
] as const;

export interface RemuneracaoNormalizada {
  sequencial: number | null;
  nome: string;
  tipoFolha: string | null;
  remuneracaoBasica: number;
  vantagensPessoais: number;
  funcaoComissionada: number;
  gratificacaoNatalina: number;
  horasExtras: number;
  outrasEventuais: number;
  abonoPermanencia: number;
  previdencia: number;
  faltas: number;
  diarias: number;
  auxilios: number;
  impostoRenda: number;
  reversaoTetoConstitucional: number;
  vantagensIndenizatorias: number;
  liquida: number;
  bruto: number;
}

const somaBruto = (rec: Pick<RemuneracaoNormalizada, (typeof COMPONENTES_BRUTO)[number]>) =>
  COMPONENTES_BRUTO.reduce((s, c) => s + rec[c], 0);

/**
 * Fully normalize a raw payroll row: every value column parsed to a number (pt-BR
 * strings), carrying `sequencial` (the servant's internal id, shared between the
 * Normal and Suplementar lines of the same person), `nome`, `tipoFolha`, plus the
 * derived `bruto` (sum of the 7 components) and native `liquida`. Unlike
 * `resumoRemuneracao` (kept lean for `modo=detalhe`), this feeds the statistics path,
 * so `bruto` is NOT rounded here — rounding for display happens at the final shape.
 */
export function normalizarRemuneracao(r: any): RemuneracaoNormalizada {
  const num = (v: unknown) => parseBRL(v);
  const rec = {
    sequencial: typeof r.sequencial === "number" ? r.sequencial : (r.sequencial != null ? Number(r.sequencial) : null),
    nome: r.nome || "",
    tipoFolha: r.tipo_folha || null,
    remuneracaoBasica: num(r.remuneracao_basica),
    vantagensPessoais: num(r.vantagens_pessoais),
    funcaoComissionada: num(r.funcao_comissionada),
    gratificacaoNatalina: num(r.gratificacao_natalina),
    horasExtras: num(r.horas_extras),
    outrasEventuais: num(r.outras_eventuais),
    abonoPermanencia: num(r.abono_permanencia),
    previdencia: num(r.previdencia),
    faltas: num(r.faltas),
    diarias: num(r.diarias),
    auxilios: num(r.auxilios),
    impostoRenda: num(r.imposto_renda),
    reversaoTetoConstitucional: num(r.reversao_teto_constitucional),
    vantagensIndenizatorias: num(r.vantagens_indenizatorias),
    liquida: num(r.remuneracao_liquida),
    bruto: 0,
  };
  rec.bruto = somaBruto(rec);
  return rec;
}

/**
 * Consolidate the month's rows by `sequencial`: the payroll carries ~2 rows per person
 * (Normal + Suplementar sharing the same id, and Suplementar can be negative — estornos),
 * so summing per servant nets those out before statistics. Grouping by NAME instead would
 * merge homonyms (~249 in a live month), hence sequencial. `tipoFolha` loses meaning after
 * the merge (marked "consolidado"); `bruto` is recomputed from the summed components (linear).
 * Rows with a missing `sequencial` are left un-merged (each keeps its own bucket).
 */
export function consolidarPorSequencial(normalizados: RemuneracaoNormalizada[]): RemuneracaoNormalizada[] {
  const porSeq = new Map<string, RemuneracaoNormalizada>();
  normalizados.forEach((rec, i) => {
    const chave = rec.sequencial != null ? `s${rec.sequencial}` : `l${i}`;
    const alvo = porSeq.get(chave);
    if (!alvo) {
      porSeq.set(chave, { ...rec, tipoFolha: "consolidado" });
    } else {
      for (const c of COLUNAS_NUMERICAS) alvo[c] += rec[c];
    }
  });
  for (const rec of porSeq.values()) rec.bruto = somaBruto(rec);
  return Array.from(porSeq.values());
}

/** Which numeric field the statistics run over, per the `campo` param (default `bruto`). */
const ACESSOR_CAMPO: Record<string, (r: RemuneracaoNormalizada) => number> = {
  bruto: (r) => r.bruto,
  liquida: (r) => r.liquida,
  remuneracaoBasica: (r) => r.remuneracaoBasica,
  vantagensPessoais: (r) => r.vantagensPessoais,
  funcaoComissionada: (r) => r.funcaoComissionada,
  gratificacaoNatalina: (r) => r.gratificacaoNatalina,
  horasExtras: (r) => r.horasExtras,
  outrasEventuais: (r) => r.outrasEventuais,
  abonoPermanencia: (r) => r.abonoPermanencia,
};

export const CAMPOS_ESTATISTICA = Object.keys(ACESSOR_CAMPO) as [string, ...string[]];

/** Human label for the analyzed column — responses use plain words, never the raw field name. */
const CAMPO_ROTULO: Record<string, string> = {
  bruto: "remuneração bruta",
  liquida: "remuneração líquida",
  remuneracaoBasica: "remuneração básica",
  vantagensPessoais: "vantagens pessoais",
  funcaoComissionada: "função comissionada",
  gratificacaoNatalina: "gratificação natalina",
  horasExtras: "horas extras",
  outrasEventuais: "outras verbas eventuais",
  abonoPermanencia: "abono de permanência",
};

/**
 * Build the `estatisticas=true` response for the payroll tool: normalize rows, optionally
 * consolidate per servant, then crunch the whole set through `computarEstatisticas` and
 * shape a compact block + top/bottom ranking. `agruparPor` forces per-line internally
 * (consolidation erases `tipoFolha`), overriding `consolidar`.
 */
export function estatisticasRemuneracoes(
  itens: any[],
  opts: { campo: string; consolidar: boolean; agruparPor?: "tipoFolha"; topN: number },
) {
  // agruparPor implies per-line: consolidation erases tipoFolha, so it can't coexist.
  const consolidar = opts.agruparPor ? false : opts.consolidar;
  const normalizados = itens.map(normalizarRemuneracao);
  const registros = consolidar ? consolidarPorSequencial(normalizados) : normalizados;
  const acessor = ACESSOR_CAMPO[opts.campo] ?? ACESSOR_CAMPO.bruto;
  const resultado = computarEstatisticas(registros as any, acessor as any, {
    topN: opts.topN,
    ...(opts.agruparPor ? { agruparPor: (r: any) => r.tipoFolha || "(sem tipo)" } : {}),
    // `idInternoFolha` is the payroll's internal row id (ex-`sequencial`): it only
    // disambiguates homonyms — it is NOT a public identifier and must never be cited
    // to the user as if it were one (see SERVER_INSTRUCTIONS).
    identificar: (r: any) => ({ idInternoFolha: r.sequencial ?? null, nome: r.nome }),
    desempate: (r: any) => (r.sequencial ?? Number.MAX_SAFE_INTEGER),
  });

  if (opts.agruparPor) {
    const porGrupo = resultado as EstatisticasPorGrupo;
    return {
      campoAnalisado: CAMPO_ROTULO[opts.campo] ?? opts.campo,
      consolidadoPorServidor: false,
      agrupadoPorRotulo: "tipo de folha",
      totalGrupos: porGrupo.totalGrupos,
      ...(porGrupo.aviso ? { aviso: porGrupo.aviso } : {}),
      grupos: porGrupo.grupos.map((g) => ({
        grupo: g.grupo,
        estatisticas: arredondarEstatisticas(g),
        top: arredondarEntradas(g.top),
        bottom: arredondarEntradas(g.bottom),
      })),
    };
  }

  const e = resultado as Estatisticas;
  return {
    campoAnalisado: CAMPO_ROTULO[opts.campo] ?? opts.campo,
    consolidadoPorServidor: consolidar,
    [consolidar ? "totalServidores" : "totalRegistros"]: e.n,
    estatisticas: arredondarEstatisticas(e),
    top: arredondarEntradas(e.top),
    bottom: arredondarEntradas(e.bottom),
  };
}

/**
 * Parse one horas-extras row (adm snake_case). `valorTotal` is a pt-BR string → number
 * (the canonical value column); `horasExtras` is the raw detail array (dia/quantidade/setor),
 * kept as-is and never used as the value.
 */
export function parseHoraExtra(h: any) {
  return {
    nome: h.nome || "",
    valorTotal: parseBRL(h.valorTotal), // pt-BR string -> number
    competencia: h.mes_ano_prestacao || null, // mês/ano em que a hora extra foi PRESTADA
    pagamento: h.mes_ano_pagamento || null, // mês/ano do PAGAMENTO (≈ o {ano}/{mes} pedido)
    horasExtras: h.horas_extras ?? null, // detalhe cru (dia/quantidade/setor) — nunca o valor
  };
}

/** Group-key extractor per `agruparPor`. Both keys vary within a single paid month (smoke-tested). */
const CHAVE_GRUPO_HORAS: Record<string, (h: any) => string> = {
  nome: (h) => h.nome || "(sem nome)",
  competencia: (h) => h.competencia || "(sem competência)",
};

/**
 * Build the `estatisticas=true` response for horas extras. The value column is the single money
 * field `valorTotal`, so there is no `campo` param. Without `agruparPor` it crunches the distribution
 * over individual paid lines (min/máx/média/mediana/desvio/percentis) + top/bottom ranking; with
 * `agruparPor` it ranks the groups by total paid desc (grupos[0] = quem mais recebeu), each carrying
 * its own mini-distribution. A servant may hold more than one line in a month (different competências
 * paid together), so `agruparPor:"nome"` is a real sum. No `desempate`: there is no stable numeric id,
 * and input order is deterministic.
 */
export function estatisticasHorasExtras(
  filtrado: any[],
  opts: { agruparPor?: "nome" | "competencia"; topN: number },
) {
  if (opts.agruparPor) {
    const resultado = computarEstatisticas(filtrado, (h: any) => h.valorTotal, {
      agruparPor: CHAVE_GRUPO_HORAS[opts.agruparPor],
      topN: 0, // groups already sorted by total desc = ranking; no per-group extremes
      maxGrupos: 50,
    }) as EstatisticasPorGrupo;
    return {
      agrupadoPorRotulo: opts.agruparPor === "nome" ? "servidor" : "mês de competência",
      totalGrupos: resultado.totalGrupos,
      ...(resultado.aviso ? { aviso: resultado.aviso } : {}),
      grupos: resultado.grupos.map((g) => ({ grupo: g.grupo, ...arredondarEstatisticas(g) })),
    };
  }

  const e = computarEstatisticas(filtrado, (h: any) => h.valorTotal, {
    topN: opts.topN,
    identificar: (h: any) => ({
      nome: h.nome ?? null,
      competencia: h.competencia ?? null,
      pagamento: h.pagamento ?? null,
    }),
  }) as Estatisticas;
  return {
    distribuicao: arredondarEstatisticas(e),
    top: arredondarEntradas(e.top),
    bottom: arredondarEntradas(e.bottom),
  };
}

/**
 * Particiona a lista de servidores contra a subárvore de uma unidade da estrutura organizacional.
 * `sob` = servidores cuja lotação casa com algum órgão da subárvore — pelo casamento EXATO
 * (sigla ou nome, semântica original) ou, em fallback, pelo APROXIMADO (sigla→extenso e prefixo
 * por token, p/ nomes truncados/abreviados do cadastro) quando ele é inequívoco (todos os
 * candidatos dentro da subárvore). `naoClassificados` = servidores cuja lotação NÃO casou com
 * nó algum (ou casou ambíguo — candidatos dentro E fora) E não é estrutura parlamentar
 * (gabinete/liderança/escritório) — podem ou não pertencer à unidade, então o total "sob" é um
 * piso. As lotações reconhecidas fora da subárvore e as parlamentares ficam fora sem virar ruído.
 */
export function particionarPorUnidade(
  lista: ReturnType<typeof parseServidor>[],
  indice: ReturnType<typeof indiceEstrutura>,
  codUnidade: number,
) {
  const conjunto = conjuntoCasamento(indice, codUnidade);
  const codsSubarvore = new Set(subarvore(indice, codUnidade).map((o) => o.cod));
  // O casamento aproximado varre a árvore inteira → memoiza por lotação (poucas distintas p/ ~7k servidores).
  const cacheAproximado = new Map<string, CasamentoAproximado | null>();
  const aproximado = (lot: { sigla?: string | null; nome?: string | null } | null) => {
    const chave = lot?.nome ?? "";
    let c = cacheAproximado.get(chave);
    if (c === undefined) {
      c = casarLotacaoAproximado(indice, lot);
      cacheAproximado.set(chave, c);
    }
    return c;
  };
  const sob: typeof lista = [];
  const porUnidade = new Map<string, number>();
  for (const s of lista) {
    const lot = s.lotacao as { sigla?: string | null; nome?: string | null } | null;
    if (lotacaoNoConjunto(conjunto, lot)) { sob.push(s); continue; } // exato, dentro
    if (lotacaoReconhecida(indice, lot)) continue; // exato, fora
    const casamento = aproximado(lot);
    if (casamento) {
      const dentro = casamento.orgaos.filter((o) => codsSubarvore.has(o.cod)).length;
      if (dentro === casamento.orgaos.length) { sob.push(s); continue; } // aproximado inequívoco, dentro
      if (dentro === 0) continue; // aproximado inequívoco, fora
      // ambíguo (candidatos dentro E fora): cai no não-classificado — não chutar.
    }
    if (ehLotacaoParlamentar(lot?.nome)) continue;
    const nm = (lot?.nome || "(sem lotação)").trim();
    porUnidade.set(nm, (porUnidade.get(nm) || 0) + 1);
  }
  const naoClassificadosTotal = [...porUnidade.values()].reduce((a, b) => a + b, 0);
  const amostraUnidades = [...porUnidade.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([nome, quantidade]) => ({ nome, quantidade }));
  return { sob, naoClassificados: { total: naoClassificadosTotal, amostraUnidades } };
}

export function registerServidoresTools(server: McpServer, admBaseUrl: string) {
  // P1. senado_servidores
  server.tool(
    "senado_servidores",
    "Lista servidores do Senado por `situacao` (ativos, efetivos, comissionados ou inativos), com filtros opcionais por `nome`, `lotacao` e `cargo`. Retorna `{ situacao, count, total, servidores[] }`, cada item com `nome`, `vinculo`, `situacao`, `cargo`, `funcao`, `lotacao`, `anoAdmissao` etc. Aplica `limite` (padrão 50, máx 500) e inclui `aviso` quando há truncamento — refine os filtros. **`subordinadasA`** (sigla ou nome de uma unidade, ex.: 'DGER') conta e lista TODOS os servidores de TODA a estrutura subordinada àquela unidade (não só a lotação direta): cruza a lotação de cada servidor com o organograma até o nível de serviço e devolve `{ subordinadasA, total (piso), servidores[], naoClassificados }` — use isto para 'quantas pessoas estão sob a Diretoria-Geral', pois filtrar `lotacao` pela sigla-mãe retorna 0 (os servidores ficam em serviços/núcleos subordinados). Para o organograma em si use `senado_estrutura_organizacional`; para remuneração use `senado_remuneracoes_servidores`.",
    {
      situacao: z.enum(["ativos", "efetivos", "comissionados", "inativos"]).optional().default("ativos").describe("Qual lista consultar (padrão: ativos)"),
      nome: z.string().optional().describe("Nome do servidor (busca parcial)"),
      lotacao: z.string().optional().describe("Lotação/setor imediato (busca parcial, ex: SEGRAF). Para toda a estrutura subordinada a uma diretoria/secretaria, use `subordinadasA`."),
      subordinadasA: z.string().optional().describe("Sigla ou nome de uma unidade (ex.: 'DGER', 'Diretoria-Geral'): conta/lista servidores de TODA a estrutura subordinada a ela (organograma até o nível de serviço), não só a lotação direta."),
      cargo: z.string().optional().describe("Cargo (busca parcial)"),
      limite: z.number().int().min(1).max(500).optional().default(50).describe("Máximo de resultados (padrão: 50)"),
    },
    async (params) => {
      try {
        const situacao = params.situacao ?? "ativos";
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_servidores",
          { situacao },
          CACHE_SEMI_STATIC,
          () => admFetchLarge(`/servidores/servidores/${situacao}`, {}, admBaseUrl),
        );
        let lista = ensureArray(response).map(parseServidor);
        if (params.nome) lista = lista.filter((s) => matchesFiltro(s.nome, params.nome!));
        // lotacao is {sigla,nome} and cargo is {nome} — match against the subfields.
        if (params.lotacao) lista = lista.filter((s) => matchesFiltroCampo(s.lotacao, params.lotacao!));
        if (params.cargo) lista = lista.filter((s) => matchesFiltroCampo(s.cargo, params.cargo!));
        const limite = params.limite ?? 50;
        const prov = provenanceFor("SENADO_ADM", admBaseUrl, `/api/v1/servidores/servidores/${situacao}`, {
          dataset_id: `servidores; situacao=${situacao}`, retrieved_at: fetchedAt,
        });

        // Filtro hierárquico: cruza a lotação de cada servidor com a subárvore da unidade pedida.
        if (params.subordinadasA) {
          const indice = indiceEstrutura();
          const alvo = resolverOrgao(indice, params.subordinadasA);
          if (!alvo) {
            const sugestoes = sugerirOrgaos(indice, params.subordinadasA);
            const dica = sugestoes.length
              ? ` Você quis dizer: ${sugestoes.map((s) => (s.sigla ? `${s.sigla} (${s.nome})` : s.nome)).join("; ")}?`
              : "";
            return toolError(`Unidade '${params.subordinadasA}' não encontrada na estrutura organizacional.${dica}`);
          }
          const { sob, naoClassificados } = particionarPorUnidade(lista, indice, alvo.cod);
          // A classificação cruza a folha (fonte administrativa) com o organograma (fonte institucional).
          const provComEstrutura = withFieldSources(prov, [
            {
              fields: ["subordinadasA", "total", "naoClassificados"],
              source_url: provenanceEstrutura().source_url,
              dataset_id: "estrutura-organizacional",
              retrieved_at: ESTRUTURA_VINTAGE,
            },
          ]);
          return resultWithProvenance({
            situacao,
            subordinadasA: { sigla: alvo.sigla, nome: alvo.nome },
            total: sob.length,
            count: Math.min(sob.length, limite),
            ...(sob.length > limite ? { aviso: `Exibindo ${limite} de ${sob.length} servidores sob ${alvo.sigla ?? alvo.nome}. Refine com nome/cargo.` } : {}),
            servidores: sob.slice(0, limite),
            naoClassificados: {
              total: naoClassificados.total,
              nota: `Servidores em unidades administrativas cujo nome não foi reconhecido no organograma publicado (estrutura de ${ESTRUTURA_VINTAGE.slice(0, 10)}); podem ou não pertencer a esta unidade e NÃO entram na contagem 'total', que é portanto um piso.`,
              amostraUnidades: naoClassificados.amostraUnidades,
            },
          }, provComEstrutura);
        }

        return resultWithProvenance({
          situacao,
          count: Math.min(lista.length, limite),
          total: lista.length,
          ...(lista.length > limite ? { aviso: `Exibindo ${limite} de ${lista.length} servidores. Refine os filtros.` } : {}),
          servidores: lista.slice(0, limite),
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao listar servidores");
      }
    },
  );

  // P2. senado_remuneracoes_servidores
  server.tool(
    "senado_remuneracoes_servidores",
    "Remunerações dos servidores do Senado em `ano`/`mes` de referência (a partir de 2013). Para perguntas de **maior/menor/média/mediana/ranking** ('quem ganhou mais em junho/2026', 'remuneração média') use `estatisticas=true`: computa min/máx/média/mediana/desvio/percentis sobre a folha INTEIRA e devolve `top`/`bottom` (padrão 10) identificados por `nome` (com `idInternoFolha` só para desambiguar homônimos, não para citar) — o modo `resumo`/`detalhe` só vê uma fatia e não acha o extremo real. Cada percentil vem com um `rotulo` legível e a coluna analisada tem rótulo legível em `campoAnalisado`. `campo` escolhe a verba analisada (padrão: remuneração bruta); `consolidarPorServidor` (padrão true) soma as linhas Normal+Suplementar da mesma pessoa antes das estatísticas; `agruparPor='tipoFolha'` devolve estatísticas por grupo (implica não-consolidado). Sem `estatisticas`: `modo=resumo` (padrão) retorna `{ ano, mes, totalRegistros, resumo[] }` agregado por `tipoFolha`; `modo=detalhe` retorna `{ count, total, remuneracoes[] }` com a composição individual, limitada por `limite` (padrão 50, máx 500). Filtros `nome`/`tipoFolha` aplicam antes de tudo. Para o cadastro de servidores use `senado_servidores`.",
    {
      ano: z.number().int().min(2013).max(2100).describe("Ano de referência"),
      mes: z.number().int().min(1).max(12).describe("Mês de referência"),
      modo: z.enum(["resumo", "detalhe"]).optional().default("resumo").describe("resumo = totais por tipo de folha (padrão); detalhe = composição individual. Ignorado quando estatisticas=true"),
      estatisticas: z.boolean().optional().default(false).describe("Computa estatísticas (min/máx/média/mediana/percentis) + ranking top/bottom sobre a folha inteira. Use para 'quem ganhou mais/menos', 'média', 'ranking'"),
      campo: z.enum(CAMPOS_ESTATISTICA).optional().default("bruto").describe("Verba analisada quando estatisticas=true (padrão: remuneração bruta). O resultado traz o rótulo legível em campoAnalisado."),
      consolidarPorServidor: z.boolean().optional().default(true).describe("Soma as linhas (Normal+Suplementar) do mesmo servidor antes das estatísticas (padrão: true). Ignorado — forçado a false — quando agruparPor está definido"),
      agruparPor: z.enum(["tipoFolha"]).optional().describe("Quando estatisticas=true, devolve estatísticas por grupo (só `tipoFolha`); implica dados por linha (não consolidados)"),
      topN: z.number().int().min(1).max(100).optional().default(10).describe("Tamanho das listas top/bottom quando estatisticas=true (padrão: 10, máx: 100)"),
      nome: z.string().optional().describe("Nome do servidor (busca parcial)"),
      tipoFolha: z.string().optional().describe("Filtrar por tipo de folha (busca parcial)"),
      limite: z.number().int().min(1).max(500).optional().default(50).describe("Máximo de linhas no modo detalhe (padrão: 50)"),
    },
    async (params) => {
      try {
        const { value: bruto, fetchedAt } = await cachedFetchWithMeta(
          "senado_remuneracoes_servidores",
          { ano: params.ano, mes: params.mes },
          CACHE_STATIC,
          () => admFetchLarge(`/servidores/remuneracoes/${params.ano}/${params.mes}`, {}, admBaseUrl),
        );
        let itens = ensureArray(bruto);
        if (params.nome) itens = itens.filter((r: any) => matchesFiltro(r.nome, params.nome!));
        if (params.tipoFolha) itens = itens.filter((r: any) => matchesFiltro(r.tipo_folha || "", params.tipoFolha!));

        const prov = provenanceFor("SENADO_ADM", admBaseUrl, `/api/v1/servidores/remuneracoes/${params.ano}/${params.mes}`, {
          dataset_id: `remuneracoes; ${params.ano}/${params.mes}`,
          reference_period: `${params.ano}-${String(params.mes).padStart(2, "0")}`,
          retrieved_at: fetchedAt,
        });

        if (params.estatisticas) {
          return resultWithProvenance({
            ano: params.ano,
            mes: params.mes,
            ...estatisticasRemuneracoes(itens, {
              campo: params.campo ?? "bruto",
              consolidar: params.consolidarPorServidor ?? true,
              agruparPor: params.agruparPor,
              topN: params.topN ?? 10,
            }),
          }, prov);
        }

        if ((params.modo ?? "resumo") === "detalhe") {
          const limite = params.limite ?? 50;
          return resultWithProvenance({
            ano: params.ano,
            mes: params.mes,
            count: Math.min(itens.length, limite),
            total: itens.length,
            ...(itens.length > limite ? { aviso: `Exibindo ${limite} de ${itens.length} registros. Filtre por nome ou use modo=resumo.` } : {}),
            remuneracoes: itens.slice(0, limite).map(resumoRemuneracao),
          }, prov);
        }

        const porFolha = new Map<string, { registros: number; totalBruto: number }>();
        for (const r of itens) {
          const k = (r as any).tipo_folha || "(sem tipo)";
          const g = porFolha.get(k) ?? { registros: 0, totalBruto: 0 };
          const linha = resumoRemuneracao(r);
          g.registros += 1;
          g.totalBruto += linha.bruto;
          porFolha.set(k, g);
        }
        const resumo = Array.from(porFolha.entries())
          .map(([tipoFolha, g]) => ({
            tipoFolha,
            registros: g.registros,
            totalBruto: Math.round(g.totalBruto * 100) / 100,
            mediaBruta: Math.round((g.totalBruto / g.registros) * 100) / 100,
          }))
          .sort((a, b) => b.totalBruto - a.totalBruto);
        return resultWithProvenance({ ano: params.ano, mes: params.mes, totalRegistros: itens.length, resumo }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao consultar remunerações");
      }
    },
  );

  // P3. senado_horas_extras
  server.tool(
    "senado_horas_extras",
    "Horas extras pagas a servidores do Senado em `ano`/`mes` de referência (a partir de 2013). Para perguntas de **maior/menor/média/mediana/distribuição/ranking** ('quem recebeu mais horas extras', 'valor mediano de hora extra', 'distribuição dos pagamentos') use `estatisticas=true`: computa min/máx/média/mediana/desvio/percentis sobre TODAS as linhas filtradas (`valorTotal`) e devolve `top`/`bottom` (padrão 10) com identificadores. Sem `agruparPor` → `distribuicao` das linhas individuais + `top`/`bottom`; com `agruparPor` (`nome`/`competencia`) → `grupos[]` ranqueados por soma decrescente (`grupos[0]` = quem mais recebeu; por `nome` soma as linhas do mesmo servidor no mês), cada um com sua mini-distribuição. Sem `estatisticas`: retorna `{ ano, mes, count, total, valorTotal, horasExtras[] }`, onde `valorTotal` soma o gasto do mês e cada item traz `nome`, `valorTotal`, `horasExtras`, `competencia` e `pagamento`. Filtro opcional por `nome` (busca parcial) e `limite` (padrão 100, máx 500; ignorado quando estatisticas=true). Para a remuneração completa do servidor use `senado_remuneracoes_servidores`.",
    {
      ano: z.number().int().min(2013).max(2100).describe("Ano de referência"),
      mes: z.number().int().min(1).max(12).describe("Mês de referência"),
      estatisticas: z.boolean().optional().default(false).describe("Computa estatísticas (min/máx/média/mediana/percentis) + ranking top/bottom sobre todas as linhas filtradas. Use para 'quem recebeu mais/menos', 'média', 'mediana', 'ranking'"),
      agruparPor: z.enum(["nome", "competencia"]).optional().describe("Quando estatisticas=true, ranqueia os grupos por soma decrescente (grupos[0] = quem mais recebeu): `nome` soma as linhas do mesmo servidor no mês, `competencia` agrupa por mês de prestação. Cada grupo traz sua mini-distribuição"),
      topN: z.number().int().min(1).max(100).optional().default(10).describe("Tamanho das listas top/bottom quando estatisticas=true sem agruparPor (padrão: 10, máx: 100)"),
      nome: z.string().optional().describe("Nome do servidor (busca parcial)"),
      limite: z.number().int().min(1).max(500).optional().default(100).describe("Máximo de resultados (padrão: 100; ignorado quando estatisticas=true)"),
    },
    async (params) => {
      try {
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_horas_extras",
          { ano: params.ano, mes: params.mes },
          CACHE_STATIC,
          () => admFetch(`/servidores/horas-extras/${params.ano}/${params.mes}`, {}, admBaseUrl),
        );
        let itens = ensureArray(response).map(parseHoraExtra);
        if (params.nome) itens = itens.filter((h) => matchesFiltro(h.nome, params.nome!));
        const valorTotal = Math.round(itens.reduce((s, h) => s + h.valorTotal, 0) * 100) / 100;
        const limite = params.limite ?? 100;
        const prov = provenanceFor("SENADO_ADM", admBaseUrl, `/api/v1/servidores/horas-extras/${params.ano}/${params.mes}`, {
          dataset_id: `horas-extras; ${params.ano}/${params.mes}`,
          reference_period: `${params.ano}-${String(params.mes).padStart(2, "0")}`,
          retrieved_at: fetchedAt,
        });
        if (params.estatisticas) {
          return resultWithProvenance({
            ano: params.ano,
            mes: params.mes,
            modo: "estatisticas",
            total: itens.length,
            valorTotal,
            ...estatisticasHorasExtras(itens, { agruparPor: params.agruparPor, topN: params.topN ?? 10 }),
          }, prov);
        }
        return resultWithProvenance({
          ano: params.ano,
          mes: params.mes,
          count: Math.min(itens.length, limite),
          total: itens.length,
          valorTotal,
          horasExtras: itens.slice(0, limite),
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao consultar horas extras");
      }
    },
  );

  // P4. senado_pessoal_tabelas (quantitativos agregados + listas nominais sob um só enum)
  server.tool(
    "senado_pessoal_tabelas",
    "Tabelas de pessoal do Senado conforme o parâmetro `tabela`. Quantitativos agregados: `pessoal` (força de trabalho por classe/escolaridade), `cargos-funcoes` (cargos em comissão e funções de confiança), `previsao-aposentadoria`, `senadores`. Listas nominais: `estagiarios` (ativos), `pensionistas`, `lotacoes` (setores), `cargos` (nomes de cargos). Retorna `{ tabela, count, total, aviso?, registros[] }` — registros agregados (nos quantitativos) ou nominais (nas listas), conforme a `tabela`, limitados por `limite` (padrão 100, máx 2000); `count` 0 e lista vazia quando a tabela não tem registros. O `filtro` textual opcional casa contra qualquer campo do registro. Para o cadastro nominal de servidores efetivos/comissionados use `senado_servidores`.",
    {
      tabela: z.enum([
        "pessoal", "cargos-funcoes", "previsao-aposentadoria", "senadores",
        "estagiarios", "pensionistas", "lotacoes", "cargos",
      ]).describe("Qual tabela de pessoal consultar (quantitativo agregado ou lista nominal)"),
      filtro: z.string().optional().describe("Filtro textual (nome, curso, setor...)"),
      limite: z.number().int().min(1).max(2000).optional().default(100).describe("Máximo de registros (padrão: 100)"),
    },
    async (params) => {
      try {
        const QUANTITATIVOS: Record<string, string> = {
          "pessoal": "/servidores/quantitativos/pessoal",
          "cargos-funcoes": "/servidores/quantitativos/cargos-funcoes",
          "previsao-aposentadoria": "/servidores/previsao-aposentadoria",
          "senadores": "/senadores/quantitativos/senadores",
        };
        const isQuantitativo = params.tabela in QUANTITATIVOS;
        const path = isQuantitativo ? QUANTITATIVOS[params.tabela] : `/servidores/${params.tabela}`;
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_pessoal_tabelas",
          { tabela: params.tabela },
          isQuantitativo ? CACHE_STATIC : CACHE_SEMI_STATIC,
          () => admFetch(path, {}, admBaseUrl),
        );
        // Some adm endpoints (estagiarios) wrap the payload in {statusCode,msg,data};
        // others serve a flat array. unwrapAdmEnvelope handles both.
        let registros = ensureArray(unwrapAdmEnvelope(response));
        if (params.filtro) {
          const f = params.filtro;
          registros = registros.filter((item: any) => matchesFiltro(JSON.stringify(item), f));
        }
        const limite = params.limite ?? 100;
        const prov = provenanceFor("SENADO_ADM", admBaseUrl, `/api/v1${path}`, {
          dataset_id: `tabela=${params.tabela}`, retrieved_at: fetchedAt,
        });
        return resultWithProvenance({
          tabela: params.tabela,
          count: Math.min(registros.length, limite),
          total: registros.length,
          ...(registros.length > limite ? { aviso: `Exibindo ${limite} de ${registros.length} registros.` } : {}),
          registros: registros.slice(0, limite),
        }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao consultar tabela de pessoal");
      }
    },
  );
}
