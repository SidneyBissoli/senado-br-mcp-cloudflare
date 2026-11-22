import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import type { ColunaDaTabela } from "../../scripts/observacoes/parquet.js";
import { COLUNAS_APOIOS, COLUNAS_SITUACAO } from "../../scripts/observacoes/series-run.js";
import { DICIONARIO, dicionarioMarkdown, type TipoFrictionless } from "../../scripts/publicacao/dicionario.js";
import * as G from "../../scripts/publicacao/gravar.js";

/** O que o job grava, por caminho da tabela. */
const GRAVADAS: Record<string, readonly ColunaDaTabela<never>[]> = {
  "ideias/ideias": G.COLUNAS_IDEIAS, "ideias/proposicoes": G.COLUNAS_PROPOSICOES, "ideias/linha-do-tempo": G.COLUNAS_LINHA_DO_TEMPO,
  "ideias/situacoes-portal": G.COLUNAS_SITUACOES_ATUAIS, "ideias/historico-situacao": COLUNAS_SITUACAO, "ideias/serie-apoios": COLUNAS_APOIOS,
  "consultas/consultas": G.COLUNAS_CONSULTAS, "consultas/serie-votos": G.COLUNAS_SERIE_VOTOS,
  "eventos/eventos": G.COLUNAS_EVENTOS, "eventos/pauta": G.COLUNAS_ITENS_DO_EVENTO, "eventos/convidados": G.COLUNAS_ITENS_DO_EVENTO,
  "eventos/comentarios": G.COLUNAS_COMENTARIOS,
  "consultas_votos/materias": G.COLUNAS_MATERIAS_DO_ACERVO, "consultas_votos/votos-uf": G.COLUNAS_VOTOS_UF,
} as unknown as Record<string, readonly ColunaDaTabela<never>[]>;

/** Tipo Parquet gravado → tipos Frictionless aceitos (texto pode ser data ou hora em ISO). */
const COMPATIVEL: Record<ColunaDaTabela<never>["tipo"], TipoFrictionless[]> = {
  inteiro: ["integer"], decimal: ["number"], instante: ["datetime"], texto: ["string", "date", "time"],
};

describe("dicionário 3.0.0", () => {
  it("cobre exatamente as tabelas que o job grava", () => {
    expect(DICIONARIO.map((t) => t.caminho).sort()).toEqual(Object.keys(GRAVADAS).sort());
  });

  it.each(DICIONARIO.map((t) => [t.caminho, t] as const))("%s: mesmas colunas, na mesma ordem, com tipo compatível", (caminho, t) => {
    const gravadas = GRAVADAS[caminho];
    expect(t.colunas.map((c) => c.nome)).toEqual(gravadas.map((c) => c.nome));
    for (const [i, c] of t.colunas.entries()) expect(COMPATIVEL[gravadas[i].tipo], `${caminho}.${c.nome}`).toContain(c.tipo);
    for (const k of t.chave) expect(t.colunas.map((c) => c.nome), `${caminho} chave ${k}`).toContain(k);
    for (const c of t.colunas) expect(c.descricao.length, `${caminho}.${c.nome}`).toBeGreaterThan(3);
  });

  it("o .md commitado está em dia com a fonte (rode `npm run dataset:dictionary:v3`)", () => {
    expect(readFileSync("docs/dataset-dictionary-v3.md", "utf8")).toBe(dicionarioMarkdown());
  });
});
