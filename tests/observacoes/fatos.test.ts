import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fatosDaListagem, fatosDoDetalhe, fonteDaUrl, situacaoDaUrl, statusObservavel, versaoDoLeitor,
} from "../../scripts/observacoes/fatos.js";
import { leiturasDaLinha, sqlDoLote, type Contagem } from "../../scripts/observacoes/linhas.js";
import { fundir } from "../../scripts/observacoes/fundir.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "ecidadania");
const fx = (nome: string) => readFileSync(join(FIXTURES, nome), "utf8");
const detalhe = (nome: string) => fx(`ideias-detalhe-2026-10/${nome}`);
const valor = (fatos: { campo: string; valor: string | null }[], campo: string) => fatos.filter((f) => f.campo === campo).map((f) => f.valor);
const contagem = (): Contagem => ({ linhasDoIndice: 0, ignoradas: 0, detalhe: 0, listagem: 0, leiturasDeSerie: 0, erroLeitura: 0, listagemForaDoMolde: 0 });

describe("fatos do detalhe (páginas reais de 17/10/2026)", () => {
  it("ideia convertida por deputada e senadora: campos, linha do tempo e proposições", () => {
    const f = fatosDoDetalhe(200, detalhe("adotada-deputada-senadora-144418.html"));
    expect(valor(f, "statusHttp")).toEqual(["200"]);
    expect(valor(f, "titulo")[0]).toBeTruthy();
    expect(valor(f, "proposicao")).toHaveLength(2);
    const acontecimentos = valor(f, "acontecimento").map((v) => JSON.parse(v!));
    // Posição cronológica: 0 = o mais antigo (a proposta), contado de baixo.
    expect(acontecimentos.map((a) => a.posicao).sort((x, y) => x - y)).toEqual(acontecimentos.map((_, i) => i));
    expect(acontecimentos.find((a) => a.posicao === 0).tipo).toBe("proposta");
    for (const p of valor(f, "proposicao").map((v) => JSON.parse(v!))) expect(acontecimentos[acontecimentos.length - 1 - p.posicao]).toBeDefined();
  });

  it("um acontecimento novo no topo NÃO muda os fatos dos antigos", () => {
    const html = detalhe("aberta-221186.html");
    const antes = valor(fatosDoDetalhe(200, html), "acontecimento");
    const novoItem = '<li class="timeline-item active"><time datetime="2026-11-20">20/11/2026</time>Ideia alcançou 20.000 apoios</li>';
    const comNovo = html.replace('timeline-item active"', 'timeline-item"').replace('<ol class="timeline">', `<ol class="timeline">${novoItem}`);
    const depois = valor(fatosDoDetalhe(200, comNovo), "acontecimento");
    expect(depois.length).toBe(antes.length + 1);
    for (const a of antes) expect(depois).toContain(a);
  });

  it("410 e 404: só o status; página que o leitor recusa vira erroLeitura", () => {
    expect(fatosDoDetalhe(410, detalhe("removida-220396.html"))).toEqual([{ campo: "statusHttp", valor: "410" }]);
    expect(fatosDoDetalhe(404, "")).toEqual([{ campo: "statusHttp", valor: "404" }]);
    const f = fatosDoDetalhe(200, "<html>sem linha do tempo</html>");
    expect(valor(f, "statusHttp")).toEqual(["200"]);
    expect(valor(f, "erroLeitura")[0]).toMatch(/fora do molde/);
  });

  it("autor no exterior e oficina: copiados como o portal publica", () => {
    expect(valor(fatosDoDetalhe(200, detalhe("autor-exterior-62016.html")), "autorUf")).toEqual(["Exterior"]);
    const oficina = valor(fatosDoDetalhe(200, detalhe("oficina-medio-240545.html")), "oficina")[0];
    expect(JSON.parse(oficina!)).toHaveProperty("nivel");
  });

  it("toda fixture 200 dá fatos sem erroLeitura", () => {
    for (const nome of readdirSync(join(FIXTURES, "ideias-detalhe-2026-10"))) {
      if (nome.startsWith("removida")) continue;
      expect(valor(fatosDoDetalhe(200, detalhe(nome)), "erroLeitura"), nome).toEqual([]);
    }
  });
});


describe("fatos da listagem", () => {
  const url = "https://www12.senado.leg.br/ecidadania/pesquisaideia?situacao=5&p=3";
  it("situação vem da URL; título e apoios por ideia", () => {
    expect(situacaoDaUrl(url)).toBe("5");
    expect(situacaoDaUrl("https://www12.senado.leg.br/ecidadania/pesquisaideia?p=3")).toBeNull();
    const porId = fatosDaListagem(url, fx("ideias-listing-2026-10.html"));
    expect(porId.size).toBeGreaterThan(0);
    for (const fatos of porId.values()) {
      expect(fatos.map((f) => f.campo)).toEqual(["situacao", "titulo", "apoios"]);
      expect(fatos[0].valor).toBe("5");
      expect(fatos[2].valor).toMatch(/^\d+$/);
    }
  });

  it("listagem fora do molde não derruba o lote: conta e segue", () => {
    const c = contagem();
    const html = '<li class="resumo-ideia"><a href="visualizacaoideia?id=5">sem título nem apoios</a></li>';
    const l = { id: 1, url, entity_id: null, instante: "2026-11-01T00:00:00.000Z", status_http: 200, sha256: "s", formato: null, referencia: null };
    expect(leiturasDaLinha(l, html, c)).toEqual([]);
    expect(c.listagemForaDoMolde).toBe(1);
  });

  it("uma página de listagem vira uma leitura por ideia, todas com o mesmo índice", () => {
    const c = contagem();
    const l = { id: 9, url, entity_id: null, instante: "2026-11-01T00:00:00.000Z", status_http: 200, sha256: "s", formato: null, referencia: null };
    const ls = leiturasDaLinha(l, fx("ideias-listing-2026-10.html"), c);
    expect(ls.length).toBeGreaterThan(1);
    expect(new Set(ls.map((x) => x.indice))).toEqual(new Set([9]));
    expect(fundir([], ls).length).toBe(ls.length * 3);
  });
});

describe("escopo e versão", () => {
  it("fonte pela URL; só status que observa alguma coisa", () => {
    expect(fonteDaUrl("https://www12.senado.leg.br/ecidadania/visualizacaoideia?id=1")).toBe("detalhe");
    expect(fonteDaUrl("https://www12.senado.leg.br/ecidadania/pesquisaideia?situacao=7&p=2")).toBe("listagem");
    expect(fonteDaUrl("https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id=1")).toBeNull();
    expect(statusObservavel("detalhe", 410)).toBe(true);
    expect(statusObservavel("detalhe", 500)).toBe(false);
    expect(statusObservavel("listagem", 404)).toBe(false);
  });

  it("versão do leitor é estável e com o formato observacoes@<12 hex>", () => {
    expect(versaoDoLeitor()).toMatch(/^observacoes@[0-9a-f]{12}$/);
    expect(versaoDoLeitor()).toBe(versaoDoLeitor());
  });

  it("SQL do lote só aceita inteiros", () => {
    expect(sqlDoLote(10, 2000)).toContain("i.id > 10 ORDER BY i.id LIMIT 2000");
    expect(() => sqlDoLote(Number("1 OR 1"), 1)).toThrow();
  });
});
