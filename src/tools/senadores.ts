/**
 * Group A — Senators (5 tools)
 * senado_listar_senadores (filtro `nome` absorve a antiga busca por nome),
 * senado_obter_senador, senado_votacoes_senador,
 * senado_senador_historico (tipo: licencas | comissoes | cargos | historico-academico |
 *   filiacoes | profissoes — estes dois substituem o antigo senado_senador_detail),
 * senado_senadores_afastados
 */

import type { SenadoToolHost } from "../tool-host.js";
import { z } from "zod";
import { cachedFetchWithMeta } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { errorFrom, ensureArray, normalizeText, safeInt } from "../utils/validation.js";
import { digArrayRoot, digObjectRoot } from "../utils/upstream-parse.js";
import { derivado, leituraDoCache, provenanceFor, resultWithProvenance, toBrasiliaIso, withFieldSources, type Provenance } from "../utils/provenance.js";
import { CACHE_SEMI_STATIC, CACHE_DYNAMIC, CACHE_ON_DEMAND } from "../types.js";

/**
 * `emExercicio` is NOT read from the record: none of the three list endpoints carries
 * a usable flag. The participation lives inside `Mandato` and only says titular/suplente
 * — and a suplente in `/senador/lista/atual` IS seated (11 of 81 on 30/10/2026). Until
 * 3.x the field read a top-level `DescricaoParticipacao`/`DataFim` that never exists, so
 * it came out `true` for everyone, including the 163 suplentes of legislature 57.
 * The caller states it from WHICH official list the record came (see
 * `resumosDaListagem`); `null` when it is not known.
 */
export function parseSenadorResumo(parlamentar: any, emExercicio: boolean | null = null) {
  const id = parlamentar.IdentificacaoParlamentar || parlamentar;
  const m = parlamentar.Mandato || {};
  return {
    codigo: parseInt(id.CodigoParlamentar || "0"),
    nome: id.NomeParlamentar || "",
    nomeCompleto: id.NomeCompletoParlamentar || id.NomeParlamentar || "",
    partido: m.Partido?.SiglaPartido || id.SiglaPartidoParlamentar || null,
    uf: m.UfParlamentar || id.UfParlamentar || "",
    foto: id.UrlFotoParlamentar || null,
    emExercicio,
  };
}

export const PATH_SENADORES_ATUAIS = "/senador/lista/atual";
export const PATH_SENADORES_AFASTADOS = "/senador/afastados";

/**
 * The official list `senado_listar_senadores` reads. "Em exercício" is a state of TODAY:
 * without `legislatura`, `true` (default) is `/senador/lista/atual` and `false` is
 * `/senador/afastados` (licensed titulars + suplentes out of the seat — measured 30/10/2026:
 * 81 and 44, disjoint). With `legislatura`, the legislature list is crossed with
 * `/senador/lista/atual` (`cruzaComAtual`).
 */
export function fonteDaListagem(params: { legislatura?: number; emExercicio?: boolean }): {
  path: string;
  dataset_id: string;
  cruzaComAtual: boolean;
} {
  if (params.legislatura) {
    return { path: `/senador/lista/legislatura/${params.legislatura}`, dataset_id: `legislatura=${params.legislatura}`, cruzaComAtual: true };
  }
  return params.emExercicio === false
    ? { path: PATH_SENADORES_AFASTADOS, dataset_id: "afastados", cruzaComAtual: false }
    : { path: PATH_SENADORES_ATUAIS, dataset_id: "lista/atual", cruzaComAtual: false };
}

/**
 * Summaries with `emExercicio` stated from the list they came from. With `legislatura`,
 * it is membership in `/senador/lista/atual` (`codigosEmExercicio`), and an explicit
 * `emExercicio` filters on it; omitted, the whole legislature comes back.
 */
export function resumosDaListagem(
  parlamentares: any[],
  params: { legislatura?: number; emExercicio?: boolean },
  codigosEmExercicio: ReadonlySet<number> | null,
) {
  if (!params.legislatura || !codigosEmExercicio) {
    const emExercicio = params.legislatura ? null : params.emExercicio !== false;
    return parlamentares.map((p) => parseSenadorResumo(p, emExercicio));
  }
  const resumos = parlamentares.map((p) => {
    const r = parseSenadorResumo(p);
    return { ...r, emExercicio: codigosEmExercicio.has(r.codigo) };
  });
  return params.emExercicio === undefined
    ? resumos
    : resumos.filter((s) => s.emExercicio === params.emExercicio);
}

