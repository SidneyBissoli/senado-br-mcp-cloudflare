import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * GUARDA (onda 2, 30/09/2026): nenhum resultado de erro de tool nasce à mão.
 *
 * O defeito de origem (medical, 30/09/2026): um handler montou
 * `{ content, isError: true }` sem classe; o hook de telemetria caiu na frase,
 * e o código ecoado "INVALID" casou `\binvalid` -> `contrato` em vez de
 * `nao_encontrado`. Aqui o caminho único é `toolError(msg, classe, …)` (classe
 * obrigatória no tipo) ou `errorFrom(e, …)` (classe pelo tipo da exceção).
 * Esta guarda reprova `isError: true` literal em `src/` fora da lista abaixo.
 */
const PERMITIDOS: Record<string, string> = {
  // `envelopeDeErro` é o único lugar que monta o envelope; `toolError` e
  // `errorFrom` o embrulham e anexam a classe (declarada / pelo tipo).
  "src/utils/validation.ts": "o envelope comum de toolError/errorFrom",
};

/** Tira comentários (de bloco e de linha) para não reprovar prosa que cita o padrão. */
function semComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function arquivosDeProducao(dir: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) achados.push(...arquivosDeProducao(caminho));
    else if (/\.(ts|tsx|js|mjs)$/.test(entrada) && !/\.test\./.test(entrada)) achados.push(caminho);
  }
  return achados;
}

describe("guarda: erro de tool só nasce com classe", () => {
  const raiz = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const arquivos = arquivosDeProducao(join(raiz, "src"));

  it("a varredura encontra os arquivos (senão a guarda passaria vazia)", () => {
    expect(arquivos.length).toBeGreaterThan(20);
  });

  it("nenhum `isError: true` literal fora dos helpers permitidos", () => {
    const violacoes = arquivos
      .map((a) => relative(raiz, a).replace(/\\/g, "/"))
      .filter((rel) => !(rel in PERMITIDOS))
      .filter((rel) => /\bisError\s*:\s*true\b/.test(semComentarios(readFileSync(join(raiz, rel), "utf8"))));
    expect(violacoes, `use toolError(msg, classe) ou errorFrom(e, …):\n${violacoes.join("\n")}`).toEqual([]);
  });

  it("os helpers permitidos ainda existem (lista sem entrada morta)", () => {
    for (const rel of Object.keys(PERMITIDOS)) {
      expect(readFileSync(join(raiz, rel), "utf8")).toMatch(/\bisError\s*:\s*true\b/);
    }
  });
});
