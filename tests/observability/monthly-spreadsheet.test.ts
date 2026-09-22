/**
 * A planilha mensal não pode contar o dono como usuário.
 *
 * Até 22/09/2026 o WHERE de todas as consultas era só o intervalo de datas, e o
 * tráfego do dono — smoke de produção, rodadas de eval, teste manual — entrava na
 * contagem de chamadas e no ranking de adoção. O servidor GRAVA o marcador
 * (`blob4 = 'self'`) desde que a rota `/mcp/uso-proprio` existe; era a planilha
 * que o ignorava.
 *
 * O que estes casos guardam não é a redação do SQL, é a propriedade que importa:
 * os dois recortes são COMPLEMENTARES. Toda linha da janela cai em exatamente um
 * deles, então nada soma duas vezes e nada some. Um filtro que descartasse o uso
 * próprio em vez de separá-lo passaria numa asserção de texto e falharia aqui.
 */

import { describe, expect, it } from "vitest";
import { escopos } from "../../scripts/observability/monthly-spreadsheet.mjs";

const JANELA =
  "timestamp >= toDateTime('2026-09-01 00:00:00') AND timestamp < toDateTime('2026-10-01 00:00:00')";

/** Avalia um WHERE deste formato contra uma linha, como o ClickHouse faria. */
function casa(where: string, linha: { blob4: string }): boolean {
  const janelaOk = where.includes(JANELA);
  if (!janelaOk) throw new Error(`escopo perdeu a janela do mês: ${where}`);
  if (where.includes("blob4 != 'self'")) return linha.blob4 !== "self";
  if (where.includes("blob4 = 'self'")) return linha.blob4 === "self";
  throw new Error(`escopo sem filtro de blob4: ${where}`);
}

// blob4 é `'self'` quando o dono chamou, e string vazia quando não — src/instrument.ts.
const LINHAS = [
  { quem: "público", blob4: "" },
  { quem: "dono (cabeçalho secreto)", blob4: "self" },
  { quem: "dono (rota /mcp/uso-proprio)", blob4: "self" },
  { quem: "público", blob4: "" },
  { quem: "público", blob4: "" },
];

describe("os dois recortes da planilha", () => {
  it("cada linha cai em EXATAMENTE um deles — nada some, nada conta duas vezes", () => {
    const { publico, proprio } = escopos(JANELA);
    for (const linha of LINHAS) {
      const emPublico = casa(publico, linha);
      const emProprio = casa(proprio, linha);
      expect(
        Number(emPublico) + Number(emProprio),
        `${linha.quem} (blob4=${JSON.stringify(linha.blob4)}) não caiu em exatamente um recorte`,
      ).toBe(1);
    }
  });

  it("o público NÃO inclui o dono — era esse o defeito", () => {
    const { publico } = escopos(JANELA);
    expect(LINHAS.filter((l) => casa(publico, l)).map((l) => l.quem)).toEqual([
      "público",
      "público",
      "público",
    ]);
  });

  it("o uso próprio é SEPARADO, não descartado", () => {
    // Filtrar e jogar fora seria meia solução: quanto do movimento é meu é
    // informação, e some se ninguém contar.
    const { proprio } = escopos(JANELA);
    expect(LINHAS.filter((l) => casa(proprio, l))).toHaveLength(2);
  });

  it("os dois mantêm a janela do mês — recorte de tempo não pode se perder no filtro", () => {
    const { publico, proprio } = escopos(JANELA);
    for (const e of [publico, proprio]) expect(e).toContain(JANELA);
  });

  it("a janela fica entre parênteses, senão o AND se mistura com o OR dela", () => {
    // `a OR b AND c` não é `(a OR b) AND c`. A janela é um AND hoje, mas o dia
    // em que ganhar um OR, a precedência muda o resultado calado.
    const { publico, proprio } = escopos("x = 1 OR y = 2");
    expect(publico).toBe("(x = 1 OR y = 2) AND blob4 != 'self'");
    expect(proprio).toBe("(x = 1 OR y = 2) AND blob4 = 'self'");
  });
});