/** Server-side cross of a legislature list with the current one (contract v1.3 `derived`). */
export const NOTA_DERIVACAO_EM_EXERCICIO =
  "Situação de exercício de cada senador da legislatura determinada pelo servidor, cruzando a lista da legislatura com a lista oficial dos senadores em exercício hoje.";

/**
 * Provenance of `senado_listar_senadores`. A plain list (atual/afastados) restates the
 * source. With `legislatura`, `emExercicio` comes from a second reading (`atual`), which
 * becomes a field source, and the block is marked derived.
 */
export function provenanceDaListagem(
  baseUrl: string,
  params: { legislatura?: number; emExercicio?: boolean },
  principal: { fetchedAt: string },
  atual: { fetchedAt: string; fromCache: boolean } | null,
): Provenance {
  const fonte = fonteDaListagem(params);
  const prov = provenanceFor("SENADO_LEGIS", baseUrl, fonte.path, {
    dataset_id: fonte.dataset_id,
    retrieved_at: principal.fetchedAt,
  });
  if (!atual) return prov;
  return derivado(
    withFieldSources(prov, [
      {
        fields: ["emExercicio"],
        source_url: `${baseUrl.replace(/\/$/, "")}${PATH_SENADORES_ATUAIS}`,
        dataset_id: "lista/atual",
        ...leituraDoCache(atual),
      },
    ]),
    NOTA_DERIVACAO_EM_EXERCICIO,
  );
}

/**
 * Match a party filter tolerantly (OBS-6). The upstream stores the official sigla
 * ("PODEMOS"), so an exact match against a common short form ("PODE") silently
 * returned 0. Accept an exact match, or a prefix relationship when the shorter side
 * has ≥4 chars (catches PODE↔PODEMOS without collapsing PP↔PPS).
 */
export function matchesPartido(sigla: unknown, filtro: string): boolean {
  const sp = String(sigla ?? "").trim().toUpperCase();
  const p = filtro.trim().toUpperCase();
  if (!sp || !p) return false;
  if (sp === p) return true;
  const shorter = Math.min(sp.length, p.length);
  return shorter >= 4 && (sp.startsWith(p) || p.startsWith(sp));
}

/**
 * `emExercicio` derivado do DADO, nunca afirmado. Regra: está em exercício quem
 * tem um `Exercicio` já iniciado e ainda não encerrado — suplente que assumiu a
 * vaga tem exercício aberto (`DataFim` ausente); titular licenciado tem todos
 * fechados.
 *
 * MEDIDA em 24/09/2026 contra as duas listas oficiais (`/senador/lista/atual`,
 * 81 senadores, e `/senador/afastados`, 42): 123 de 123 acertos, sem exceção.
 *
 * Devolve `null` — não `false` — quando não há exercício nenhum para ler
 * (sub-endpoint `/mandatos` indisponível, ou mandato sem `Exercicios`): campo
 * que não se sabe não pode sair afirmado, e `false` afirmaria "não está em
 * exercício". As datas do upstream são ISO `AAAA-MM-DD`, então a comparação
 * lexicográfica é a cronológica; `hoje` vem do chamador (fuso de Brasília)
 * para a função continuar pura e testável.
 */
export function derivarEmExercicio(mandatos: unknown[], hoje: string): boolean | null {
  let algumExercicio = false;
  for (const m of mandatos) {
    for (const e of ensureArray((m as any)?.Exercicios?.Exercicio) as any[]) {
      const inicio = e?.DataInicio;
      if (!inicio) continue;
      algumExercicio = true;
      const fim = e?.DataFim;
      if (inicio <= hoje && (!fim || fim >= hoje)) return true;
    }
  }
  return algumExercicio ? false : null;
}

