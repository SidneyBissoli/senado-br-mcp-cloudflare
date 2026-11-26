/**
 * E1.c — fatos das respostas da autoria oficial (`scripts/observacoes/fatos-autoria.ts`), com respostas
 * reais recortadas em `tests/fixtures/autoria-2026-11/` (capturadas em 25/11/2026; valores intactos).
 * A consulta 176514 é o caso da decisão 4: texto da Câmara, iniciativa de um senador.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  fonteAutoria, idDaSerieAutoria, leiturasAutoria, sqlDoLoteAutoria, statusObservavelAutoria, versaoDoLeitorAutoria,
} from "../../scripts/observacoes/fatos-autoria.js";
import type { LinhaC5 } from "../../scripts/observacoes/fatos-c5.js";

const F = "tests/fixtures/autoria-2026-11";
const ler = (n: string) => readFileSync(`${F}/${n}`, "utf8");
const S = "https://legis.senado.leg.br/dadosabertos";
const linha = (url: string, status = 200, id = 1): LinhaC5 => ({ id, url, entity_id: null, instante: "2026-11-25T19:38:20.000Z", status_http: status, sha256: "a".repeat(64) });

describe("fonte e id da série", () => {
  it("as três respostas do job autoria; o resto fica fora", () => {
    expect(fonteAutoria(`${S}/processo?codigoMateria=176514`)).toBe("processos");
    expect(fonteAutoria(`${S}/processo/9133965`)).toBe("processo");
    expect(fonteAutoria(`${S}/processo/9133965.json`)).toBe("processo");
    expect(fonteAutoria("https://dadosabertos.camara.leg.br/api/v2/proposicoes/2295936/autores")).toBe("camara");
    expect(fonteAutoria(`${S}/processo.json?codigoMateria=1`)).toBeNull();
    expect(fonteAutoria("https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=1")).toBeNull();
    expect(idDaSerieAutoria("processos", `${S}/processo?codigoMateria=176514`)).toBe("176514");
    expect(idDaSerieAutoria("processo", `${S}/processo/9133965`)).toBe("9133965");
    expect(idDaSerieAutoria("camara", "https://dadosabertos.camara.leg.br/api/v2/proposicoes/2295936/autores")).toBe("2295936");
  });

  it("200 e 404 observam; 5xx não", () => {
    expect([200, 404, 500, 503].map(statusObservavelAutoria)).toEqual([true, true, false, false]);
  });
});

describe("leiturasAutoria", () => {
  it("lista: um fato processo por id, mais quantos", () => {
    const [l] = leiturasAutoria(linha(`${S}/processo?codigoMateria=176514`), ler("lista-176514.json"), { foraDoMolde: 0 });
    expect(l.entityId).toBe("176514");
    expect(l.fonte).toBe("processos");
    expect(l.fatos).toEqual([{ campo: "statusHttp", valor: "200" }, { campo: "quantos", valor: "1" }, { campo: "processo", valor: "9133965" }]);
  });

  it("detalhe 176514: as duas autorias, cada uma com o seu papel (decisão 4)", () => {
    const [l] = leiturasAutoria(linha(`${S}/processo/9133965`), ler("processo-9133965.json"), { foraDoMolde: 0 });
    const v = (c: string) => l.fatos.filter((f) => f.campo === c).map((f) => f.valor);
    expect(v("codigoMateria")).toEqual(["176514"]);
    expect(v("identificacao")).toEqual(["PL 5905/2026 (Substitutivo-CD)"]);
    expect(v("resumoAutoria")).toEqual(["Câmara dos Deputados"]);
    const autores = v("autor").map((x) => JSON.parse(x!));
    expect(autores.find((a) => a.papel === "iniciativa")).toMatchObject({ posicao: 0, autor: "Marcelo Crivella", codigoParlamentar: 3366, tipo: "SENADOR" });
    expect(autores.find((a) => a.papel === "texto")).toMatchObject({ posicao: 0, autor: "Câmara dos Deputados", codigoParlamentar: null });
  });

  it("Câmara: id do deputado lido do uri", () => {
    const [l] = leiturasAutoria(linha("https://dadosabertos.camara.leg.br/api/v2/proposicoes/2295936/autores"), ler("camara-2295936-autores.json"), { foraDoMolde: 0 });
    const a = JSON.parse(l.fatos.find((f) => f.campo === "autor")!.valor!);
    expect(a).toMatchObject({ papel: "camara", posicao: 0, ordem: 1, autor: "Maria do Rosário", idDeputado: 74398, proponente: 1 });
  });

  it("404 vira só statusHttp; resposta fora do molde vira erroLeitura e é contada", () => {
    expect(leiturasAutoria(linha(`${S}/processo?codigoMateria=9`, 404), "", { foraDoMolde: 0 })[0].fatos).toEqual([{ campo: "statusHttp", valor: "404" }]);
    const c = { foraDoMolde: 0 };
    const [l] = leiturasAutoria(linha(`${S}/processo/9133965`), JSON.stringify({ id: 1, autoriaIniciativa: [] }), c);
    expect(c.foraDoMolde).toBe(1);
    expect(l.fatos[1]).toMatchObject({ campo: "erroLeitura" });
    expect(leiturasAutoria(linha(`${S}/processo/9133965`), "<html>", c)[0].fatos[1].campo).toBe("erroLeitura");
  });
});

describe("lote e versão", () => {
  it("SQL só da entidade autoria; versão estável", () => {
    expect(sqlDoLoteAutoria(10, 5)).toContain("i.entidade = 'autoria' AND i.id > 10 ORDER BY i.id LIMIT 5");
    expect(() => sqlDoLoteAutoria(1.5, 5)).toThrow();
    expect(versaoDoLeitorAutoria()).toMatch(/^observacoes-autoria@[0-9a-f]{12}$/);
    expect(versaoDoLeitorAutoria()).toBe(versaoDoLeitorAutoria());
  });
});
