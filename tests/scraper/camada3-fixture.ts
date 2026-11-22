/**
 * Um D1 de verdade em miniatura para os testes da D3: SQLite do Node (`node:sqlite`) atrás da mesma
 * interface que o Worker usa (`prepare().bind().all()/first()`), com as tabelas da camada 3 criadas
 * e povoadas pelo PRÓPRIO SQL que a projeção gera (`planejar`) — o teste cobre projeção e leitura juntas.
 */

import { DatabaseSync } from "node:sqlite";
import { PROJETADAS, planejar, projetarLinhas } from "../../scripts/publicacao/projecao.js";

export function d1De(db: DatabaseSync): D1Database {
  const preparar = (sql: string) => {
    const com = (args: unknown[]) => ({
      bind: (...a: unknown[]) => com(a),
      all: async () => ({ results: db.prepare(sql).all(...(args as never[])).map((r) => ({ ...r })) }),
      first: async () => {
        const r = db.prepare(sql).get(...(args as never[]));
        return r ? { ...r } : null;
      },
    });
    return com([]);
  };
  return { prepare: preparar } as unknown as D1Database;
}

/** Completa uma linha com null nas colunas do dicionário que o teste não deu. */
function cheia(caminho: string, l: Record<string, unknown>): Record<string, unknown> {
  const t = PROJETADAS.find((x) => x.caminho === caminho)!;
  return Object.fromEntries(t.dic.colunas.map((c) => [c.nome, l[c.nome] ?? null]));
}

export const GERADO_EM = "2026-11-22T16:00:00.000Z";

/** Cria as tabelas (via projeção) com as linhas dadas por caminho; tabela sem linhas não é criada. */
export function bancoC3(linhas: Record<string, Record<string, unknown>[]>, corpus: Array<{ entidade: string; id: number; scrapedAt: string; payload: unknown }> = []): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE ecidadania_current (entidade TEXT, entity_id INTEGER, scraped_at TEXT, payload_json TEXT, status TEXT)");
  const ins = db.prepare("INSERT INTO ecidadania_current (entidade, entity_id, scraped_at, payload_json, status) VALUES (?,?,?,?,?)");
  for (const c of corpus) ins.run(c.entidade, c.id, c.scrapedAt, JSON.stringify(c.payload), (c.payload as { status?: string }).status ?? null);
  for (const [caminho, ls] of Object.entries(linhas)) {
    const t = PROJETADAS.find((x) => x.caminho === caminho)!;
    const plano = planejar(t, projetarLinhas(t, ls.map((l) => cheia(caminho, l))), null, { geradoEm: GERADO_EM, aplicadoEm: GERADO_EM });
    for (const sql of plano.arquivos) db.exec(sql);
  }
  return db;
}

const R = "2026-11-21T10:00:00.000Z";
const D = "2026-11-20T09:00:00.000Z";

