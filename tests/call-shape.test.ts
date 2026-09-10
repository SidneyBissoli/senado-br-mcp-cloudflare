import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { classifyError, errorText, paramNames } from "../src/call-shape.js";
import { instrumentTool } from "../src/instrument.js";

/**
 * A FORMA da chamada (blobs 7 e 8), que nasceu do diagnóstico de 10/09/2026:
 * a telemetria dizia QUE a ferramenta falhou e não por quê, e a primeira
 * hipótese estava errada. Estes casos guardam as duas coisas que a classe
 * precisa acertar para a próxima resposta ser confiável — e a linha que ela
 * não pode cruzar, que é gravar valor de parâmetro.
 */
/**
 * A GUARDA. Varre as mensagens de erro do próprio `src/` e reprova se alguma
 * cair em `outro`. Escrita assim porque uma lista de literais copiados aqui
 * fossilizaria o dia da varredura: quando passei o classificador por este
 * repositório, 12 das 18 mensagens não tinham classe — a telemetria não
 * responderia nada — e a lista copiada não diria nada sobre a mensagem que
 * alguém acrescentar amanhã.
 */
const CHAMADA = /toolError\(([\s\S]{10,1200}?)\n?\s*\)/g;
const LITERAL = /(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g;
/** Mensagem que só repassa o texto de cima; o sinal chega em execução. */
const REPASSE = /:\s*X\.?$/;

function mensagensDeErro(): string[] {
  const achadas = new Set<string>();
  const ande = (dir: string): void => {
    for (const entrada of readdirSync(dir)) {
      const caminho = join(dir, entrada);
      if (statSync(caminho).isDirectory()) {
        ande(caminho);
        continue;
      }
      if (!entrada.endsWith(".ts") || entrada.includes(".test.")) continue;
      for (const chamada of readFileSync(caminho, "utf8").matchAll(CHAMADA)) {
        const partes = [...chamada[1].matchAll(LITERAL)].map((p) => p[2]);
        if (partes.length === 0) continue;
        const texto = partes.join("").replace(/\$\{[^}]*\}/g, "X").replace(/\s+/g, " ").trim();
        // Exige espaco: literais colados sem prosa (uma lista de nomes de
        // parametro, por exemplo) nao sao mensagem e nao se classificam.
        if (texto.length > 15 && /\s/.test(texto)) achadas.add(texto);
      }
    }
  };
  ande(new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  return [...achadas];
}

describe("guarda: as mensagens deste servidor são classificáveis", () => {
  const mensagens = mensagensDeErro();

  it("a varredura encontra as mensagens (senão a guarda passaria vazia)", () => {
    expect(mensagens.length).toBeGreaterThan(10);
  });

  it("nenhuma mensagem própria cai em `outro`", () => {
    const orfas = mensagens.filter((m) => !REPASSE.test(m) && classifyError(m) === "outro");
    expect(orfas, `sem classe:\n${orfas.map((m) => `  - ${m}`).join("\n")}`).toEqual([]);
  });
});

describe("classifyError", () => {
  it("regra de contrato checada no código", () => {
    expect(classifyError('O horizonte "anual" exige `referencia` no formato yyyy')).toBe("contrato");
    expect(classifyError("REF_AREA is required (up to 30 area codes)")).toBe("contrato");
    expect(classifyError("Invalid arguments for tool")).toBe("contrato");
  });

  it("a fonte respondeu que não existe", () => {
    expect(classifyError("[/comissao/reuniao/999999] Resposta upstream vazia")).toBe("nao_encontrado");
    expect(classifyError("API error (NOT_FOUND): Resource not found: /mms/codeinfo/E11")).toBe("nao_encontrado");
    expect(classifyError('Dataflow "DF_INVENTADO" não encontrado')).toBe("nao_encontrado");
  });

  it("a fonte falhou ou demorou", () => {
    expect(classifyError("Tempo esgotado ao consultar a fonte")).toBe("fonte");
    expect(classifyError("Fonte indisponível (503)")).toBe("fonte");
    expect(classifyError("Resposta excede o limite de tamanho")).toBe("fonte");
  });

  it("o que não casa cai em outro, e não numa classe errada", () => {
    expect(classifyError("Algo inesperado aconteceu")).toBe("outro");
    expect(classifyError("")).toBe("outro");
  });

  it("o mais específico vence: 'não encontrado' não é classificado como fonte", () => {
    // "upstream" aparece nas duas famílias; a mensagem real do senado tem as
    // duas palavras e tem de cair em nao_encontrado.
    expect(classifyError("[/comissao/reuniao/1] Resposta upstream vazia")).toBe("nao_encontrado");
  });
});

describe("classifyError sobre as mensagens REAIS da produção", () => {
  // Achados lendo o Analytics Engine em 10/09/2026, depois de ligar a forma.
  // Os três estavam classificados ERRADO na primeira versão.
  const envelope = (msg: string, retryable = false) => ({
    isError: true,
    structuredContent: {
      error: msg,
      retryable,
      hint: retryable
        ? "Erro transitório na fonte de dados oficial; repita a chamada em alguns segundos."
        : "Erro não recuperável por repetição; verifique os parâmetros (códigos, datas, filtros). Se persistir, a fonte oficial pode estar indisponível.",
    },
    content: [{ text: "" }],
  });

  it("o HINT genérico não contamina a classe", () => {
    // O hint de erro não recuperável termina em "pode estar indisponível", e o
    // radical "indisponív" é sinal de `fonte`. Classificando o payload inteiro,
    // TODO erro não recuperável virava `fonte` — foi o que a produção mostrou.
    const r = envelope("Não existe reunião com o código 991234.");
    expect(classifyError(errorText(r))).toBe("nao_encontrado");
  });

  it("um código com 5 no meio não vira erro 5xx", () => {
    const r = envelope("Não existe reunião com o código 591234.");
    expect(classifyError(errorText(r))).toBe("nao_encontrado");
    expect(classifyError("Fonte devolveu 503")).toBe("fonte");
  });

  it("a mensagem de parâmetro faltando é contrato", () => {
    const r = envelope("Informe `codigoReuniao`, ou `sigla` da comissão (com `data`, opcional).");
    // Este caso ficou hedged na primeira versão ("contrato ou outro") porque eu
    // tinha dúvida se `Informe` era sinal. A varredura de TODAS as mensagens do
    // repositório respondeu: dez delas dizem isso, e é a família canônica de
    // parâmetro que falta. O sinal fica DEPOIS de não-encontrado na ordem.
    expect(classifyError(errorText(r))).toBe("contrato");
  });

  it("`informe` no MEIO da frase não sequestra um não encontrado", () => {
    const r = envelope("Não existe reunião com esse código. Informe um código válido.");
    expect(classifyError(errorText(r))).toBe("nao_encontrado");
  });

  it("erro transitório de verdade continua sendo fonte", () => {
    const r = envelope("[/comissao/agenda/1/2] Tempo esgotado", true);
    expect(classifyError(errorText(r))).toBe("fonte");
  });
});

describe("paramNames", () => {
  it("devolve os NOMES, em ordem, e nunca os valores", () => {
    const s = paramNames([{ sigla: "CAE", dataFim: "20260910", dataInicio: "20260827" }]);
    expect(s).toBe("dataFim,dataInicio,sigla");
    expect(s).not.toContain("CAE");
    expect(s).not.toContain("2026");
  });

  it("ignora parâmetro ausente", () => {
    expect(paramNames([{ codigoReuniao: 14910, extra: undefined }])).toBe("codigoReuniao");
  });

  it("aguenta chamada sem argumento, com argumento estranho e com array", () => {
    expect(paramNames([])).toBe("");
    expect(paramNames([null])).toBe("");
    expect(paramNames(["texto"])).toBe("");
    expect(paramNames([["a", "b"]])).toBe("");
  });

  it("corta nomes longos demais para o blob", () => {
    const muitos = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`parametro_numero_${i}`, 1]));
    expect(paramNames([muitos]).length).toBeLessThanOrEqual(200);
  });
});

