/**
 * Public landing page served at the domain root ("/").
 * This is the URL advertised in the outgoing User-Agent (src/version.ts), so its job is
 * to let an upstream sysadmin who saw that UA in the logs identify the client, understand
 * its load posture, and reach the operator — without leaving the page.
 */

import { htmlPage, CONTACT_EMAIL, PRIVACY_URL, TERMS_URL } from "./legal.js";
import { VERSION, USER_AGENT } from "./version.js";

const GITHUB_URL = "https://github.com/SidneyBissoli/senado-br-mcp-cloudflare";

export function buildLandingBody(): string {
  return `
    <h1>Dados Abertos Senado BR MCP</h1>
    <p class="muted">Versão ${VERSION} — serviço independente, somente leitura, não afiliado ao Senado Federal.</p>
    <p>Este é um servidor <a href="https://modelcontextprotocol.io">MCP (Model Context Protocol)</a> que expõe os dados abertos do Senado Federal do Brasil — senadores, matérias, votações, comissões, e-Cidadania e dados administrativos (CEAPS, contratações, servidores, orçamento) — para assistentes de IA como Claude e ChatGPT. Código aberto sob licença MIT em <a href="${GITHUB_URL}">GitHub</a>.</p>

    <h2>Identificação nos logs (User-Agent)</h2>
    <p>Se você administra as APIs de dados abertos do Senado (<code>legis.senado.leg.br</code>, <code>adm.senado.gov.br</code>) ou o portal e-Cidadania e encontrou este domínio nos seus logs, as requisições vieram deste serviço, identificadas por:</p>
    <p><code>${USER_AGENT}</code></p>
    <p>Dúvidas, problemas de carga ou pedidos de ajuste: escreva para <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> — respondo e ajusto o comportamento do cliente.</p>

    <h2>Postura de carga</h2>
    <ul>
      <li><strong>Somente leitura</strong> — nenhuma operação de escrita contra os sistemas do Senado.</li>
      <li><strong>Cache em camadas</strong> — memória do isolate + Cache API da Cloudflare, com TTL por categoria de dado; a maioria das requisições dos usuários não chega ao upstream.</li>
      <li><strong>Throttle global</strong> — token bucket compartilhado, máximo de 6 requisições concorrentes e orçamento total de 10&nbsp;s por chamada.</li>
      <li><strong>Backoff educado</strong> — retry com backoff exponencial e jitter apenas em 429/503 e falhas de rede.</li>
      <li><strong>Guarda de tamanho</strong> — respostas acima do limite são rejeitadas em vez de re-baixadas.</li>
    </ul>

    <h2>Links</h2>
    <ul>
      <li>Endpoint MCP: <code>https://senado.sidneybissoli.com/mcp</code> (Streamable HTTP)</li>
      <li><a href="/status">/status</a> — versão e metadados do último deploy</li>
      <li><a href="/health">/health</a> — health check</li>
      <li><a href="${PRIVACY_URL}">Política de privacidade</a> · <a href="${TERMS_URL}">Termos de uso</a></li>
      <li><a href="${GITHUB_URL}">Código-fonte no GitHub</a> · pacote npm <a href="https://www.npmjs.com/package/senado-br-mcp"><code>senado-br-mcp</code></a></li>
    </ul>

    <p class="muted">In English: this is an independent, read-only MCP server for Brazilian Federal Senate open data. If you found this domain in your server logs, the requests came from this client; contact <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
`;
}

export function landingResponseForPath(pathname: string): Response | null {
  if (pathname !== "/") {
    return null;
  }
  return new Response(htmlPage("Dados Abertos Senado BR MCP", buildLandingBody(), "pt-BR"), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
