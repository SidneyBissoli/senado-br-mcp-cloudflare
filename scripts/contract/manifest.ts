/**
 * Fixture manifest for the upstream shape-drift contract tier.
 *
 * Each spec captures ONE live upstream response that feeds an exported parser
 * in src/tools/*. The refresh script (refresh-fixtures.ts) runs the specs in
 * order, normalizes the payload (sorted keys, truncated arrays) and writes it
 * to tests/contract/fixtures/<family>/<name>.json.
 *
 * Specs run sequentially and may depend on earlier captures via `h.ctx`
 * (full, untruncated responses keyed by spec name) — that is how detail
 * endpoints resolve a live id from the corresponding list endpoint.
 *
 * Families group by upstream API surface:
 * - legado:     legis.senado.leg.br PascalCase wrappers (/senador, /comissao, /plenario, ...)
 * - v3:         legis.senado.leg.br flat camelCase (/processo, /votacao)
 * - adm:        adm.senado.gov.br/adm-dadosabertos snake_case (/api/v1/...)
 * - financeiro: www.senado.gov.br Arquimedes JSON feeds (execução orçamentária)
 */

export interface Helpers {
  /** upstreamFetch against the legis base (appends .json). */
  legis: (
    path: string,
    params?: Record<string, string>,
    opts?: { large?: boolean; treat404AsEmpty?: boolean },
  ) => Promise<unknown>;
  /** admFetch against the adm base (prefixes /api/v1). */
  adm: (path: string, params?: Record<string, string>, large?: boolean) => Promise<unknown>;
  /** upstreamFetch against www.senado.gov.br with noJsonSuffix (Arquimedes feeds). */
  financeiro: (path: string) => Promise<unknown>;
  /** Full (untruncated) captures from earlier specs, keyed by spec name. */
  ctx: Map<string, unknown>;
}

export interface FixtureSpec {
  family: "legado" | "v3" | "adm" | "financeiro";
  name: string;
  capture: (h: Helpers) => Promise<unknown>;
  /** Max items kept per array during normalization (default 3). */
  keepItems?: number;
}