describe("errorText", () => {
  it("lê o texto do primeiro conteúdo", () => {
    expect(errorText({ content: [{ text: "falhou" }] })).toBe("falhou");
  });
  it("não quebra com resultado sem conteúdo", () => {
    expect(errorText({})).toBe("");
    expect(errorText(null)).toBe("");
    expect(errorText({ content: [] })).toBe("");
  });
});

describe("instrumentTool grava a forma da chamada", () => {
  function fakeAnalytics() {
    const points: AnalyticsEngineDataPoint[] = [];
    return {
      points,
      dataset: {
        writeDataPoint(p: AnalyticsEngineDataPoint) {
          points.push(p);
        },
      } as unknown as AnalyticsEngineDataset,
    };
  }

  it("chamada com êxito: classe vazia, nomes gravados", async () => {
    const a = fakeAnalytics();
    const wrapped = instrumentTool("t", async () => ({ ok: true }), a.dataset);
    await wrapped({ sigla: "CAE" });
    expect(a.points[0]?.blobs?.[6]).toBe("");
    expect(a.points[0]?.blobs?.[7]).toBe("sigla");
  });

  it("chamada com erro: classe preenchida a partir da mensagem", async () => {
    const a = fakeAnalytics();
    const wrapped = instrumentTool(
      "t",
      async () => ({ isError: true, content: [{ text: "Resposta upstream vazia" }] }),
      a.dataset,
    );
    await wrapped({ codigoReuniao: 999999 });
    expect(a.points[0]?.blobs?.[1]).toBe("error");
    expect(a.points[0]?.blobs?.[6]).toBe("nao_encontrado");
    expect(a.points[0]?.blobs?.[7]).toBe("codigoReuniao");
  });

  it("erro lançado também vira classe", async () => {
    const a = fakeAnalytics();
    const wrapped = instrumentTool("t", async () => {
      throw new Error("Tempo esgotado na fonte");
    }, a.dataset);
    await expect(wrapped({ x: 1 })).rejects.toThrow();
    expect(a.points[0]?.blobs?.[6]).toBe("fonte");
  });

  it("nenhum blob carrega valor de parâmetro", async () => {
    const a = fakeAnalytics();
    const wrapped = instrumentTool("t", async () => ({ ok: true }), a.dataset);
    await wrapped({ palavraChave: "nome-de-uma-pessoa", ano: 2026 });
    const blobs = (a.points[0]?.blobs ?? []).join("|");
    expect(blobs).not.toContain("nome-de-uma-pessoa");
    expect(blobs).not.toContain("2026");
    expect(blobs).toContain("ano,palavraChave");
  });
});
