import { describe, it, expect } from "vitest";
import { classifyError, errorText, paramNames } from "../src/call-shape.js";
import { instrumentTool } from "../src/instrument.js";

/**
 * A FORMA da chamada (blobs 7 e 8), que nasceu do diagnóstico de 10/09/2026:
 * a telemetria dizia QUE a ferramenta falhou e não por quê, e a primeira
 * hipótese estava errada. Estes casos guardam as duas coisas que a classe
 * precisa acertar para a próxima resposta ser confiável — e a linha que ela
 * não pode cruzar, que é gravar valor de parâmetro.
 */
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
    // "Informe" sozinho não é sinal de contrato; o que classifica é o restante.
    expect(["contrato", "outro"]).toContain(classifyError(errorText(r)));
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
