/**
 * Fusível do fallback de legislatura (regra de autoria do portfólio, caso
 * ibge-br-mcp 2026-08: constante temporal sem contrato envelhece em silêncio).
 *
 * `deriveLegislaturaAtual` deriva a legislatura da API (fórmula ancorada,
 * atemporal) — mas o FALLBACK, usado quando a lista de senadores vem sem o
 * campo, está pinado na 57ª (2023-2027). A partir de 2027-02-01 ele passaria
 * a responder a legislatura errada em degradação da API, sem erro nenhum.
 *
 * Este teste calcula a legislatura vigente HOJE pela mesma âncora
 * (57ª começa em 2023-02-01; uma a cada 4 anos) e falha quando o fallback
 * ficar para trás — o aviso antecipado (90 dias) vem do monitor do
 * portfólio (source_deadlines); este fusível garante que a troca não passa
 * despercebida no CI do próprio repo.
 */
import { describe, expect, it } from "vitest";
import { deriveLegislaturaAtual } from "../src/tools/referencia";

describe("fallback de legislatura", () => {
  it("o fallback pinado corresponde à legislatura vigente na data de hoje", () => {
    const fallback = deriveLegislaturaAtual([]); // sem dados da API → fallback
    const hoje = new Date();
    // legislaturas começam em 1º de fevereiro; antes de fevereiro ainda vale a anterior
    const anoBase = hoje.getUTCFullYear() - (hoje.getUTCMonth() >= 1 ? 0 : 1);
    const esperada = 57 + Math.floor((anoBase - 2023) / 4);
    expect(
      fallback.numero,
      `o fallback está na ${fallback.numero}ª legislatura, mas hoje vige a ${esperada}ª — ` +
        `atualize o fallback em src/tools/referencia.ts (numero, periodo, dataInicio, dataFim)`
    ).toBe(esperada);
  });
});