export function parseSenadorDetalhe(dados: any) {
  const p = dados.Parlamentar || dados;
  const id = p.IdentificacaoParlamentar || {};
  const db = p.DadosBasicosParlamentar || {};
  return {
    codigo: parseInt(id.CodigoParlamentar || "0"),
    nome: id.NomeParlamentar || "",
    nomeCompleto: id.NomeCompletoParlamentar || "",
    nomeCivil: db.NomeCivilParlamentar || null,
    sexo: id.SexoParlamentar || null,
    dataNascimento: db.DataNascimento || null,
    naturalidade: db.Naturalidade || null,
    ufNaturalidade: db.UfNaturalidade || null,
    partido: id.SiglaPartidoParlamentar || null,
    uf: id.UfParlamentar || "",
    foto: id.UrlFotoParlamentar || null,
    email: id.EmailParlamentar || null,
    // O detalhe `/senador/{codigo}` NÃO carrega exercício nenhum — medido em
    // 24/09/2026: traz só IdentificacaoParlamentar, DadosBasicosParlamentar e
    // OutrasInformacoes. Até 24/09 este campo saía `true` fixo, e o servidor se
    // contradizia sobre gente real (o código 6358 saía `emExercicio: true` aqui
    // e `false` em `senado_senadores_afastados`). Quem sabe a verdade é o
    // sub-endpoint `/mandatos`: `fetchSenadorDetalhe` sobrescreve este valor com
    // `derivarEmExercicio`. `null` é o default honesto para quem chamar o parser
    // sozinho, sem os mandatos em mãos.
    emExercicio: null as boolean | null,
    mandatos: ensureArray(p.Mandatos?.Mandato).map((m: any) => ({
      legislatura: parseInt(m.PrimeiraLegislaturaDoMandato?.NumeroLegislatura || "0"),
      uf: m.UfParlamentar || "",
      participacao: m.DescricaoParticipacao || "",
      dataInicio: m.DataInicio || null,
      dataFim: m.DataFim || null,
    })),
  };
}

/**
 * Extract a senator's own vote from a v3 /votacao item.
 * Returns the legacy senado_votacoes_senador output shape.
 */
export function parseVotoSenador(v: any, codigoSenador: number) {
  const voto = ensureArray(v.votos).find(
    (vt: any) => vt.codigoParlamentar === codigoSenador,
  ) as any;
  return {
    // O PAR, não um dos dois. Até 24/09/2026 este campo servia só o
    // `codigoSessaoVotacao` (4 dígitos) e a descrição mandava usar
    // `senado_obter_votacao` com ele — que filtrava por `codigoSessao` e
    // respondia `count: 0`. Medido: 48 de 48 votos de um senador em 2026 saíam
    // com código de 4 dígitos, ou seja, o caminho documentado quebrava sempre.
    // Hoje as duas pontas resolvem, e emitir os dois poupa a varredura da
    // janela: com `codigoSessao` o `obter_votacao` acerta de primeira.
    codigoSessao: v.codigoSessao || null,
    codigoVotacao: v.codigoSessaoVotacao || v.codigoSessao || 0,
    data: v.dataSessao ? String(v.dataSessao).split("T")[0] : "",
    materia: v.identificacao || (v.sigla ? `${v.sigla} ${v.numero}/${v.ano}` : ""),
    descricao: v.descricaoVotacao || null,
    voto: voto?.descricaoVotoParlamentar || voto?.siglaVotoParlamentar || "",
    resultado: v.resultadoVotacao || null,
  };
}

export function extractParlamentares(response: any): any[] {
  const list =
    response?.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar ??
    response?.ListaParlamentarLegislatura?.Parlamentares?.Parlamentar ??
    response?.AfastamentoAtual?.Parlamentares?.Parlamentar;
  return ensureArray(list);
}

/** Parse a senator leave-of-absence (licença) entry. */
export function parseLicenca(l: any) {
  return {
    codigo: parseInt(l.Codigo || "0") || null,
    dataInicio: l.DataInicio || null,
    dataFim: l.DataFim || l.DataFimPrevista || null,
    sigla: l.SiglaTipoAfastamento || null,
    descricao: l.DescricaoTipoAfastamento || l.DescricaoFinalidade || l.Descricao || null,
  };
}

/** Parse a mandate entry from /senador/{codigo}/mandatos (not in the /senador/{codigo} detail). */
export function parseMandato(m: any) {
  const primeira = m.PrimeiraLegislaturaDoMandato || {};
  const segunda = m.SegundaLegislaturaDoMandato || {};
  return {
    legislatura: safeInt(primeira.NumeroLegislatura) || null,
    uf: m.UfParlamentar || null,
    participacao: m.DescricaoParticipacao || null,
    dataInicio: primeira.DataInicio || null,
    dataFim: segunda.DataFim || primeira.DataFim || null,
  };
}

