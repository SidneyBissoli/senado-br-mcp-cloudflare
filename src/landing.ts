/**
 * Public landing page served at the domain root ("/").
 * This is the URL advertised in the outgoing User-Agent (src/version.ts), so its job is
 * to let an upstream sysadmin who saw that UA in the logs identify the client, understand
 * its load posture, and reach the operator — without leaving the page.
 */

import { htmlPage, CONTACT_EMAIL, PRIVACY_URL, TERMS_URL } from "./legal.js";
import { VERSION, USER_AGENT } from "./version.js";

const GITHUB_URL = "https://github.com/SidneyBissoli/senado-br-mcp-cloudflare";
const NPM_URL = "https://www.npmjs.com/package/senado-br-mcp";
export const SITE_URL = "https://senado.sidneybissoli.com";
const PAGE_TITLE = "Dados Abertos Senado BR MCP";

/**
 * UMA frase, em português: o que o servidor serve e de qual fonte. Vira a
 * `meta description` e o parágrafo de abertura — até ~155 caracteres, que é o
 * que o resultado de busca mostra sem cortar.
 */
const RESUMO =
  "Servidor MCP dos dados abertos do Senado Federal: senadores, matérias, votações, " +
  "comissões, e-Cidadania e dados administrativos, com fonte citada.";

/**
 * Cabeçalho de DESCOBERTA. Esta é a única página do produto que não pertence a
 * terceiro — não é o npm, não é o GitHub, não é ficha de diretório. Até
 * 2026-08-31 ela não declarava `description`, og: nem dado estruturado: havia
 * texto para ler, mas nada para um buscador entender.
 */
function seoHead(): string {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: PAGE_TITLE,
    description: RESUMO,
    url: SITE_URL,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    inLanguage: "pt-BR",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    license: "https://opensource.org/licenses/MIT",
    author: { "@type": "Person", name: "Sidney Bissoli" },
    codeRepository: GITHUB_URL,
  };
  return `  <meta name="description" content="${RESUMO}">
  <link rel="canonical" href="${SITE_URL}/">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${PAGE_TITLE}">
  <meta property="og:title" content="${PAGE_TITLE}">
  <meta property="og:description" content="${RESUMO}">
  <meta property="og:url" content="${SITE_URL}/">
  <meta property="og:locale" content="pt_BR">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
}

export function buildLandingBody(): string {
  return `
    <h1>${PAGE_TITLE}</h1>
    <p class="muted">Versão ${VERSION} — serviço independente, somente leitura, não afiliado ao Senado Federal.</p>
    <p class="lead">${RESUMO}</p>

    <h2>Perguntas que ele responde</h2>
    <ul>
      <li>“Quais senadores estão em exercício hoje?”</li>
      <li>“Como cada senador votou na última votação nominal do plenário?”</li>
      <li>“Quais matérias sobre saúde foram apresentadas neste ano?”</li>
      <li>“Quem mais gastou com a cota parlamentar (CEAPS) em 2025?”</li>
    </ul>
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
      <li><a href="${GITHUB_URL}">Código-fonte no GitHub</a> · pacote npm <a href="${NPM_URL}"><code>senado-br-mcp</code></a></li>
    </ul>

    <section lang="en">
      <h2>Also in English</h2>
      <p>An independent, read-only MCP server for Brazilian Federal Senate open data — senators, bills, votes, committees, the e-Cidadania participation layer and administrative data (expenses, procurement, staff, budget), each answer carrying its source.</p>
      <ul>
        <li>“Which senators are currently in office?”</li>
        <li>“How did each senator vote on the last recorded floor vote?”</li>
      </ul>
      <p>If you found this domain in your server logs, the requests came from this client; contact <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
    </section>
`;
}

export function landingResponseForPath(pathname: string): Response | null {
  if (pathname !== "/") {
    return null;
  }
  return new Response(htmlPage(PAGE_TITLE, buildLandingBody(), "pt-BR", seoHead()), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
