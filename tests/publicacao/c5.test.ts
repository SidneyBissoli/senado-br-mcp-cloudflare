import { describe, it, expect } from "vitest";
import { fundir, type Leitura } from "../../scripts/observacoes/fundir.js";
import type { Fato, Fonte } from "../../scripts/observacoes/fatos.js";
import { percentual } from "../../scripts/publicacao/comum.js";
import { pontosDoCorpus, tabelasDasConsultas, type ConsultaDoCorpus } from "../../scripts/publicacao/consultas.js";
import { tabelasDosEventos, type EventoDoCorpus } from "../../scripts/publicacao/eventos.js";
import { tabelaDeVotosUf } from "../../scripts/publicacao/votos-uf.js";

let n = 0;
const dia = (d: number) => `2026-11-${String(d).padStart(2, "0")}T18:00:00.000Z`;
const leitura = (entidade: string, id: string, fonte: Fonte, d: number, fatos: Fato[]): Leitura => ({
  indice: ++n, instante: dia(d), sha256: `sha${n}`, entidade, entityId: id, fonte, fatos,
});
const f = (o: Record<string, string | null>): Fato[] => Object.entries(o).map(([campo, valor]) => ({ campo, valor }));

describe("D1 — consultas", () => {
  const lst = (id: string, d: number, sim: number, nao: number) => leitura("consultas", id, "listagem", d, f({ identificacao: "PL 1/2026", ementa: "E", votosSim: String(sim), votosNao: String(nao) }));
  const corpus = (id: string, extra: Partial<ConsultaDoCorpus> = {}): ConsultaDoCorpus => ({
    entityId: id, scrapedAt: "2026-07-01T00:00:00.000Z", materia: "PLS 9/2015", ementa: "Ec", votosSim: 7, votosNao: 3, autoria: "Senador X", relator: null, status: "encerrada", ...extra,
  });

  it("listagem do arquivo + autoria do corpus; percentual com uma casa", () => {
    const obs = fundir([], [lst("1", 1, 10, 10), lst("1", 2, 126, 124)]);
    const c = tabelasDasConsultas(obs, [corpus("1", { status: "aberta" })], [], new Map()).consultas[0];
    expect([c.materia, c.votosSim, c.votosNao, c.totalVotos, c.percentualSim, c.percentualNao, c.origemResumo, c.coletadoEmResumo]).toEqual(["PL 1/2026", 126, 124, 250, 50.4, 49.6, "arquivo", dia(2)]);
    expect([c.autoria, c.origemDetalhe, c.status]).toEqual(["Senador X", "corpus", "aberta"]);
  });

  it("encerrada fora da listagem: tudo do corpus; detalhe do arquivo quando lido; sem votos o percentual é null", () => {
    const obs = fundir([], [leitura("consultas", "2", "detalhe", 3, f({ statusHttp: "200", autoria: "Câmara dos Deputados" }))]);
    const c = tabelasDasConsultas(obs, [corpus("2", { votosSim: 0, votosNao: 0 })], [], new Map()).consultas[0];
    expect([c.materia, c.origemResumo, c.autoria, c.origemDetalhe, c.coletadoEmDetalhe]).toEqual(["PLS 9/2015", "corpus", "Câmara dos Deputados", "arquivo", dia(3)]);
    expect([c.totalVotos, c.percentualSim, c.percentualNao]).toEqual([0, null, null]);
    expect(percentual(1, 3)).toBe(33.3);
  });

  it("série de votos: arquivo (intervalos) + corpus (um ponto por mudança, por voto)", () => {
    const obs = fundir([], [lst("3", 1, 5, 1), lst("3", 2, 5, 2)]);
    const s = tabelasDasConsultas(obs, [], [
      { entityId: "3", scrapedAt: "2026-07-01T00:00:00.000Z", votosSim: 1, votosNao: 0 },
      { entityId: "3", scrapedAt: "2026-07-02T00:00:00.000Z", votosSim: 1, votosNao: 1 },
    ], new Map()).serieVotos;
    expect(s.map((p) => [p.voto, p.votos, p.origem, p.desde.slice(5, 10), p.leituras])).toEqual([
      ["NAO", 0, "corpus", "07-01", 1], ["NAO", 1, "corpus", "07-02", 1], ["NAO", 1, "listagem", "11-01", 1], ["NAO", 2, "listagem", "11-02", 1],
      ["SIM", 1, "corpus", "07-01", 1], ["SIM", 5, "listagem", "11-01", 2],
    ]);
    expect(pontosDoCorpus([])).toEqual([]);
  });
});

