import { describe, it, expect } from "vitest";
import {
  SITUACOES_VIVAS,
  SITUACAO_ARQUIVO,
  pisoVivoOk,
  selecionarTransicoes,
  inicioFatiaArquivo,
  avancarCursorArquivo,
} from "../../scripts/ingest-ecidadania/ideias-incremental.js";
import { SITUACAO_STATUS } from "../../scripts/ingest-ecidadania/ideias-listing.js";
import {
  statusFromSituacaoIdeia,
  extractSituacaoIdeia,
  parseIdeiaDetalheCorpus,
} from "../../src/scraper/ecidadania.js";
import ideiaDetalheHtml from "../fixtures/ecidadania/ideia-detalhe.html?raw";
import { ehRecursoRemovido } from "../../scripts/ingest-ecidadania/detalhe.js";
import { HttpError } from "../../scripts/ingest-ecidadania/http.js";

describe("partição vivo × arquivo", () => {
  it("cobre todas as situações do dropdown, sem sobra nem repetição", () => {
    const todas = Object.keys(SITUACAO_STATUS).map(Number).sort((a, b) => a - b);
    const particao = [...SITUACOES_VIVAS, SITUACAO_ARQUIVO].sort((a, b) => a - b);
    expect(particao).toEqual(todas);
  });

  it("o arquivo é encerrada — só congela quem não muda mais", () => {
    expect(SITUACAO_STATUS[SITUACAO_ARQUIVO]).toBe("encerrada");
  });
});

describe("statusFromSituacaoIdeia — os seis textos REAIS (medidos 06/10/2026, um por bucket)", () => {
  // Cada texto deve dar o MESMO status que a listagem atribui ao bucket de onde a ideia veio.
  const medidos: Array<[number, string]> = [
    [5, "Aberta"],
    [6, "Na comissão"],
    [7, "Encerrada - Sem apoio suficiente"],
    [8, "Aguardando envio à CDH"],
    [9, "Não acatada"],
    [10, "Convertida em Proposição"],
  ];
  for (const [situacao, texto] of medidos) {
    it(`s${situacao} "${texto}" → ${SITUACAO_STATUS[situacao]}`, () => {
      expect(statusFromSituacaoIdeia(texto)).toBe(SITUACAO_STATUS[situacao]);
    });
  }

  it("texto desconhecido → null (não adivinha)", () => {
    expect(statusFromSituacaoIdeia("Situação que o portal ainda não usava")).toBeNull();
  });
});

describe("parseIdeiaDetalheCorpus — apoios e situação (fixture real)", () => {
  const d = parseIdeiaDetalheCorpus(ideiaDetalheHtml);

  it("lê o contador de apoios", () => {
    expect(d.apoios).toBe(15943);
  });

  it("lê a situação pelo mapeamento compartilhado", () => {
    expect(extractSituacaoIdeia(ideiaDetalheHtml)).toBe("Aberta");
    expect(d.status).toBe("aberta");
  });

  it("sem contador e sem seção: null, nunca 0 nem aberta inventados", () => {
    const vazio = parseIdeiaDetalheCorpus("<html><body>nada</body></html>");
    expect(vazio.apoios).toBeNull();
    expect(vazio.status).toBeNull();
  });
});

describe("pisoVivoOk", () => {
  it("passa quando as abertas lidas são ≥ minPct das abertas no D1", () => {
    expect(pisoVivoOk(5451, 5451, 80)).toBe(true);
    expect(pisoVivoOk(4361, 5451, 80)).toBe(true); // 80,0%
  });

  it("barra uma lista viva truncada", () => {
    expect(pisoVivoOk(4360, 5451, 80)).toBe(false);
    expect(pisoVivoOk(100, 5451, 80)).toBe(false); // ex.: s5 devolveu só a p1
  });

  it("sem abertas no D1 (banco vazio) não há base: passa", () => {
    expect(pisoVivoOk(0, 0, 80)).toBe(true);
  });
});

describe("selecionarTransicoes", () => {
  const existentes = [
    { id: 30, status: "aberta" },
    { id: 10, status: "aberta" },
    { id: 20, status: "encerrada" },
    { id: 40, status: "aberta" },
    { id: 50, status: "convertida" },
  ];

  it("só abertas no D1 que o vivo não viu hoje, em ordem crescente", () => {
    expect(selecionarTransicoes(existentes, new Set([40]), 100)).toEqual([10, 30]);
  });

  it("encerradas e convertidas ausentes não são transição (já saíram antes)", () => {
    expect(selecionarTransicoes(existentes, new Set(), 100)).not.toContain(20);
    expect(selecionarTransicoes(existentes, new Set(), 100)).not.toContain(50);
  });

  it("respeita o teto; o excedente fica para o próximo run", () => {
    expect(selecionarTransicoes(existentes, new Set(), 2)).toEqual([10, 30]);
    expect(selecionarTransicoes(existentes, new Set(), 0)).toEqual([]);
  });
});

describe("cursor do arquivo (s7)", () => {
  it("começa na página seguinte ao cursor; cursor 0 = página 1", () => {
    expect(inicioFatiaArquivo(0)).toBe(1);
    expect(inicioFatiaArquivo(300)).toBe(301);
  });

  it("avança até a última página lida com sucesso", () => {
    expect(avancarCursorArquivo({ pagina: 300, voltas: 2 }, 400, 1126)).toEqual({ pagina: 400, voltas: 2 });
  });

  it("nenhuma página lida: o cursor não anda (mesmo objeto)", () => {
    const c = { pagina: 300, voltas: 2 };
    expect(avancarCursorArquivo(c, 0, 1126)).toBe(c);
  });

  it("ao alcançar a última página fecha a passada e volta à página 1", () => {
    expect(avancarCursorArquivo({ pagina: 1100, voltas: 2 }, 1126, 1126)).toEqual({ pagina: 0, voltas: 3 });
  });
});

describe("ehRecursoRemovido — 410 é resposta do portal, não falha", () => {
  it("410 → removida", () => {
    expect(ehRecursoRemovido(new HttpError("HTTP 410 for x", 410, false))).toBe(true);
  });

  it("404, 5xx, timeout e erro genérico não são remoção", () => {
    expect(ehRecursoRemovido(new HttpError("HTTP 404 for x", 404, false))).toBe(false);
    expect(ehRecursoRemovido(new HttpError("HTTP 503 for x", 503, true))).toBe(false);
    expect(ehRecursoRemovido(new HttpError("curl: (28) Operation timed out", undefined, true))).toBe(false);
    // Classifica pelo TIPO: a mesma frase num Error comum não conta.
    expect(ehRecursoRemovido(new Error("HTTP 410 for x"))).toBe(false);
  });
});
