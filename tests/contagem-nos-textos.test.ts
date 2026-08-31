/**
 * Toda contagem de ferramentas escrita em texto para HUMANO bate com a
 * superfície real do servidor — e o texto em português cita as mesmas
 * ferramentas que o texto em inglês.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Em 2026-08-31 o `README.pt-BR.md` dizia que o
 * perfil curado para ChatGPT Apps tinha "25 ferramentas" quando a allowlist tem
 * 27, e não trazia o Grupo T (`senado_estrutura_organizacional`) — listava 66
 * ferramentas debaixo de um "Total: 67". O inglês estava certo nos dois pontos.
 * É a assimetria de sempre: o texto em inglês é o que se revisa a cada release,
 * o traduzido é cópia que ninguém reabre. A mesma classe apareceu no portfólio
 * inteiro no mesmo dia (ibge 22≠21 na landing, medical 37≠31 no `server.json`,
 * bcb 8≠15 no README traduzido).
 *
 * Este servidor tem TRÊS contagens legítimas e diferentes, e é por isso que o
 * teste não pode ser "todo número igual ao total": o total (67), a soma dos
 * grupos (que tem de fechar no total) e o perfil curado do endpoint
 * `/mcp/openai-app-v2` (a allowlist). Cada uma é conferida contra a sua própria
 * fonte, nenhuma contra um literal ([[verificacao-deriva-da-fonte]]).
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createServer } from "../src/server.js";
import { OPENAI_APP_TOOL_ALLOWLIST } from "../src/app-surface.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leia = (f: string) => readFileSync(join(raiz, f), "utf8");

const READMES = ["README.md", "README.pt-BR.md"] as const;
/** `**Total: 67 tools**` */
const TOTAL = /\*\*Total:\s*(\d+)\s+(?:tools?|ferramentas?)\*\*/gi;
/** `### Group B — Bills/Matters (2 tools, v3 backend)` */
const GRUPO = /^### (?:Group|Grupo) [A-Z][^\n]*?\((\d+)\s+(?:tools?|ferramentas?)[^)\n]*\)/gim;
/** Nomes de ferramenta citados em crase. */
const CITADAS = /`(senado_[a-z_0-9]+)`/g;

let real: number;
let client: Client;

beforeAll(async () => {
  const server = createServer({ CACHE_KV: {} as never } as never);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "contagem-nos-textos", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  ({ tools: { length: real } } = await client.listTools());
});

afterAll(async () => {
  await client.close();
});

describe("contagem de ferramentas nos textos públicos", () => {
  it("o servidor real é a fonte da contagem", () => {
    expect(real).toBeGreaterThan(0);
  });

  for (const arquivo of READMES) {
    it(`${arquivo}: o total anunciado é o que o servidor registra`, () => {
      const totais = [...leia(arquivo).matchAll(TOTAL)].map((m) => Number(m[1]));
      expect(totais.length, `${arquivo} sem linha "**Total: N ...**"`).toBeGreaterThan(0);
      for (const t of totais) {
        expect(t, `${arquivo} anuncia Total ${t}, o servidor registra ${real}`).toBe(real);
      }
    });

    it(`${arquivo}: a soma dos grupos fecha no total`, () => {
      const grupos = [...leia(arquivo).matchAll(GRUPO)].map((m) => Number(m[1]));
      expect(grupos.length, `${arquivo} sem cabeçalhos de grupo reconhecíveis`).toBeGreaterThan(0);
      expect(
        grupos.reduce((a, b) => a + b, 0),
        `${arquivo}: a soma dos ${grupos.length} grupos não fecha no total do servidor`,
      ).toBe(real);
    });

    it(`${arquivo}: o perfil curado do ChatGPT Apps é o tamanho da allowlist`, () => {
      // Só as frases que falam do perfil reduzido — as demais contagens do
      // texto são do catálogo completo e têm outro denominador.
      const linhas = leia(arquivo)
        .split("\n")
        .filter((l) => /openai-app|ChatGPT Apps/i.test(l));
      const citadas = linhas.flatMap((l) => [...l.matchAll(/(\d+)\s+(?:tools?|ferramentas?)\b/gi)]);
      expect(citadas.length, `${arquivo} não diz o tamanho do perfil curado`).toBeGreaterThan(0);
      for (const m of citadas) {
        expect(
          Number(m[1]),
          `${arquivo} anuncia "${m[0]}" para o perfil curado; a allowlist tem ${OPENAI_APP_TOOL_ALLOWLIST.size}`,
        ).toBe(OPENAI_APP_TOOL_ALLOWLIST.size);
      }
    });
  }
});

describe("paridade entre o README em inglês e o em português", () => {
  const pt = "README.pt-BR.md";

  it("o README em português existe", () => {
    expect(existsSync(join(raiz, pt)), `${pt} ausente — metade da superfície em pt`).toBe(true);
  });

  it("cita exatamente as mesmas ferramentas que o README em inglês", () => {
    const nomes = (f: string) => new Set([...leia(f).matchAll(CITADAS)].map((m) => m[1]));
    const en = nomes("README.md");
    const ptBR = nomes(pt);
    expect([...en].filter((n) => !ptBR.has(n)).sort(), "no inglês e ausentes do português").toEqual([]);
    expect([...ptBR].filter((n) => !en.has(n)).sort(), "no português e ausentes do inglês").toEqual([]);
  });

  it("tem o mesmo esqueleto de seções", () => {
    const secoes = (f: string) => (leia(f).match(/^#{2,3} /gm) ?? []).length;
    expect(secoes(pt), "número de seções divergente entre os dois READMEs").toBe(secoes("README.md"));
  });
});
