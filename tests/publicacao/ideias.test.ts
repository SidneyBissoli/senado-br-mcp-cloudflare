import { describe, it, expect } from "vitest";
import { fundir, type Leitura } from "../../scripts/observacoes/fundir.js";
import type { Fato, Fonte } from "../../scripts/observacoes/fatos.js";
import { situacoesAtuais, sugestaoDoCorpus, tabelasDasIdeias, type IdeiaDoCorpus } from "../../scripts/publicacao/ideias.js";

let n = 0;
const leitura = (id: string, fonte: Fonte, dia: number, fatos: Fato[]): Leitura => ({
  indice: ++n, instante: `2026-11-${String(dia).padStart(2, "0")}T18:00:00.000Z`, sha256: `sha${n}`, entidade: "ideias", entityId: id, fonte, fatos,
});
const dia = (d: number) => `2026-11-${String(d).padStart(2, "0")}T18:00:00.000Z`;
const acont = (posicao: number, texto: string) => ({ campo: "acontecimento", valor: JSON.stringify({ posicao, data: `2026-0${posicao + 1}-01`, tipo: "t", texto }) });
const detalhe = (id: string, d: number, extra: Partial<Record<string, string | null>> = {}, acontecimentos: Fato[] = []): Leitura =>
  leitura(id, "detalhe", d, [
    { campo: "statusHttp", valor: "200" },
    ...Object.entries({
      titulo: "Título", descricao: "Desc", apoios: "10", autorNome: "PEDRO H. S. V.", autorUf: "SP", dataProposta: "2026-01-01",
      prazoApoios: "2026-05-01", dataMeta: null, meta: "20000", sugestao: null, decisaoCdh: null, encerramento: null, oficina: null, ...extra,
    }).map(([campo, valor]) => ({ campo, valor })),
    ...acontecimentos,
  ]);
const lst = (id: string, sit: number, d: number, apoios: number, titulo = "Título") =>
  leitura(id, `listagem-s${sit}`, d, [{ campo: "titulo", valor: titulo }, { campo: "apoios", valor: String(apoios) }]);
const corpus = (id: string, extra: Partial<IdeiaDoCorpus> = {}): IdeiaDoCorpus => ({
  entityId: id, scrapedAt: "2026-10-01T00:00:00.000Z", titulo: "T corpus", apoios: 3, status: "encerrada", dataPublicacao: "2020-05-01",
  autorUf: "RJ", descricao: "D corpus", plConvertido: null, proposicoes: null, ...extra,
});

