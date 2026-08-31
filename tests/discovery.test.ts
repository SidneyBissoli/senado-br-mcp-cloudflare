/**
 * As rotas de descoberta existem, dizem o que precisam dizer, e não escondem
 * o que não é conteúdo.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Em 31/08/2026 a landing foi reescrita para ser
 * indexável, e só então se mediu o outro lado: `sitemap.xml` respondia **404**
 * nos quatro domínios e o `robots.txt` era o bloco de *content signals* que a
 * Cloudflare injeta — 1.248 bytes de comentário puro, sem `Sitemap:` e sem
 * `Allow`. A página tinha ficado boa para um rastreador que nunca ia chegar.
 *
 * O que o teste guarda é o que some sem sintoma: uma rota que deixa de existir
 * devolve 404, o 404 não quebra nada, e ninguém percebe até a próxima medição
 * de visibilidade — que aí lê o silêncio como resposta.
 */

import { describe, expect, it } from "vitest";

import { INDEXNOW_KEY, discoveryResponseForPath, robotsTxt, sitemapXml } from "../src/discovery.js";
import { SITE_URL } from "../src/landing.js";

describe("robots.txt", () => {
  it("libera o rastreamento e aponta o sitemap no domínio próprio", () => {
    const txt = robotsTxt();
    expect(txt).toMatch(/^User-agent: \*$/m);
    expect(txt).toMatch(/^Allow: \/$/m);
    expect(txt).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });

  it("mantém fora do índice o que não é conteúdo", () => {
    const txt = robotsTxt();
    for (const rota of ["/mcp", "/health", "/status", "/metrics"]) {
      expect(txt, `rota de máquina fora do Disallow: ${rota}`).toContain(`Disallow: ${rota}`);
    }
  });

  it("é servido em /robots.txt, sem auth", async () => {
    const r = discoveryResponseForPath("/robots.txt");
    expect(r, "/robots.txt não é servido").not.toBeNull();
    expect(r!.status).toBe(200);
    expect(await r!.text()).toBe(robotsTxt());
  });
});

describe("sitemap.xml", () => {
  it("declara a raiz e os termos, e NÃO a política de privacidade", () => {
    // Decisão registrada em tests/landing.test.ts: páginas de obrigação não
    // disputam a busca com a landing. Os termos entram porque descrevem o
    // serviço; a privacidade, não.
    const xml = sitemapXml();
    expect(xml).toContain(`<loc>${SITE_URL}/</loc>`);
    expect(xml).toContain(`<loc>${SITE_URL}/terms</loc>`);
    expect(xml).not.toContain("/privacy");
  });

  it("é XML bem formado o bastante para o protocolo", () => {
    const xml = sitemapXml();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("http://www.sitemaps.org/schemas/sitemap/0.9");
    expect((xml.match(/<url>/g) ?? []).length).toBe((xml.match(/<\/url>/g) ?? []).length);
    expect(xml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  });

  it("é servido em /sitemap.xml, como XML", async () => {
    const r = discoveryResponseForPath("/sitemap.xml");
    expect(r, "/sitemap.xml não é servido").not.toBeNull();
    expect(r!.headers.get("Content-Type")).toContain("application/xml");
  });
});

describe("IndexNow", () => {
  it("a chave tem a forma que o protocolo aceita", () => {
    // 8 a 128 caracteres, apenas hexadecimais. Chave malformada faz o buscador
    // recusar a submissão inteira, em silêncio, do outro lado.
    expect(INDEXNOW_KEY).toMatch(/^[a-f0-9]{8,128}$/);
  });

  it("o arquivo de chave é servido no caminho que a submissão declara", async () => {
    const r = discoveryResponseForPath(`/${INDEXNOW_KEY}.txt`);
    expect(r, "arquivo de chave do IndexNow não é servido").not.toBeNull();
    expect(await r!.text()).toBe(INDEXNOW_KEY);
  });
});

describe("o que não é rota de descoberta", () => {
  it("devolve null, para o roteador seguir adiante", () => {
    for (const rota of ["/", "/mcp", "/health", "/privacy", "/qualquer-coisa.txt"]) {
      expect(discoveryResponseForPath(rota), `interceptou indevidamente ${rota}`).toBeNull();
    }
  });
});