/** Parse a committee membership entry from /senador/{codigo}/comissoes. */
export function parseComissaoMembro(c: any) {
  const id = c.IdentificacaoComissao || {};
  return {
    codigo: parseInt(id.CodigoComissao || "0") || null,
    sigla: id.SiglaComissao || null,
    nome: id.NomeComissao || null,
    casa: id.SiglaCasaComissao || null,
    participacao: c.DescricaoParticipacao || null,
    dataInicio: c.DataInicio || null,
    dataFim: c.DataFim || null,
  };
}

/** Parse a committee position entry from /senador/{codigo}/cargos. */
export function parseCargoSenador(c: any) {
  const id = c.IdentificacaoComissao || {};
  return {
    comissao: id.SiglaComissao || null,
    nomeComissao: id.NomeComissao || null,
    casa: id.SiglaCasaComissao || null,
    cargo: c.DescricaoCargo || c.Cargo?.DescricaoCargo || null,
    dataInicio: c.DataInicio || null,
    dataFim: c.DataFim || null,
  };
}

/** Parse a party affiliation entry from /senador/{codigo}/filiacoes. */
export function parseFiliacao(f: any) {
  return {
    partido: f.Partido?.SiglaPartido || f.SiglaPartido || "",
    nomePartido: f.Partido?.NomePartido || f.NomePartido || "",
    dataFiliacao: f.DataFiliacao || null,
    dataDesfiliacao: f.DataDesfiliacao || null,
  };
}

/** Parse a profession entry from /senador/{codigo}/profissao. */
export function parseProfissao(p: any) {
  return { nome: p.NomeProfissao || p.DescricaoProfissao || "" };
}

/** Case/accent-insensitive substring match against a senator's full or short name. */
export function matchesNome(s: { nome: string; nomeCompleto: string }, nome: string): boolean {
  const alvo = normalizeText(nome);
  return normalizeText(s.nomeCompleto).includes(alvo) || normalizeText(s.nome).includes(alvo);
}

/**
 * A leitura de `senado_obter_senador`: detalhe biográfico + mandatos (sub-endpoint,
 * degrada para lista vazia). Exportada porque o `fetch` do Deep Research
 * (`deep-research.ts`) é este mesmo documento, com a mesma proveniência e o
 * mesmo cache — `path` é o que entra em `provenanceFor`.
 */
export async function fetchSenadorDetalhe(codigoSenador: number, baseUrl: string) {
  const path = `/senador/${codigoSenador}`;
  const { value: response, fetchedAt, fromCache } = await cachedFetchWithMeta(
    "senado_obter_senador",
    { codigo: codigoSenador },
    CACHE_ON_DEMAND,
    () => upstreamFetch(path, {}, baseUrl),
  );
  // Ausência com HTTP 200: para um código que não existe o upstream devolve
  // `{"DetalheParlamentar":{...Metadados}}` — envelope e metadados presentes,
  // SEM o nó `Parlamentar` (medido em 24/09/2026: 200, 304 bytes). O
  // `?? response` que havia aqui deixava o parser montar um registro inteiro a
  // partir de nada (`codigo: 0`, `nome: ""`), e quem perguntava recebia uma
  // afirmação falsa. `digObjectRoot` é a defesa na BORDA: num detalhe por
  // identificador único, nó ausente é ausência, nunca "vazio legítimo".
  const dados = digObjectRoot(
    response,
    [
      ["DetalheParlamentar", "Parlamentar"],
      ["Parlamentar"],
    ],
    "senado_obter_senador",
    { notFoundMessage: `Senador com código ${codigoSenador} não encontrado.` },
  );
  const detalhe = parseSenadorDetalhe(dados);
  // The /senador/{codigo} detail carries no Mandatos; fetch the sub-endpoint.
  // Degrade to an empty list if it fails, keeping the biographical data.
  // É também o único endpoint que carrega os `Exercicios`, de onde sai o
  // `emExercicio` — lista vazia (falha do sub-endpoint) vira `null`, não `false`.
  let mandatosBrutos: unknown[] = [];
  // Leitura dos mandatos, só quando ela de fato deu os campos `mandatos`/`emExercicio`
  // (falha = lista vazia e `null`, que não vêm de fonte nenhuma).
  let mandatosLeitura: { fetchedAt: string; fromCache: boolean } | undefined;
  try {
    const mandatosPath = `/senador/${codigoSenador}/mandatos`;
    const { value: mResp, fetchedAt: mFetchedAt, fromCache: mFromCache } = await cachedFetchWithMeta(
      "senado_obter_senador_mandatos",
      { codigo: codigoSenador },
      CACHE_ON_DEMAND,
      () => upstreamFetch(mandatosPath, {}, baseUrl),
    );
    mandatosBrutos = digArrayRoot(
      mResp,
      [["MandatoParlamentar", "Parlamentar", "Mandatos", "Mandato"]],
      "senado_obter_senador:mandatos",
    );
    mandatosLeitura = { fetchedAt: mFetchedAt, fromCache: mFromCache };
  } catch {
    // sub-endpoint unavailable — keep the (empty) mandatos from the detail
  }
  const hoje = toBrasiliaIso(new Date()).slice(0, 10);
  return {
    path,
    fetchedAt,
    fromCache,
    mandatosLeitura,
    detalhe: {
      ...detalhe,
      emExercicio: derivarEmExercicio(mandatosBrutos, hoje),
      mandatos: mandatosBrutos.map(parseMandato),
    },
  };
}