describe("D1 — tabelas publicadas das ideias", () => {
  it("arquivo: resumo da leitura mais recente, detalhe completo, linha do tempo na ordem da página", () => {
    const obs = fundir([], [
      detalhe("1", 1, { sugestao: JSON.stringify({ numero: "12", ano: "2024", data: "2024-03-01", url: null }), dataMeta: "2024-02-01" }, [acont(0, "proposta"), acont(1, "meta")]),
      lst("1", 5, 2, 25, "Título novo"),
    ]);
    const t = tabelasDasIdeias(obs, [corpus("1")], new Map([["1", "2026-06-29T00:00:00.000Z"]]));
    const i = t.ideias[0];
    expect([i.titulo, i.apoios, i.origemResumo, i.coletadoEmResumo]).toEqual(["Título novo", 25, "listagem", dia(2)]);
    expect([i.descricao, i.autorNome, i.autorUf, i.prazoApoios, i.dataPublicacao, i.data20mil, i.origemDetalhe, i.coletadoEmDetalhe]).toEqual([
      "Desc", "PEDRO H. S. V.", "SP", "2026-05-01", "2026-05-01", "2024-02-01", "arquivo", dia(1),
    ]);
    expect([i.sugestaoNumero, i.sugestaoAno, i.dataSugestao, i.status, i.firstSeenAt]).toEqual([12, 2024, "2024-03-01", "encerrada", "2026-06-29T00:00:00.000Z"]);
    expect(i.url).toBe("https://www12.senado.leg.br/ecidadania/visualizacaoideia?id=1");
    expect(t.linhaDoTempo.map((a) => [a.ordem, a.texto])).toEqual([[0, "meta"], [1, "proposta"]]);
  });

  it("um 410 depois não apaga o que a página mostrou; a leitura recusada não conta", () => {
    const obs = fundir([], [
      detalhe("2", 1, { descricao: "antes" }),
      leitura("2", "detalhe", 2, [{ campo: "statusHttp", valor: "200" }, { campo: "erroLeitura", valor: "fora do molde" }]),
      leitura("2", "detalhe", 3, [{ campo: "statusHttp", valor: "410" }]),
    ]);
    const i = tabelasDasIdeias(obs, [corpus("2", { status: "removida" })], new Map()).ideias[0];
    expect([i.descricao, i.origemDetalhe, i.coletadoEmDetalhe, i.status]).toEqual(["antes", "arquivo", dia(1), "removida"]);
  });

  it("só vale o que estava na última leitura aberta (acontecimento que sumiu sai; valor que mudou é o novo)", () => {
    const obs = fundir([], [
      detalhe("3", 1, { autorUf: "SP" }, [acont(0, "a"), acont(1, "b")]),
      detalhe("3", 2, { autorUf: "Exterior" }, [acont(0, "a")]),
    ]);
    const t = tabelasDasIdeias(obs, [], new Map());
    expect(t.ideias[0].autorUf).toBe("Exterior");
    expect(t.linhaDoTempo.map((a) => a.texto)).toEqual(["a"]);
    expect([t.ideias[0].status, t.ideias[0].firstSeenAt]).toEqual([null, null]);
  });

  it("sem nada no arquivo: tudo do corpus, com a origem declarada e os campos que o corpus nunca guardou em null", () => {
    const props = JSON.stringify([{ ordem: 0, tipoSigla: "PL", numero: "2", ano: 2025 }, { ordem: 1, tipoSigla: "PEC", numero: "1", ano: 2024 }]);
    const t = tabelasDasIdeias([], [corpus("4", { plConvertido: "SUG 7/2023", proposicoes: props })], new Map());
    const i = t.ideias[0];
    expect([i.titulo, i.apoios, i.origemResumo, i.descricao, i.autorUf, i.prazoApoios, i.origemDetalhe]).toEqual(["T corpus", 3, "corpus", "D corpus", "RJ", "2020-05-01", "corpus"]);
    expect([i.sugestaoNumero, i.sugestaoAno, i.autorNome, i.dataProposta, i.decisaoCdh]).toEqual([7, 2023, null, null, null]);
    expect(t.proposicoes.map((p) => [p.tipoSigla, p.ano, p.origem])).toEqual([["PEC", 2024, "corpus"], ["PL", 2025, "corpus"]]);
    expect(t.linhaDoTempo).toEqual([]);
  });

  it("linha mista: resumo do arquivo (listagem), detalhe do corpus", () => {
    const i = tabelasDasIdeias(fundir([], [lst("5", 7, 3, 99)]), [corpus("5")], new Map()).ideias[0];
    expect([i.apoios, i.origemResumo, i.descricao, i.origemDetalhe]).toEqual([99, "listagem", "D corpus", "corpus"]);
  });

  it("Parquet: instante e decimal opcionais aceitam null e voltam iguais", async () => {
    const { parquetReadObjects } = await import("hyparquet");
    const { escreverTabela } = await import("../../scripts/observacoes/parquet.js");
    const b = escreverTabela(
      [{ t: null, d: 50.4 }, { t: "2026-11-01T18:00:00.000Z", d: null }],
      [{ nome: "t", tipo: "instante", opcional: true, valor: (l: { t: string | null }) => l.t }, { nome: "d", tipo: "decimal", opcional: true, valor: (l: { d: number | null }) => l.d }],
      {},
    );
    const volta = (await parquetReadObjects({ file: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer })) as Record<string, unknown>[];
    expect(volta.map((r) => [r.t === null ? null : (r.t as Date).toISOString(), r.d])).toEqual([[null, 50.4], ["2026-11-01T18:00:00.000Z", null]]);
  });

  it("situação atual: as vistas no dia da avistagem mais recente; duas ao mesmo tempo = duas linhas", () => {
    const obs = fundir([], [lst("20", 5, 1, 1), lst("20", 5, 2, 1), lst("20", 6, 2, 1), lst("21", 5, 1, 1), lst("21", 8, 3, 1), lst("22", 7, 4, 0)]);
    expect(situacoesAtuais(obs).map((s) => [s.id, s.situacaoCodigo, s.situacaoNome, s.vistaEm.slice(8, 10)])).toEqual([
      ["20", "5", "Ideias abertas", "02"], ["20", "6", "Ideias em avaliação na CDH", "02"],
      ["21", "8", "Ideias aguardando envio à CDH", "03"],
      ["22", "7", "Ideias encerradas sem apoios suficientes", "04"],
    ]);
  });

  it("ordem por id numérico; sugestão do corpus fora do formato vira null", () => {
    const t = tabelasDasIdeias([], [corpus("10"), corpus("9")], new Map());
    expect(t.ideias.map((i) => i.id)).toEqual(["9", "10"]);
    expect(sugestaoDoCorpus("PL 1/2020")).toEqual({ numero: null, ano: null });
  });
});
