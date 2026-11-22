import { describe, it, expect } from "vitest";
import { fundir, ForaDeOrdemError, type Leitura } from "../../scripts/observacoes/fundir.js";
import type { Fato } from "../../scripts/observacoes/fatos.js";

let n = 0;
/** Leitura do detalhe da ideia `id`, no dia `dia` de novembro (índice crescente a cada chamada). */
function leitura(id: string, dia: number, fatos: Fato[], indice = ++n): Leitura {
  return {
    indice, instante: `2026-11-${String(dia).padStart(2, "0")}T02:00:00.000Z`, sha256: `sha-${indice}`,
    entidade: "ideias", entityId: id, fonte: "detalhe", fatos,
  };
}
const apoios = (v: string | null): Fato => ({ campo: "apoios", valor: v });

describe("fundir — uma linha por valor (decisão 3 da fase C)", () => {
  it("funde leituras seguidas iguais: primeiro/último visto, número de leituras, páginas", () => {
    const [a, b, c] = [leitura("1", 1, [apoios("10")]), leitura("1", 2, [apoios("10")]), leitura("1", 3, [apoios("10")])];
    const obs = fundir([], [a, b, c]);
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({
      campo: "apoios", valor: "10", leituras: 3,
      vistoPrimeiro: a.instante, vistoUltimo: c.instante, shaPrimeiro: a.sha256, shaUltimo: c.sha256,
      indicePrimeiro: a.indice, indiceUltimo: c.indice,
    });
  });

  it("valor que vai e volta (A → B → A) dá três linhas", () => {
    const obs = fundir([], [leitura("1", 1, [apoios("A")]), leitura("1", 2, [apoios("B")]), leitura("1", 3, [apoios("A")])]);
    expect(obs.map((o) => [o.valor, o.leituras])).toEqual([["A", 1], ["B", 1], ["A", 1]]);
  });

  it("campo que some fecha a linha; null lido é valor, diferente da string 'null'", () => {
    const obs = fundir([], [
      leitura("1", 1, [apoios(null), { campo: "x", valor: "1" }]),
      leitura("1", 2, [apoios("null")]),
    ]);
    expect(obs.map((o) => [o.campo, o.valor, o.leituras])).toEqual([["apoios", null, 1], ["apoios", "null", 1], ["x", "1", 1]]);
  });

  it("séries diferentes não se misturam (outra ideia, outra fonte)", () => {
    const l1 = leitura("1", 1, [apoios("5")]);
    const l2 = { ...leitura("2", 1, [apoios("5")]) };
    const l3 = { ...leitura("1", 2, [apoios("5")]), fonte: "listagem" as const };
    const obs = fundir([], [l1, l2, l3]);
    expect(obs).toHaveLength(3);
    expect(obs.every((o) => o.leituras === 1)).toBe(true);
  });

  it("fato repetido na mesma leitura conta por ocorrência", () => {
    const ev = { campo: "acontecimento", valor: '{"x":1}' };
    const obs = fundir([], [leitura("1", 1, [ev, ev]), leitura("1", 2, [ev]), leitura("1", 3, [ev, ev])]);
    // 1ª ocorrência: as três leituras; 2ª: só o dia 1, e uma linha nova no dia 3. Saída ordenada por
    // início e, no empate, pelo fim.
    expect(obs.map((o) => [o.leituras, o.vistoPrimeiro.slice(8, 10), o.vistoUltimo.slice(8, 10)])).toEqual([
      [1, "01", "01"],
      [3, "01", "03"],
      [1, "03", "03"],
    ]);
  });

  it("incremental = completo, cortando em qualquer ponto", () => {
    const leituras: Leitura[] = [];
    const valores = ["1", "1", "2", "2", "2", "1", "3"];
    valores.forEach((v, i) => {
      leituras.push(leitura("7", i + 1, [apoios(v), { campo: "t", valor: "fixo" }, ...(i % 2 ? [{ campo: "par", valor: null }] : [])]));
      leituras.push(leitura("8", i + 1, [apoios(String(i % 3))]));
    });
    const completo = fundir([], leituras);
    for (let corte = 0; corte <= leituras.length; corte++) {
      expect(fundir(fundir([], leituras.slice(0, corte)), leituras.slice(corte))).toEqual(completo);
    }
  });

  it("não muda as observações recebidas", () => {
    const antes = fundir([], [leitura("1", 1, [apoios("1")])]);
    const copia = structuredClone(antes);
    fundir(antes, [leitura("1", 2, [apoios("1")])]);
    expect(antes).toEqual(copia);
  });

  it("leitura que não vem depois da última fundida lança (índice ou instante)", () => {
    const base = fundir([], [leitura("1", 5, [apoios("1")], 100)]);
    expect(() => fundir(base, [leitura("1", 6, [apoios("1")], 100)])).toThrow(ForaDeOrdemError);
    expect(() => fundir(base, [leitura("1", 4, [apoios("1")], 101)])).toThrow(ForaDeOrdemError);
  });

  it("ordem de saída: ideia 99 antes de 100 (numérica)", () => {
    const obs = fundir([], [leitura("100", 1, [apoios("1")]), leitura("99", 1, [apoios("1")])]);
    expect(obs.map((o) => o.entityId)).toEqual(["99", "100"]);
  });
});