describe("D1 — eventos", () => {
  const item = (posicao: number, texto: string) => JSON.stringify({ posicao, texto });
  const det = (id: string, d: number, convidados: string[]) =>
    leitura("eventos", id, "detalhe", d, [
      ...f({ statusHttp: "200", titulo: "Audiência", descricao: "Desc", data: "2026-11-24", hora: "14:00", comissao: "CE", comissaoNomeCompleto: "Comissão de Educação", local: "Ala X", status: "agendado", videoUrl: null }),
      ...convidados.map((c, i) => ({ campo: "convidado", valor: item(i, c) })),
    ]);
  const com = (id: string, d: number, ids: number[]) =>
    leitura("eventos", id, "comentarios", d, [
      { campo: "comentarios", valor: String(ids.length) },
      ...ids.map((c) => ({ campo: "comentario", valor: JSON.stringify({ id: c, uf: "SP", data: "2026-11-01", hora: "10:00", texto: `t${c}`, momentoVideoUrl: null, convidadoAssociado: null }) })),
    ]);
  const corpus = (id: string): EventoDoCorpus => ({
    entityId: id, scrapedAt: "2026-07-01T00:00:00.000Z", titulo: "Antigo", data: "2025-01-01", hora: "09:00", comissao: "CAS", comissaoNomeCompleto: null,
    local: null, descricao: null, pauta: JSON.stringify(["p1", "p2"]), convidados: "[]", videoUrl: null, comentarios: 2, status: "encerrado",
  });

  it("três blocos do arquivo; convidados na ordem da página (não na do valor)", () => {
    const obs = fundir([], [det("1", 1, ["Zélia", "Ana"]), com("1", 2, [7, 5])]);
    const t = tabelasDosEventos(obs, [], [], new Map());
    const e = t.eventos[0];
    expect([e.titulo, e.origemResumo, e.data, e.hora, e.comissaoNomeCompleto, e.origemDetalhe, e.comentarios, e.origemComentarios, e.coletadoEmComentarios]).toEqual([
      "Audiência", "detalhe", "2026-11-24", "14:00", "Comissão de Educação", "arquivo", 2, "arquivo", dia(2),
    ]);
    expect(t.convidados.map((c) => [c.ordem, c.texto])).toEqual([[0, "Zélia"], [1, "Ana"]]);
    expect(t.comentarios.map((c) => c.comentarioId)).toEqual(["5", "7"]);
  });

  it("sem nada no arquivo: corpus em todos os blocos, comentários do corpus", () => {
    const t = tabelasDosEventos([], [corpus("2")], [{ eventoId: "2", comentarioId: "9", uf: "RJ", data: null, hora: null, texto: "x", momentoVideoUrl: null, convidadoAssociado: null }], new Map());
    expect([t.eventos[0].origemResumo, t.eventos[0].origemDetalhe, t.eventos[0].origemComentarios, t.eventos[0].comentarios]).toEqual(["corpus", "corpus", "corpus", 2]);
    expect(t.pauta.map((p) => [p.ordem, p.texto, p.origem])).toEqual([[0, "p1", "corpus"], [1, "p2", "corpus"]]);
    expect(t.comentarios.map((c) => [c.comentarioId, c.origem])).toEqual([["9", "corpus"]]);
  });
});

describe("D1 — votos por UF", () => {
  const csv = (d: number, sp: number) =>
    leitura("consultas_votos", "10", "csv", d, [
      ...f({ materia: "SUG 1/2026", status: "Descontinuado" }),
      { campo: "votosUf", valor: JSON.stringify({ uf: "SP", sim: sp, nao: 0 }) },
      { campo: "votosUf", valor: JSON.stringify({ uf: "RJ", sim: 1, nao: 1 }) },
    ]);

  it("longo: matéria × UF × intervalo de versões; matéria fora do arquivo vem do corpus", () => {
    const obs = fundir([], [csv(1, 3), csv(8, 3), csv(15, 4)]);
    const r = tabelaDeVotosUf(obs, [
      { entityId: "10", scrapedAt: "2026-11-19T00:00:00.000Z", materia: "x", status: "y", votosPorUf: "{}" },
      { entityId: "11", scrapedAt: "2026-11-19T00:00:00.000Z", materia: "PL 2/2020", status: "Encerrada", votosPorUf: JSON.stringify({ AC: { sim: 2, nao: 0 } }) },
    ]);
    expect(r.map((l) => [l.codigo, l.uf, l.sim, l.desde.slice(8, 10), l.ate.slice(8, 10), l.leituras, l.origem])).toEqual([
      ["10", "RJ", 1, "01", "15", 3, "csv"], ["10", "SP", 3, "01", "08", 2, "csv"], ["10", "SP", 4, "15", "15", 1, "csv"],
      ["11", "AC", 2, "19", "19", 1, "corpus"],
    ]);
    expect(r[0].materia).toBe("SUG 1/2026");
  });
});
