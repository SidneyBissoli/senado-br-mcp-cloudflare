import { describe, it, expect } from "vitest";
import { chaveDaViolacao, mais120Dias, separarConhecidas, verificarInvariantes } from "../../scripts/observacoes/invariantes.js";
import { fundir, type Leitura } from "../../scripts/observacoes/fundir.js";
import type { Fato, Fonte } from "../../scripts/observacoes/fatos.js";

let n = 0;
const leitura = (id: string, fonte: Fonte, fatos: Fato[]): Leitura => {
  n++;
  return { indice: n, instante: `2026-11-01T00:00:${String(n % 60).padStart(2, "0")}.000Z`, sha256: `sha${n}`, entidade: "ideias", entityId: id, fonte, fatos };
};
const detalhe = (id: string, proposta: string, prazo: string, extra: Fato[] = []) =>
  leitura(id, "detalhe", [{ campo: "dataProposta", valor: proposta }, { campo: "prazoApoios", valor: prazo }, ...extra]);
const sug = (numero: number, ano: number): Fato => ({ campo: "sugestao", valor: JSON.stringify({ numero, ano, data: null, url: null }) });
const apoios = (v: number): Fato => ({ campo: "apoios", valor: String(v) });

describe("C4 — invariantes das ideias", () => {
  it("prazo = proposta + 120 dias (exatos, atravessando mês e ano)", () => {
    expect(mais120Dias("2017-09-12")).toBe("2018-01-10"); // SUG 49/2017, medido no ROADMAP
    expect(mais120Dias("2020-06-02")).toBe("2020-09-30"); // SUG 21/2020
    const ok = verificarInvariantes(fundir([], [detalhe("1", "2019-10-14", "2020-02-11")]));
    expect(ok).toEqual([]);
    const ruim = verificarInvariantes(fundir([], [detalhe("2", "2019-10-14", "2020-02-14")]));
    expect(ruim).toHaveLength(1);
    expect(ruim[0]).toMatchObject({ regra: "prazo120", entityId: "2", paginas: [expect.stringMatching(/^sha/)] });
  });

  it("no máximo uma Sugestão ao longo do tempo; a mesma em várias leituras não viola", () => {
    const mesma = fundir([], [detalhe("3", "2020-01-01", "2020-04-30", [sug(5, 2020)]), detalhe("3", "2020-01-01", "2020-04-30", [sug(5, 2020)])]);
    expect(verificarInvariantes(mesma)).toEqual([]);
    const duas = fundir([], [detalhe("4", "2020-01-01", "2020-04-30", [sug(5, 2020)]), detalhe("4", "2020-01-01", "2020-04-30", [sug(6, 2020)])]);
    expect(verificarInvariantes(duas).map((v) => v.regra)).toEqual(["umaSugestao"]);
  });

  it("apoios que diminuem na mesma série violam; em séries diferentes (outra listagem) não se comparam", () => {
    const cai = fundir([], [leitura("5", "listagem-s5", [apoios(10)]), leitura("5", "listagem-s5", [apoios(9)])]);
    expect(verificarInvariantes(cai)).toMatchObject([{ regra: "apoiosNaoDecrescem", fonte: "listagem-s5", detalhe: expect.stringContaining("10") }]);
    const duasListagens = fundir([], [leitura("6", "listagem-s5", [apoios(10)]), leitura("6", "listagem-s6", [apoios(9)])]);
    expect(verificarInvariantes(duasListagens)).toEqual([]);
    const sobe = fundir([], [leitura("7", "listagem-s5", [apoios(1)]), leitura("7", "listagem-s5", [apoios(1)]), leitura("7", "listagem-s5", [apoios(2)])]);
    expect(verificarInvariantes(sobe)).toEqual([]);
  });

  it("violação explicada em conhecidas sai das novas, mas continua relatada", () => {
    const vs = verificarInvariantes(fundir([], [leitura("8", "listagem-s5", [apoios(3)]), leitura("8", "listagem-s5", [apoios(1)])]));
    const r = separarConhecidas(vs, [{ chave: chaveDaViolacao(vs[0]), motivo: "teste", conferidaEm: "2026-11-22" }]);
    expect(r.novas).toEqual([]);
    expect(r.conhecidas).toHaveLength(1);
    expect(chaveDaViolacao(vs[0])).toBe("apoiosNaoDecrescem:ideias:8:listagem-s5");
  });
});