/** Um conjunto pequeno e realista das tabelas que o servidor lê. */
export function linhasDeExemplo(): Record<string, Record<string, unknown>[]> {
  return {
    "ideias/ideias": [
      {
        id: 100, titulo: "Ideia convertida", descricao: "texto inteiro", status: "convertida", dataProposta: "2020-01-02", autorNome: "ANA B.", autorUf: "SP",
        apoios: 25000, prazoApoios: "2020-05-01", data20mil: "2020-03-01", dataSugestao: "2020-04-01", sugestaoNumero: 12, sugestaoAno: 2020,
        dataDecisaoCdh: "2021-01-01", decisaoCdh: "transformou", dataPublicacao: "2020-05-01", url: "https://www12.senado.leg.br/ecidadania/visualizacaoideia?id=100",
        firstSeenAt: "2026-06-14T00:00:00.000Z", origemResumo: "listagem", coletadoEmResumo: R, origemDetalhe: "arquivo", coletadoEmDetalhe: D,
      },
      {
        id: 200, titulo: "Ideia aberta", status: "aberta", apoios: 40, prazoApoios: "2027-01-01", dataPublicacao: "2027-01-01", autorUf: "RJ",
        url: "https://www12.senado.leg.br/ecidadania/visualizacaoideia?id=200", origemResumo: "listagem", coletadoEmResumo: R,
        origemDetalhe: "corpus", coletadoEmDetalhe: "2026-09-01T00:00:00.000Z",
      },
      {
        id: 300, titulo: "Ideia encerrada", status: "encerrada", apoios: 3, url: "https://www12.senado.leg.br/ecidadania/visualizacaoideia?id=300",
        origemResumo: "corpus", coletadoEmResumo: "2026-08-01T00:00:00.000Z",
      },
    ],
    "ideias/proposicoes": [
      { id: 100, data: "2021-01-01", transformadaPor: "Comissão", tipoSigla: "PL", tipoNome: "Projeto de Lei", numero: "45", ano: 2021, origem: "arquivo" },
      { id: 100, data: "2022-02-02", transformadaPor: "Senador", sexo: "masculino", parlamentar: "FULANO", parlamentarUf: "MG", tipoSigla: "PEC", tipoNome: "Proposta", numero: "3", ano: 2022, origem: "arquivo" },
    ],
    "ideias/linha-do-tempo": [
      { id: 100, ordem: 0, data: "2022-02-02", tipo: "adocao", texto: "Ideia transformada em PEC por Senador" },
      { id: 100, ordem: 1, data: "2021-01-01", tipo: "cdhTransformou", texto: "Ideia transformada em PL pela Comissão" },
      { id: 100, ordem: 2, data: "2020-04-01", tipo: "sugestao", texto: "Essa ideia gerou a Sugestão nº 12, de 2020" },
      { id: 100, ordem: 3, data: "2020-03-01", tipo: "meta", texto: "Ideia alcançou 20.000 apoios" },
      { id: 100, ordem: 4, data: "2020-02-01", tipo: "naoReconhecido", texto: "Algo novo no portal" },
      { id: 100, ordem: 5, data: "2020-01-02", tipo: "proposta", texto: "Ideia proposta por ANA B. (SP)" },
    ],
    "ideias/serie-apoios": [
      { entity_id: "100", origem: "corpus", apoios: 24000, desde: "2026-06-14T00:00:00.000Z", ate: "2026-06-14T00:00:00.000Z", leituras: 1 },
      { entity_id: "100", origem: "corpus", apoios: 25000, desde: "2026-07-01T00:00:00.000Z", ate: "2026-07-01T00:00:00.000Z", leituras: 1 },
      { entity_id: "100", origem: "listagem-s10", apoios: 25000, desde: "2026-10-30T00:00:00.000Z", ate: R, leituras: 20 },
      { entity_id: "100", origem: "detalhe", apoios: 25000, desde: D, ate: D, leituras: 1 },
    ],
    "ideias/historico-situacao": [
      { entity_id: "100", origem: "corpus", status: "aberta", desde: "2026-06-14T00:00:00.000Z", ate: "2026-06-14T00:00:00.000Z", leituras: 1 },
      { entity_id: "100", origem: "corpus", status: "convertida", desde: "2026-07-01T00:00:00.000Z", ate: "2026-07-01T00:00:00.000Z", leituras: 1 },
      { entity_id: "100", origem: "listagem", situacao_codigo: "10", situacao_nome: "Transformadas em proposição", desde: "2026-10-30T00:00:00.000Z", ate: R, leituras: 20 },
    ],
    "consultas/consultas": [
      {
        id: 5000, materia: "PL 1/2024", ementa: "Ementa A", votosSim: 70, votosNao: 30, totalVotos: 100, percentualSim: 70, percentualNao: 30,
        autoria: "Senador X", status: "aberta", url: "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=5000",
        origemResumo: "arquivo", coletadoEmResumo: R, origemDetalhe: "arquivo", coletadoEmDetalhe: D,
      },
      {
        id: 4000, materia: "PL 9/2020", ementa: "Ementa B", votosSim: 0, votosNao: 0, totalVotos: 0, status: "encerrada",
        url: "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=4000", origemResumo: "corpus", coletadoEmResumo: "2026-07-01T00:00:00.000Z",
      },
    ],
    "consultas/serie-votos": [
      { id: 5000, voto: "SIM", votos: 60, desde: "2026-06-14T00:00:00.000Z", ate: "2026-06-14T00:00:00.000Z", leituras: 1, origem: "corpus" },
      { id: 5000, voto: "NAO", votos: 30, desde: "2026-06-14T00:00:00.000Z", ate: "2026-06-14T00:00:00.000Z", leituras: 1, origem: "corpus" },
      { id: 5000, voto: "SIM", votos: 70, desde: "2026-11-20T00:00:00.000Z", ate: R, leituras: 3, origem: "listagem" },
      { id: 5000, voto: "NAO", votos: 30, desde: "2026-11-20T00:00:00.000Z", ate: R, leituras: 3, origem: "listagem" },
    ],
    "eventos/eventos": [
      {
        id: 900, titulo: "Audiência", data: "2026-11-25", hora: "10:00", comissao: "CDH", comissaoNomeCompleto: "Comissão de Direitos Humanos",
        local: "Plenário 2", descricao: "Debate", comentarios: 12, status: "agendado", url: "https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id=900",
        origemResumo: "listagem", coletadoEmResumo: R, origemDetalhe: "arquivo", coletadoEmDetalhe: D, origemComentarios: "arquivo", coletadoEmComentarios: D,
      },
    ],
    "eventos/pauta": [
      { id: 900, ordem: 1, texto: "Segundo item", origem: "arquivo" },
      { id: 900, ordem: 0, texto: "Primeiro item", origem: "arquivo" },
    ],
    "eventos/convidados": [{ id: 900, ordem: 0, texto: "Fulana, Ministra", origem: "arquivo" }],
    "consultas_votos/materias": [
      {
        codigo: 77, materia: "PLS 1/2015", ementa: "Ementa acervo", autoria: "Senador Y", status: "Descontinuado", referencePeriod: "2026-11-01",
        votosSim: 15, votosNao: 5, totalVotos: 20, url: "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=77", origem: "csv", coletadoEm: D,
      },
      {
        codigo: 78, materia: "PLS 2/2015", ementa: "Outra", autoria: "Senador Z", status: "Descontinuado", referencePeriod: "2026-11-01",
        votosSim: 1, votosNao: 1, totalVotos: 2, url: "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=78", origem: "csv", coletadoEm: D,
      },
    ],
    "consultas_votos/votos-uf": [
      { codigo: 77, uf: "SP", sim: 9, nao: 1, desde: "2026-10-01T00:00:00.000Z", ate: "2026-10-01T00:00:00.000Z", leituras: 1, origem: "csv" },
      { codigo: 77, uf: "SP", sim: 10, nao: 2, desde: D, ate: D, leituras: 1, origem: "csv" },
      { codigo: 77, uf: "RJ", sim: 5, nao: 3, desde: D, ate: D, leituras: 1, origem: "csv" },
      { codigo: 78, uf: "RJ", sim: 1, nao: 1, desde: D, ate: D, leituras: 1, origem: "csv" },
    ],
  };
}
