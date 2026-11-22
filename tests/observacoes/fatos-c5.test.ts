import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodificarC5, fatosDaListagemDeConsultas, fatosDaListagemDeEventos, fatosDoCsv, fatosDoDetalheDeEvento, fatosDosComentarios,
  fonteC5, leiturasC5, sqlDoLoteC5, statusObservavelC5, versaoDoLeitorC5, type LinhaC5,
} from "../../scripts/observacoes/fatos-c5.js";
import { fundir } from "../../scripts/observacoes/fundir.js";

const FX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "ecidadania");
const fx = (nome: string) => readFileSync(join(FX, nome), "utf8");
const campos = (fs: { campo: string }[]) => [...new Set(fs.map((f) => f.campo))];
const linha = (url: string, extra: Partial<LinhaC5> = {}): LinhaC5 => ({ id: 1, url, entity_id: null, instante: "2026-11-21T08:00:00.000Z", status_http: 200, sha256: "s", ...extra });
const E = "https://www12.senado.leg.br/ecidadania";

describe("C5 — fontes e escopo", () => {
  it("cada página da B4 tem a sua fonte; o processo.json fica fora", () => {
    expect(fonteC5("consultas", `${E}/pesquisamateria?p=3`)).toBe("listagem");
    expect(fonteC5("consultas", `${E}/visualizacaomateria?id=1`)).toBe("detalhe");
    expect(fonteC5("consultas", "https://legis.senado.leg.br/dadosabertos/processo.json?sigla=PL&tramitando=S")).toBeNull();
    expect(fonteC5("eventos", `${E}/principalaudiencia?p=1`)).toBe("listagem");
    expect(fonteC5("eventos", `${E}/visualizacaoaudiencia?id=9`)).toBe("detalhe");
    expect(fonteC5("eventos", `${E}/ajaxcolecaocomentarioaudiencia?audienciaId=9`)).toBe("comentarios");
    expect(fonteC5("consultas_votos", "https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv")).toBe("csv");
    expect(statusObservavelC5("detalhe", 410)).toBe(true);
    expect(statusObservavelC5("listagem", 500)).toBe(false);
  });

  it("versão por entidade: estável, e diferente entre entidades", () => {
    expect(versaoDoLeitorC5("eventos")).toMatch(/^observacoes-eventos@[0-9a-f]{12}$/);
    expect(versaoDoLeitorC5("eventos")).toBe(versaoDoLeitorC5("eventos"));
    expect(versaoDoLeitorC5("consultas")).not.toBe(versaoDoLeitorC5("consultas_votos"));
    expect(sqlDoLoteC5("eventos", 5, 10)).toContain("i.entidade = 'eventos' AND i.id > 5");
    expect(() => sqlDoLoteC5("ideias" as never, 1, 1)).toThrow();
  });
});

