/**
 * A landing page carrega, de fato, o que a torna encontrável.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Esta página sempre teve texto — é a melhor dos
 * seis servidores do portfólio nesse ponto —, mas até 2026-08-31 não declarava
 * `meta description`, og: nem dado estruturado: havia o que ler e não havia o
 * que indexar. É o único endereço do produto que não pertence a terceiro (não é
 * o npm, não é o GitHub, não é ficha de diretório), e o monitor GEO mediu a
 * consequência no portfólio inteiro: 32 consultas de buscador em português
 * acharam ZERO produtos.
 *
 * O que se guarda aqui é a PRESENÇA, não a aparência: uma página perde a
 * `meta description` num refactor sem que nada quebre e sem que ninguém veja.
 *
 * A segunda metade guarda a decisão sobre Privacidade e Termos: são páginas de
 * obrigação, não superfície de produto, e por isso NÃO levam o cabeçalho de
 * descoberta — não faz sentido que disputem a busca com a landing.
 */

import { describe, expect, it } from "vitest";

import { buildLandingBody, landingResponseForPath } from "../src/landing.js";
import { CONTACT_EMAIL, legalResponseForPath } from "../src/legal.js";
import { USER_AGENT, VERSION } from "../src/version.js";

async function corpo(pathname: string): Promise<string> {
  const resposta = landingResponseForPath(pathname) ?? legalResponseForPath(pathname);
  expect(resposta, `nada servido em ${pathname}`).not.toBeNull();
  return await resposta!.text();
}

describe("landing page — identificação do cliente", () => {
  // Este é o trabalho ORIGINAL da página, e ele não pode ser perdido de vista
  // ao acrescentar o trabalho de descoberta: a URL raiz aparece no User-Agent
  // das chamadas upstream, e um sysadmin do Senado que a encontre nos logs tem
  // de identificar o serviço e achar o contato sem sair daqui.
  it("serve a raiz como HTML em pt-BR, cacheável", async () => {
    const resposta = landingResponseForPath("/");
    expect(resposta).toBeInstanceOf(Response);
    expect(resposta!.status).toBe(200);
    expect(resposta!.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(resposta!.headers.get("Cache-Control")).toContain("public");
    const html = await resposta!.text();
    expect(html).toContain('lang="pt-BR"');
    expect(html).toContain("Dados Abertos Senado BR MCP");
  });

  it("mostra o User-Agent exato, a versão e o e-mail de contato", () => {
    const corpo = buildLandingBody();
    expect(corpo).toContain(USER_AGENT);
    expect(corpo).toContain(VERSION);
    expect(corpo).toContain(`mailto:${CONTACT_EMAIL}`);
  });

  it("liga os endpoints operacionais", () => {
    const corpo = buildLandingBody();
    expect(corpo).toContain("/status");
    expect(corpo).toContain("/health");
  });

  it("ignora caminhos que não são a raiz", () => {
    expect(landingResponseForPath("/mcp")).toBeNull();
    expect(landingResponseForPath("/health")).toBeNull();
    expect(landingResponseForPath("")).toBeNull();
  });
});

describe("landing page — superfície de descoberta", () => {
  it("tem meta description e canonical no domínio próprio", async () => {
    const html = await corpo("/");
    expect(html).toMatch(/<meta name="description" content="[^"]{60,}">/);
    expect(html).toContain('<link rel="canonical" href="https://senado.sidneybissoli.com/">');
  });

  it("publica dados estruturados válidos", async () => {
    const html = await corpo("/");
    // `?.[1]` e nao `m![1]`: com noUncheckedIndexedAccess o grupo capturado e
    // `string | undefined`, e o `tsc` do CI reprova o nao-nulo direto.
    const bruto = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1];
    expect(bruto, "landing sem bloco JSON-LD").toBeTruthy();
    const dados = JSON.parse(bruto as string) as Record<string, unknown>;
    expect(dados["@type"]).toBe("SoftwareApplication");
    expect(dados.url).toBe("https://senado.sidneybissoli.com");
    expect(dados.inLanguage).toBe("pt-BR");
    // A descrição do JSON-LD é a mesma da meta: uma fonte, dois canais.
    expect(html).toContain(`<meta name="description" content="${dados.description as string}">`);
  });

  it("mostra perguntas reais que o produto responde, em português", async () => {
    const html = await corpo("/");
    expect(html).toContain("Perguntas que ele responde");
    expect(html).toContain("em exercício");
    expect(html).toContain("CEAPS");
  });

  it("traz o produto em inglês, com resumo e exemplos próprios", async () => {
    const html = await corpo("/");
    expect(html).toContain('<section lang="en">');
    expect(html).toContain("Also in English");
    expect(html).toMatch(/read-only MCP server for Brazilian Federal Senate open data/);
  });

  it("leva a quem chega para o repositório, o pacote e o endpoint", async () => {
    const html = await corpo("/");
    expect(html).toContain("github.com/SidneyBissoli/senado-br-mcp-cloudflare");
    expect(html).toContain("npmjs.com/package/senado-br-mcp");
    expect(html).toContain("https://senado.sidneybissoli.com/mcp");
  });
});

describe("páginas de obrigação não disputam a busca", () => {
  for (const rota of ["/privacy", "/terms"]) {
    it(`${rota} não leva o cabeçalho de descoberta`, async () => {
      const html = await corpo(rota);
      expect(html).not.toContain('<meta name="description"');
      expect(html).not.toContain("application/ld+json");
      expect(html).not.toContain('property="og:');
    });
  }
});