/** Safe deep access by key path. */
export function dig(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function asArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function fromCtx(h: Helpers, name: string): unknown {
  const raw = h.ctx.get(name);
  if (raw === undefined) throw new Error(`spec depends on '${name}' which was not captured`);
  return raw;
}

/** First current senator code, resolved from the already-captured list. */
function primeiroSenador(h: Helpers): string {
  const lista = asArray(
    dig(fromCtx(h, "senador-lista-atual"), "ListaParlamentarEmExercicio", "Parlamentares", "Parlamentar"),
  );
  const cod = dig(lista[0], "IdentificacaoParlamentar", "CodigoParlamentar");
  if (!cod) throw new Error("could not resolve a senator code from senador-lista-atual");
  return String(cod);
}

/** All current senator codes (for probe loops on sparse sub-endpoints). */
function codigosSenadores(h: Helpers): string[] {
  const lista = asArray(
    dig(fromCtx(h, "senador-lista-atual"), "ListaParlamentarEmExercicio", "Parlamentares", "Parlamentar"),
  );
  return lista
    .map((p) => dig(p, "IdentificacaoParlamentar", "CodigoParlamentar"))
    .filter((c): c is string | number => c !== undefined && c !== null)
    .map(String);
}

/**
 * Probe a per-senator sub-endpoint across the first `max` senators and return
 * the first non-empty response (some histories — licenças, profissões — are
 * legitimately empty for many senators).
 */
async function probeSenadores(
  h: Helpers,
  max: number,
  fetchOne: (cod: string) => Promise<unknown>,
  nonEmpty: (raw: unknown) => boolean,
): Promise<unknown> {
  for (const cod of codigosSenadores(h).slice(0, max)) {
    const raw = await fetchOne(cod);
    if (nonEmpty(raw)) return raw;
  }
  throw new Error(`no non-empty response found probing ${max} senators`);
}

export const FIXTURES: FixtureSpec[] = [
  // ── legado: /senador family ────────────────────────────────────────────
  {
    family: "legado",
    name: "senador-lista-atual",
    capture: (h) => h.legis("/senador/lista/atual"),
  },
  {
    family: "legado",
    name: "senadores-afastados",
    capture: (h) => h.legis("/senador/afastados"),
  },
  {
    family: "legado",
    name: "senador-detalhe",
    capture: (h) => h.legis(`/senador/${primeiroSenador(h)}`),
  },
  {
    family: "legado",
    name: "senador-mandatos",
    capture: (h) => h.legis(`/senador/${primeiroSenador(h)}/mandatos`),
  },
  {
    family: "legado",
    name: "senador-comissoes",
    capture: (h) => h.legis(`/senador/${primeiroSenador(h)}/comissoes`),
  },
  {
    family: "legado",
    name: "senador-cargos",
    capture: (h) =>
      probeSenadores(
        h,
        10,
        (cod) => h.legis(`/senador/${cod}/cargos`),
        (raw) => asArray(dig(raw, "CargoParlamentar", "Parlamentar", "Cargos", "Cargo")).length > 0,
      ),
  },
  {
    family: "legado",
    name: "senador-filiacoes",
    capture: (h) => h.legis(`/senador/${primeiroSenador(h)}/filiacoes`),
  },
  {
    family: "legado",
    name: "senador-licencas",
    capture: (h) =>
      probeSenadores(
        h,
        20,
        (cod) => h.legis(`/senador/${cod}/licencas`),
        (raw) => asArray(dig(raw, "LicencaParlamentar", "Parlamentar", "Licencas", "Licenca")).length > 0,
      ),
  },
  {
    family: "legado",
    name: "senador-profissao",
    capture: (h) =>
      probeSenadores(
        h,
        20,
        (cod) => h.legis(`/senador/${cod}/profissao`),
        (raw) =>
          asArray(dig(raw, "ProfissaoParlamentar", "Parlamentar", "Profissoes", "Profissao")).length > 0 ||
          asArray(dig(raw, "HistoricoAcademicoParlamentar", "Parlamentar", "Profissoes", "Profissao")).length > 0,
      ),
  },
  {
    family: "legado",
    name: "tipos-uso-palavra",
    capture: (h) => h.legis("/senador/lista/tiposUsoPalavra"),
  },

  // ── legado: discursos ──────────────────────────────────────────────────
  {
    family: "legado",
    name: "discursos-plenario",
    capture: (h) => h.legis("/plenario/lista/discursos/20250301/20250331"),
  },
  {
    family: "legado",
    name: "discursos-senador",
    capture: async (h) => {
      const sessoes = asArray(dig(fromCtx(h, "discursos-plenario"), "DiscursosSessao", "Sessoes", "Sessao"));
      for (const s of sessoes.slice(0, 5)) {
        for (const p of asArray(dig(s, "Pronunciamentos", "Pronunciamento")).slice(0, 3)) {
          const cod = dig(p, "CodigoParlamentar");
          if (!cod) continue;
          const raw = await h.legis(`/senador/${cod}/discursos`, {
            dataInicio: "20250301",
            dataFim: "20250331",
          });
          const itens = asArray(
            dig(raw, "DiscursosParlamentar", "Parlamentar", "Pronunciamentos", "Pronunciamento"),
          );
          if (itens.length > 0) return raw;
        }
      }
      throw new Error("no senator with plenary speeches found for the fixture window");
    },
  },

  // ── legado: comissões ──────────────────────────────────────────────────
  {
    family: "legado",
    name: "comissao-lista",
    capture: (h) => h.legis("/comissao/lista/colegiados"),
  },
  {
    family: "legado",
    name: "comissao-detalhe",
    // 34 = CCJ, permanent committee (stable code)
    capture: (h) => h.legis("/comissao/34"),
  },
  {
    family: "legado",
    name: "comissao-membros",
    capture: (h) => h.legis("/composicao/comissao/34", { ativas: "S" }),
  },
  {
    family: "legado",
    name: "comissao-agenda",
    // a single busy week — the full month blows the 5 MB response guard
    capture: (h) => h.legis("/comissao/agenda/20250505/20250509"),
  },
  {
    family: "legado",
    name: "reuniao-detalhe",
    capture: async (h) => {
      const reunioes = asArray(dig(fromCtx(h, "comissao-agenda"), "AgendaReuniao", "reunioes", "reuniao"));
      for (const re of reunioes.slice(0, 5)) {
        const cod = dig(re, "codigo");
        if (!cod) continue;
        const raw = await h.legis(`/comissao/reuniao/${cod}`);
        if (dig(raw, "DetalheReuniao", "reuniao") ?? dig(raw, "reuniao")) return raw;
      }
      throw new Error("no reunion detail resolvable from comissao-agenda");
    },
  },
  {
    family: "legado",
    name: "distribuicao-autoria",
    capture: (h) => h.legis("/materia/distribuicao/autoria", { siglaComissao: "CCJ" }),
  },
  {
    family: "legado",
    name: "distribuicao-relatoria",
    capture: (h) => h.legis("/materia/distribuicao/relatoria/CCJ"),
  },

  // ── legado: composição (blocos, lideranças, mesas) ─────────────────────
  {
    family: "legado",
    name: "blocos-lista",
    capture: (h) => h.legis("/composicao/lista/blocos"),
  },
  {
    family: "legado",
    name: "bloco-detalhe",
    capture: async (h) => {
      const blocos = asArray(dig(fromCtx(h, "blocos-lista"), "ListaBlocoParlamentar", "Blocos", "Bloco"));
      const b0 = blocos[0];
      const cod = dig(b0, "CodigoBloco") ?? dig(b0, "Bloco", "CodigoBloco");
      if (!cod) throw new Error("could not resolve a bloco code from blocos-lista");
      return h.legis(`/composicao/bloco/${cod}`);
    },
  },
  {
    family: "legado",
    name: "liderancas",
    capture: (h) => h.legis("/composicao/lideranca"),
  },
  {
    family: "legado",
    name: "mesa-sf",
    capture: (h) => h.legis("/composicao/mesaSF"),
  },
  {
    family: "legado",
    name: "mesa-cn",
    capture: (h) => h.legis("/composicao/mesaCN"),
  },

  // ── legado: plenário ───────────────────────────────────────────────────
  {
    family: "legado",
    name: "agenda-plenario-mes",
    capture: (h) => h.legis("/plenario/agenda/mes/20250401"),
  },
  {
    family: "legado",
    name: "resultado-plenario-mes",
    capture: (h) => h.legis("/plenario/resultado/mes/20250401"),
  },
  {
    family: "legado",
    name: "orientacao-bancada",
    capture: (h) => h.legis("/plenario/votacao/orientacaoBancada/20250201/20250630"),
  },
  {
    family: "legado",
    name: "tabelas-plenario-legislaturas",
    capture: (h) => h.legis("/plenario/lista/legislaturas"),
  },

  // ── legado: vetos, autores, legislação, orçamento parlamentar ──────────
  {
    family: "legado",
    name: "vetos",
    capture: (h) => h.legis("/materia/vetos/aposrcn"),
  },
  {
    family: "legado",
    name: "autores-atuais",
    capture: (h) => h.legis("/autor/lista/atual"),
  },
  {
    family: "legado",
    name: "legislacao-lista",
    capture: (h) => h.legis("/legislacao/lista", { tipo: "LEI", ano: "2024" }),
  },
  {
    family: "legado",
    name: "legislacao-detalhe",
    capture: async (h) => {
      const docs = asArray(dig(fromCtx(h, "legislacao-lista"), "ListaDocumento", "documentos", "documento"));
      const d0 = docs[0] as Record<string, unknown> | undefined;
      const cod = d0?.id ?? d0?.Codigo ?? d0?.codigo;
      if (!cod) throw new Error("could not resolve a norma code from legislacao-lista");
      return h.legis(`/legislacao/${cod}`);
    },
  },
  {
    family: "legado",
    name: "tipos-norma",
    capture: (h) => h.legis("/legislacao/tiposNorma"),
  },
  {
    family: "legado",
    name: "orcamento-lista",
    capture: (h) => h.legis("/orcamento/lista"),
  },
  {
    family: "legado",
    name: "orcamento-oficios",
    capture: (h) => h.legis("/orcamento/oficios", {}, { large: true }),
  },

  // ── legado: votação de comissão + taquigrafia ──────────────────────────
  {
    family: "legado",
    name: "votacao-comissao",
    capture: (h) => h.legis("/votacaoComissao/comissao/CCJ"),
  },
  {
    family: "legado",
    name: "notas-taquigraficas",
    capture: async (h) => {
      for (const cod of codigosSessoes(h)) {
        const raw = await h.legis(`/taquigrafia/notas/sessao/${cod}`, {}, { treat404AsEmpty: true });
        const nt = (dig(raw, "notasTaquigraficas") ?? raw) as Record<string, unknown> | unknown[];
        if (asArray(dig(nt, "quartos")).length > 0) return raw;
      }
      throw new Error("no plenary session with taquigrafia notes found");
    },
  },
  {
    family: "legado",
    name: "videos-taquigrafia",
    capture: async (h) => {
      for (const cod of codigosSessoes(h)) {
        const raw = await h.legis(`/taquigrafia/videos/sessao/${cod}`, {}, { treat404AsEmpty: true });
        if (asArray(raw).length > 0) return raw;
      }
      throw new Error("no plenary session with taquigrafia videos found");
    },
  },

  // ── v3: /processo + /votacao ───────────────────────────────────────────
  {
    family: "v3",
    name: "processo-lista",
    capture: (h) => h.legis("/processo", { sigla: "PL", ano: "2025" }),
  },
  {
    family: "v3",
    name: "processo-detalhe",
    capture: async (h) => {
      const itens = asArray(fromCtx(h, "processo-lista"));
      const id = dig(itens[0], "id");
      if (!id) throw new Error("could not resolve a processo id from processo-lista");
      return h.legis(`/processo/${id}`);
    },
  },
  {
    family: "v3",
    name: "processo-documento",
    capture: async (h) => {
      for (const item of asArray(fromCtx(h, "processo-lista")).slice(0, 10)) {
        const cod = dig(item, "codigoMateria");
        if (!cod) continue;
        const raw = await h.legis("/processo/documento", { codigoMateria: String(cod) });
        if (asArray(raw).length > 0) return raw;
      }
      throw new Error("no matéria with documents found in processo-lista sample");
    },
  },
  {
    family: "v3",
    name: "processo-relatoria",
    capture: async (h) => {
      for (const item of asArray(fromCtx(h, "processo-lista")).slice(0, 10)) {
        const cod = dig(item, "codigoMateria");
        if (!cod) continue;
        const raw = await h.legis("/processo/relatoria", { codigoMateria: String(cod) });
        if (asArray(raw).length > 0) return raw;
      }
      throw new Error("no matéria with relatorias found in processo-lista sample");
    },
  },
  {
    family: "v3",
    name: "processo-emenda",
    capture: async (h) => {
      // PECs attract emendas far more reliably than ordinary PLs
      const pecs = asArray(await h.legis("/processo", { sigla: "PEC", ano: "2023" }));
      for (const item of pecs.slice(0, 10)) {
        const cod = dig(item, "codigoMateria");
        if (!cod) continue;
        const raw = await h.legis("/processo/emenda", { codigoMateria: String(cod) });
        if (asArray(raw).length > 0) return raw;
      }
      throw new Error("no PEC with emendas found in the 2023 sample");
    },
  },
  {
    family: "v3",
    name: "votacoes",
    capture: async (h) => {
      const raw = await h.legis("/votacao", { dataInicio: "2025-03-01", dataFim: "2025-06-30" });
      if (asArray(raw).length === 0) throw new Error("no votações in the fixture window");
      return raw;
    },
  },
  {
    family: "v3",
    name: "tabelas-processo-siglas",
    capture: (h) => h.legis("/processo/siglas"),
  },

  // ── adm: senadores (CEAPS, auxílios) ───────────────────────────────────
  {
    family: "adm",
    name: "ceaps",
    capture: (h) => h.adm("/senadores/despesas_ceaps/2025", {}, true),
  },
  {
    family: "adm",
    name: "auxilio-moradia",
    capture: (h) => h.adm("/senadores/auxilio-moradia"),
  },
  {
    family: "adm",
    name: "escritorios",
    capture: (h) => h.adm("/senadores/escritorios"),
  },
  {
    family: "adm",
    name: "aposentados",
    capture: (h) => h.adm("/senadores/aposentados"),
  },

  // ── adm: servidores ────────────────────────────────────────────────────
  {
    family: "adm",
    name: "servidores-ativos",
    capture: (h) => h.adm("/servidores/servidores/ativos", {}, true),
  },
  {
    family: "adm",
    name: "remuneracoes",
    capture: (h) => h.adm("/servidores/remuneracoes/2025/3", {}, true),
  },
  {
    family: "adm",
    name: "horas-extras",
    capture: (h) => h.adm("/servidores/horas-extras/2025/3"),
  },
  {
    family: "adm",
    name: "pessoal-estagiarios",
    // enveloped ({statusCode, msg, data}) — exercises unwrapAdmEnvelope
    capture: (h) => h.adm("/servidores/estagiarios"),
  },

  // ── adm: contratações ──────────────────────────────────────────────────
  {
    family: "adm",
    name: "contratos",
    capture: (h) => h.adm("/contratacoes/contratos", {}, true),
  },
  {
    family: "adm",
    name: "licitacoes",
    capture: (h) => h.adm("/contratacoes/licitacoes", { numeroEquals: "19/2018" }),
  },
  {
    family: "adm",
    name: "terceirizados",
    capture: (h) => h.adm("/contratacoes/terceirizados", {}, true),
  },
  {
    family: "adm",
    name: "empresas",
    capture: (h) => h.adm("/contratacoes/empresas", {}, true),
  },
  {
    family: "adm",
    name: "atas-registro-preco",
    capture: (h) => h.adm("/contratacoes/atas_registro_preco", {}, true),
  },

  // ── adm: suprimento de fundos ──────────────────────────────────────────
  {
    family: "adm",
    name: "supridos",
    capture: (h) => h.adm("/supridos/2024"),
  },
  {
    family: "adm",
    name: "supridos-transacoes",
    capture: (h) => h.adm("/supridos/transacoes/2024"),
  },
  {
    family: "adm",
    name: "supridos-empenhos",
    capture: (h) => h.adm("/supridos/empenhos/2024"),
  },
  {
    family: "adm",
    name: "supridos-atos-concessao",
    capture: (h) => h.adm("/supridos/atosConcessao/2024"),
  },

  // ── financeiro: Arquimedes feeds ───────────────────────────────────────
  {
    family: "financeiro",
    name: "execucao-despesas",
    capture: (h) => h.financeiro("/bi-arqs/Arquimedes/Financeiro/DespesaSenadoDadosAbertos.json"),
  },
  {
    family: "financeiro",
    name: "execucao-receitas",
    capture: (h) => h.financeiro("/bi-arqs/Arquimedes/Financeiro/ReceitasSenadoDadosAbertos.json"),
  },
];

/** Plenary session codes from the resultado-plenario-mes capture (probe order). */
function codigosSessoes(h: Helpers): string[] {
  const body = fromCtx(h, "resultado-plenario-mes");
  const stripped = (dig(body, "ResultadoPlenario") ?? body) as unknown;
  const sessoes = asArray(dig(stripped, "Sessoes", "Sessao") ?? dig(stripped, "Sessao") ?? firstArray(stripped));
  return sessoes
    .map((s) => dig(s, "codigoSessao") ?? dig(s, "CodigoSessao"))
    .filter((c): c is string | number => c !== undefined && c !== null)
    .map(String)
    .slice(0, 10);
}

/** First nested array found by DFS (mirror of firstArrayDeep in plenario.ts). */
function firstArray(obj: unknown, depth = 4): unknown[] | undefined {
  if (Array.isArray(obj)) return obj;
  if (depth === 0 || obj === null || typeof obj !== "object") return undefined;
  for (const v of Object.values(obj)) {
    const found = firstArray(v, depth - 1);
    if (found) return found;
  }
  return undefined;
}