/** Campos do detalhe que vêm de `/senador/{codigo}/mandatos`, não do detalhe biográfico. */
const CAMPOS_DOS_MANDATOS = ["mandatos", "emExercicio"];

/**
 * Proveniência de `senado_obter_senador` (e do `fetch` `senador:` do Deep Research, que
 * renderiza o mesmo registro no texto do documento). O registro funde DUAS leituras, cada
 * uma de uma entrada de cache própria: o detalhe biográfico (`/senador/{codigo}`, topo) e os
 * mandatos (`/senador/{codigo}/mandatos`), de onde saem `mandatos` e `emExercicio`. Até a
 * 3.18.1 o instante dos mandatos era descartado e o topo era o do detalhe — com os mandatos
 * em cache desde antes, o bloco dizia que `emExercicio` fora lido mais recentemente do que
 * foi. Com as duas como sub-fontes o topo passa a ser o mais antigo (adaptador, contrato §3).
 * Mandatos que falharam não viram sub-fonte: a resposta leva `[]` e `null`, sem fonte.
 */
export function provenanceSenadorDetalhe(
  baseUrl: string,
  codigoSenador: number,
  leitura: {
    path: string;
    fetchedAt: string;
    fromCache: boolean;
    mandatosLeitura?: { fetchedAt: string; fromCache: boolean };
    /** Só as chaves importam: elas nomeiam os campos de cada sub-fonte. */
    detalhe: Record<string, unknown>;
  },
) {
  const dataset_id = `codigoParlamentar=${codigoSenador}`;
  const topo = { dataset_id, retrieved_at: leitura.fetchedAt };
  if (!leitura.mandatosLeitura) return provenanceFor("SENADO_LEGIS", baseUrl, leitura.path, topo);
  const base = baseUrl.replace(/\/$/, "");
  return provenanceFor("SENADO_LEGIS", baseUrl, leitura.path, {
    ...topo,
    field_sources: [
      {
        fields: Object.keys(leitura.detalhe).filter((k) => !CAMPOS_DOS_MANDATOS.includes(k)),
        source_url: `${base}${leitura.path}`,
        dataset_id,
        ...leituraDoCache(leitura),
      },
      {
        fields: CAMPOS_DOS_MANDATOS,
        source_url: `${base}${leitura.path}/mandatos`,
        dataset_id,
        ...leituraDoCache(leitura.mandatosLeitura),
      },
    ],
  });
}