describe("C5 — fatos sobre as páginas reais", () => {
  it("consultas: votos SIM/NÃO por consulta na listagem", () => {
    const m = fatosDaListagemDeConsultas(fx("consultas-listing-p1.html"));
    expect(m.size).toBeGreaterThan(0);
    for (const fs of m.values()) expect(campos(fs)).toEqual(["votosSim", "votosNao", "identificacao", "ementa"]);
  });

  it("consultas: detalhe dá autoria; 410 dá só o status", () => {
    const [l] = leiturasC5("consultas", linha(`${E}/visualizacaomateria?id=123`), fx("consulta-detalhe.html"), { foraDoMolde: 0 });
    expect(l.entityId).toBe("123");
    expect(campos(l.fatos)).toEqual(["statusHttp", "autoria"]);
    const [r] = leiturasC5("consultas", linha(`${E}/visualizacaomateria?id=7`, { status_http: 410 }), "", { foraDoMolde: 0 });
    expect(r.fatos).toEqual([{ campo: "statusHttp", valor: "410" }]);
  });

  it("eventos: listagem com a situação decidida pelo INSTANTE da leitura (reprocessar dá o mesmo)", () => {
    const html = fx("eventos-listing-p1.html");
    const a = fatosDaListagemDeEventos(html, "2026-11-21T08:00:00.000Z");
    expect(a.size).toBeGreaterThan(0);
    for (const fs of a.values()) expect(campos(fs)).toEqual(["titulo", "data", "hora", "comissao", "comentarios", "status"]);
    expect(fatosDaListagemDeEventos(html, "2026-11-21T08:00:00.000Z")).toEqual(a);
  });

  it("eventos: detalhe com pauta e convidados como fatos próprios; comentários um a um, sem nome", () => {
    const d = fatosDoDetalheDeEvento(fx("evento-detalhe.html"));
    expect(d[0]).toEqual({ campo: "statusHttp", valor: "200" });
    expect(campos(d)).toEqual(expect.arrayContaining(["titulo", "data", "status"]));
    // Pauta e convidados levam a posição na página (a fusão ordena por valor e perderia a ordem).
    // A fixture real traz 5 convidados e pauta vazia.
    for (const [campo, n] of [["pauta", 0], ["convidado", 5]] as const) {
      const itens = d.filter((f) => f.campo === campo).map((f) => JSON.parse(f.valor!) as { posicao: number; texto: string });
      expect(itens).toHaveLength(n);
      expect(itens.map((i) => i.posicao)).toEqual(itens.map((_, k) => k));
      expect(itens.every((i) => typeof i.texto === "string" && i.texto.length > 0)).toBe(true);
    }
    const cs = fatosDosComentarios(fx("comentarios-audiencia.html"));
    const n = Number(cs[0].valor);
    expect(cs[0].campo).toBe("comentarios");
    expect(cs.filter((f) => f.campo === "comentario")).toHaveLength(n);
    for (const f of cs.slice(1)) expect(Object.keys(JSON.parse(f.valor!))).toEqual(["id", "uf", "data", "hora", "texto", "momentoVideoUrl", "convidadoAssociado"]);
    const [l] = leiturasC5("eventos", linha(`${E}/ajaxcolecaocomentarioaudiencia?audienciaId=31`), fx("comentarios-audiencia.html"), { foraDoMolde: 0 });
    expect(l.entityId).toBe("31");
  });

  it("acervo de votos por UF: um fato por UF; uma UF que muda não mexe nas outras", () => {
    // A fixture está em UTF-8 no repo; o portal serve windows-1252. Reencoda e prova a decodificação.
    const original = fx("consultas-votos-sample.csv");
    const texto = decodificarC5("csv", new Uint8Array(Buffer.from(original, "latin1")));
    expect(texto).toBe(original);
    const m = fatosDoCsv(texto);
    expect(m.size).toBeGreaterThan(0);
    const [id, fs] = [...m][0];
    expect(fs.slice(0, 2).map((f) => f.campo)).toEqual(["materia", "status"]);
    const ufs = fs.filter((f) => f.campo === "votosUf");
    expect(ufs.length).toBeGreaterThan(0);
    const v1 = { indice: 1, instante: "2026-11-16T05:00:00.000Z", sha256: "a", entidade: "consultas_votos", entityId: id, fonte: "csv" as const, fatos: fs };
    const mexida = fs.map((f, i) => (f === ufs[0] ? { campo: "votosUf", valor: JSON.stringify({ ...JSON.parse(f.valor!), sim: 999999 }) } : f));
    const obs = fundir([], [v1, { ...v1, indice: 2, instante: "2026-11-23T05:00:00.000Z", sha256: "b", fatos: mexida }]);
    const ufLinhas = obs.filter((o) => o.campo === "votosUf");
    expect(ufLinhas.filter((o) => o.leituras === 2)).toHaveLength(ufs.length - 1);
    expect(ufLinhas.filter((o) => o.leituras === 1)).toHaveLength(2);
  });

  it("página fora do molde não derruba o lote", () => {
    const c = { foraDoMolde: 0 };
    expect(leiturasC5("consultas_votos", linha("https://x/votos.csv"), "", c)).toEqual([]);
    expect(c.foraDoMolde).toBe(1);
  });
});
