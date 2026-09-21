import { describe, it, expect } from "vitest";
import {
  criarDisjuntor,
  ehFalhaDeTransporte,
  PortalForaError,
} from "../../scripts/ingest-ecidadania/breaker.js";
import { HttpError } from "../../scripts/ingest-ecidadania/http.js";

// Estes casos derivam do episódio de 20-21/09/2026: o e-Cidadania ficou fora
// ~17 h e quatro runs morreram no teto de 200 min com rótulo `cancelled`. No
// run medido saíram 75 falhas SEGUIDAS e zero acertos em 3h18 — cada item
// custando o orçamento inteiro de retry (~158 s) em vez de ~1,9 s.

const timeout = () =>
  new HttpError("curl failed for https://x: curl: (28) Operation timed out", undefined, true);
const recusa = () => new HttpError("HTTP 404 for https://x", 404, false);

describe("ehFalhaDeTransporte", () => {
  it("timeout de curl é transporte", () => {
    expect(ehFalhaDeTransporte(timeout())).toBe(true);
  });

  it("404 NÃO é transporte — é a fonte respondendo", () => {
    expect(ehFalhaDeTransporte(recusa())).toBe(false);
  });

  it("5xx e 429 são transporte (http.ts os marca retryable)", () => {
    expect(ehFalhaDeTransporte(new HttpError("HTTP 503 for x", 503, true))).toBe(true);
    expect(ehFalhaDeTransporte(new HttpError("HTTP 429 for x", 429, true))).toBe(true);
  });

  it("erro solto, fora de HttpError, é classificado pela mensagem", () => {
    expect(ehFalhaDeTransporte(new Error("connect ECONNREFUSED 1.2.3.4:443"))).toBe(true);
    expect(ehFalhaDeTransporte(new Error("socket hang up"))).toBe(true);
    expect(ehFalhaDeTransporte(new Error("HTML degradado: 0 itens parseados"))).toBe(false);
  });
});

describe("criarDisjuntor", () => {
  it("abre no corte, e a mensagem diz quantas e onde", () => {
    const d = criarDisjuntor(3);
    d.falha(timeout(), "id=1");
    d.falha(timeout(), "id=2");
    expect(d.seguidas).toBe(2);
    try {
      d.falha(timeout(), "id=3");
      throw new Error("devia ter aberto");
    } catch (e) {
      expect(e).toBeInstanceOf(PortalForaError);
      expect((e as PortalForaError).seguidas).toBe(3);
      expect((e as PortalForaError).onde).toBe("id=3");
      expect((e as Error).message).toMatch(/portal fora/);
    }
  });

  it("UM acerto zera a contagem — gap isolado não abre o disjuntor", () => {
    const d = criarDisjuntor(3);
    d.falha(timeout(), "id=1");
    d.falha(timeout(), "id=2");
    d.sucesso();
    expect(d.seguidas).toBe(0);
    d.falha(timeout(), "id=3");
    d.falha(timeout(), "id=4");
    expect(d.seguidas).toBe(2); // ainda não abriu
  });

  it("o dia saudável não abre: 2000 itens, zero falhas", () => {
    const d = criarDisjuntor(10);
    for (let i = 0; i < 2000; i++) d.sucesso();
    expect(d.seguidas).toBe(0);
  });

  it("gap legítimo alternado com acerto nunca abre, por mais longo que seja o lote", () => {
    const d = criarDisjuntor(10);
    for (let i = 0; i < 2000; i++) {
      if (i % 3 === 0) d.falha(timeout(), `id=${i}`);
      else d.sucesso();
    }
    expect(d.seguidas).toBe(0);
  });

  it("404 em sequência NÃO abre: a fonte está respondendo, ids é que sumiram", () => {
    const d = criarDisjuntor(3);
    for (let i = 0; i < 50; i++) d.falha(recusa(), `id=${i}`);
    expect(d.seguidas).toBe(0);
  });

  it("o dia ruim abre MUITO antes do teto do job", () => {
    // 75 falhas seguidas foi o que o run cancelado acumulou em 3h18.
    const d = criarDisjuntor(10);
    let aberto = 0;
    for (let i = 0; i < 75; i++) {
      try {
        d.falha(timeout(), `id=${i}`);
      } catch {
        aberto = i + 1;
        break;
      }
    }
    expect(aberto).toBe(10);
    // ~158 s por item com o portal fora: abrir na 10a custa ~26 min, nao 200.
    expect(aberto * 158).toBeLessThan(200 * 60);
  });
});