export function registerSenadoresTools(server: SenadoToolHost, baseUrl: string) {
  // One cache entry per official list: `emExercicio: false` shares the afastados
  // entry with `senado_senadores_afastados`.
  const lerListaOficial = (path: string) =>
    path === PATH_SENADORES_AFASTADOS
      ? cachedFetchWithMeta("senado_senadores_afastados", {}, CACHE_SEMI_STATIC, () => upstreamFetch(path, {}, baseUrl))
      : cachedFetchWithMeta("senado_listar_senadores", { path }, CACHE_SEMI_STATIC, () => upstreamFetch(path, {}, baseUrl));

  // A1. senado_listar_senadores (filtro `nome` substitui a antiga busca por nome)
  server.tool(
    "senado_listar_senadores",
    "Use para pedidos como 'liste os senadores em exercício', 'senadores atuais', 'lista atual de senadores' ou filtros por UF/partido. Lista senadores em exercício, fora de exercício ou de uma legislatura específica, com filtros opcionais por `nome`, `uf` e `partido`. Retorna `{ count, senadores }`, cada item com `codigo`, `nome`, `nomeCompleto`, `partido`, `uf`, `foto` e `emExercicio`, mais proveniência oficial da lista lida. `emExercicio` é a situação de HOJE: sem `legislatura`, `true` (padrão) lista os em exercício (titulares e suplentes que assumiram a vaga) e `false` lista os fora de exercício (titulares licenciados e suplentes fora da vaga — a mesma lista de `senado_senadores_afastados`); com `legislatura`, omitido traz a legislatura inteira e `true`/`false` filtra pela situação de hoje. `nome` faz correspondência parcial ignorando acentos/maiúsculas (use quando você só tem o nome e precisa do `codigo`); `uf`/`partido` filtram localmente. Use o `codigo` em `senado_obter_senador` ou `senado_votacoes_senador`.",
    {
      emExercicio: z.boolean().optional().describe("Situação de hoje: true = em exercício (padrão sem `legislatura`), false = fora de exercício. Com `legislatura`, omitido = todos"),
      legislatura: z.number().int().min(1).optional().describe("Número da legislatura (ex: 57 para 2023-2027)"),
      nome: z.string().optional().describe("Nome ou parte do nome (busca parcial, sem acento)"),
      uf: z.string().max(2).optional().describe("Sigla do estado (ex: SP, RJ, MG)"),
      partido: z.string().optional().describe("Sigla do partido (ex: PT, PL, MDB); tolera formas curtas como PODE→PODEMOS"),
    },
    async (params) => {
      try {
        const fonte = fonteDaListagem(params);
        const principal = await lerListaOficial(fonte.path);
        const atual = fonte.cruzaComAtual ? await lerListaOficial(PATH_SENADORES_ATUAIS) : null;
        const codigosEmExercicio = atual
          ? new Set(extractParlamentares(atual.value).map((p) => parseSenadorResumo(p).codigo))
          : null;
        let senadores = resumosDaListagem(extractParlamentares(principal.value), params, codigosEmExercicio);
        if (params.nome) {
          senadores = senadores.filter((s) => matchesNome(s, params.nome!));
        }
        if (params.uf) {
          const uf = params.uf.toUpperCase();
          senadores = senadores.filter((s) => s.uf.toUpperCase() === uf);
        }
        if (params.partido) {
          senadores = senadores.filter((s) => matchesPartido(s.partido, params.partido!));
        }
        const prov = provenanceDaListagem(baseUrl, params, principal, atual);
        return resultWithProvenance({ count: senadores.length, senadores }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao listar senadores");
      }
    },
  );

  // A2. senado_obter_senador
  server.tool(
    "senado_obter_senador",
    "Obtém o detalhe biográfico de um senador específico. Retorna um objeto com `codigo`, `nome`, `nomeCompleto`, `nomeCivil`, `sexo`, `dataNascimento`, `naturalidade`/`ufNaturalidade`, `partido`, `uf`, `foto`, `email`, `emExercicio` e a lista `mandatos` (`legislatura`, `uf`, `participacao`, `dataInicio`, `dataFim`). `emExercicio` é derivado dos exercícios do mandato (aberto = em exercício) e vem `null` — nunca afirmado — quando os mandatos não puderam ser lidos. Código inexistente retorna erro (\"Senador com código N não encontrado\"), nunca um registro vazio. Requer `codigoSenador` — obtenha-o via `senado_listar_senadores` (filtro `nome`). Para filiações, profissões, licenças, comissões ou cargos use `senado_senador_historico` (parâmetro `tipo`).",
    {
      codigoSenador: z.number().int().positive().describe("Código único do senador no sistema do Senado"),
    },
    async (params) => {
      try {
        const leitura = await fetchSenadorDetalhe(params.codigoSenador, baseUrl);
        const prov = provenanceSenadorDetalhe(baseUrl, params.codigoSenador, leitura);
        return resultWithProvenance(leitura.detalhe, prov);
      } catch (e) {
        return errorFrom(e, "Senador não encontrado");
      }
    },
  );

  // A4. senado_votacoes_senador (migrated to v3 /votacao?codigoParlamentar — legacy endpoint deprecated)
  server.tool(
    "senado_votacoes_senador",
    "Lista as votações nominais de um senador, mostrando como votou em cada matéria. Retorna `{ periodo, count, votos }`, cada voto com `codigoSessao`, `codigoVotacao`, `data`, `materia`, `descricao`, `voto` e `resultado`, ordenados da mais recente para a mais antiga. Sem período usa o ano corrente; informe `ano` ou o par `dataInicio`/`dataFim` (YYYYMMDD). Requer `codigoSenador` (obtenha via `senado_listar_senadores`); para detalhes de uma votação específica (votos de todos os senadores) use `senado_obter_votacao` — os dois códigos são aceitos, e `codigoSessao` resolve direto.",
    {
      codigoSenador: z.number().int().positive().describe("Código único do senador"),
      ano: z.number().int().min(1900).max(2100).optional().describe("Ano das votações"),
      dataInicio: z.string().regex(/^\d{8}$/).optional().describe("Data início (YYYYMMDD)"),
      dataFim: z.string().regex(/^\d{8}$/).optional().describe("Data fim (YYYYMMDD)"),
    },
    async (params) => {
      try {
        let di: string;
        let df: string;
        if (params.dataInicio && params.dataFim) {
          di = `${params.dataInicio.slice(0, 4)}-${params.dataInicio.slice(4, 6)}-${params.dataInicio.slice(6, 8)}`;
          df = `${params.dataFim.slice(0, 4)}-${params.dataFim.slice(4, 6)}-${params.dataFim.slice(6, 8)}`;
        } else {
          const ano = params.ano ?? new Date().getFullYear();
          di = `${ano}-01-01`;
          df = `${ano}-12-31`;
        }
        const qp = {
          codigoParlamentar: String(params.codigoSenador),
          dataInicio: di,
          dataFim: df,
        };
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_votacoes_senador",
          qp,
          CACHE_DYNAMIC,
          () => upstreamFetch("/votacao", qp, baseUrl),
        );
        const votos = ensureArray(response)
          .map((v: any) => parseVotoSenador(v, params.codigoSenador))
          .sort((a, b) => b.data.localeCompare(a.data));
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, "/votacao", {
          dataset_id: `codigoParlamentar=${params.codigoSenador}`,
          reference_period: `${di}/${df}`,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance(
          { periodo: { dataInicio: di, dataFim: df }, count: votos.length, votos },
          prov,
        );
      } catch (e) {
        return errorFrom(e, "Erro ao obter votações do senador");
      }
    },
  );

  // A4. senado_senador_historico (licencas | comissoes | cargos | historico-academico | filiacoes | profissoes)
  server.tool(
    "senado_senador_historico",
    "Histórico funcional de um senador conforme o parâmetro `tipo`. Valores: `licencas` (itens com `dataInicio`/`dataFim`/`descricao`), `comissoes` (`sigla`/`nome`/`casa`/`participacao`/datas), `cargos` (`comissao`/`cargo`/datas), `historico-academico` (cursos, registros brutos da API), `filiacoes` (`partido`/`nomePartido`/`dataFiliacao`/`dataDesfiliacao`) e `profissoes` (`nome`). Retorna `{ codigoSenador, tipo, count, itens }`, com a forma de cada item dependente do `tipo`; tipos sem registros para o senador retornam `count` 0 e `itens` vazio. Requer `codigoSenador` (obtenha via `senado_listar_senadores`). Para dados biográficos e mandatos use `senado_obter_senador`. Ex.: `{ codigoSenador: 4994, tipo: 'filiacoes' }` → histórico de partidos do senador.",
    {
      codigoSenador: z.number().int().positive().describe("Código único do senador"),
      tipo: z.enum(["licencas", "comissoes", "cargos", "historico-academico", "filiacoes", "profissoes"]).describe("Qual histórico consultar"),
    },
    async (params) => {
      try {
        const paths: Record<string, string> = {
          "licencas": `/senador/${params.codigoSenador}/licencas`,
          "comissoes": `/senador/${params.codigoSenador}/comissoes`,
          "cargos": `/senador/${params.codigoSenador}/cargos`,
          "historico-academico": `/senador/${params.codigoSenador}/historicoAcademico`,
          "filiacoes": `/senador/${params.codigoSenador}/filiacoes`,
          "profissoes": `/senador/${params.codigoSenador}/profissao`,
        };
        const path = paths[params.tipo];
        const { value: response, fetchedAt } = await cachedFetchWithMeta(
          "senado_senador_historico",
          { codigo: params.codigoSenador, tipo: params.tipo },
          CACHE_ON_DEMAND,
          () => upstreamFetch(path, {}, baseUrl),
        );
        const r = response as any;
        let itens: any[];
        switch (params.tipo) {
          case "licencas":
            itens = digArrayRoot(
              r,
              [["LicencaParlamentar", "Parlamentar", "Licencas", "Licenca"]],
              "senado_senador_historico:licencas",
            ).map(parseLicenca);
            break;
          case "comissoes":
            itens = ensureArray(r?.MembroComissaoParlamentar?.Parlamentar?.MembroComissoes?.Comissao).map(parseComissaoMembro);
            break;
          case "cargos":
            itens = ensureArray(r?.CargoParlamentar?.Parlamentar?.Cargos?.Cargo).map(parseCargoSenador);
            break;
          case "filiacoes":
            itens = ensureArray(r?.FiliacaoParlamentar?.Parlamentar?.Filiacoes?.Filiacao ?? r?.Filiacoes?.Filiacao).map(parseFiliacao);
            break;
          case "profissoes":
            // Anomalous root: /profissao responds under HistoricoAcademicoParlamentar
            // (same wrapper as historico-academico), not ProfissaoParlamentar.
            itens = digArrayRoot(
              r,
              [
                ["HistoricoAcademicoParlamentar", "Parlamentar", "Profissoes", "Profissao"],
                ["ProfissaoParlamentar", "Parlamentar", "Profissoes", "Profissao"],
                ["Profissoes", "Profissao"],
              ],
              "senado_senador_historico:profissoes",
            ).map(parseProfissao);
            break;
          default: {
            const p = r?.HistoricoAcademicoParlamentar?.Parlamentar;
            itens = ensureArray(p?.HistoricoAcademico?.Curso ?? p?.Cursos?.Curso);
            break;
          }
        }
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, path, {
          dataset_id: `codigoParlamentar=${params.codigoSenador}; tipo=${params.tipo}`,
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance(
          { codigoSenador: params.codigoSenador, tipo: params.tipo, count: itens.length, itens },
          prov,
        );
      } catch (e) {
        return errorFrom(e, "Erro ao obter histórico do senador");
      }
    },
  );

  // A7. senado_senadores_afastados
  server.tool(
    "senado_senadores_afastados",
    "Lista os senadores atualmente afastados (fora de exercício). Retorna `{ count, senadores }`, cada item com `codigo`, `nome`, `nomeCompleto`, `partido`, `uf`, `foto` e `emExercicio` (sempre `false`). Não requer parâmetros. Atenção: é a lista BRUTA do upstream, sem recorte de legislatura — pode conter registros históricos (ex.: senadores falecidos) e inconsistências pontuais com o detalhe do parlamentar; também não traz o vínculo titular↔suplente (para saber quem assumiu a vaga, consulte os mandatos em `senado_obter_senador`). Use `codigo` em `senado_obter_senador` para o detalhe; para os senadores em exercício (e busca por nome) use `senado_listar_senadores`.",
    {},
    async () => {
      try {
        const { value: response, fetchedAt } = await lerListaOficial(PATH_SENADORES_AFASTADOS);
        const senadores = extractParlamentares(response).map((p) => parseSenadorResumo(p, false));
        const prov = provenanceFor("SENADO_LEGIS", baseUrl, PATH_SENADORES_AFASTADOS, {
          retrieved_at: fetchedAt,
        });
        return resultWithProvenance({ count: senadores.length, senadores }, prov);
      } catch (e) {
        return errorFrom(e, "Erro ao listar senadores afastados");
      }
    },
  );
}
