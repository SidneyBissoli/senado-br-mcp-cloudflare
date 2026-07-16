const SITE_ORIGIN = "https://senado.sidneybissoli.com";

export const PRIVACY_PATHS = new Set(["/privacy", "/privacy-policy"]);
export const TERMS_PATHS = new Set(["/terms", "/terms-of-use"]);

export const PRIVACY_URL = `${SITE_ORIGIN}/privacy`;
export const TERMS_URL = `${SITE_ORIGIN}/terms`;

const UPDATED_AT = "2026-06-28";
export const CONTACT_EMAIL = "sbissoli76@gmail.com";

export function htmlPage(title: string, body: string, lang = "en"): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.6;
      margin: 0;
      padding: 32px 20px;
      color: CanvasText;
      background: Canvas;
    }
    main { max-width: 840px; margin: 0 auto; }
    h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 8px; }
    h2 { font-size: 1.2rem; margin-top: 32px; }
    p, li { font-size: 1rem; }
    a { color: LinkText; }
    .muted { color: color-mix(in srgb, CanvasText 72%, Canvas 28%); }
  </style>
</head>
<body>
  <main>
${body}
  </main>
</body>
</html>`;
}

const privacyBody = `
    <h1>Privacy Policy</h1>
    <p class="muted">Last updated: ${UPDATED_AT}</p>
    <p>Dados Abertos Senado BR MCP is an independent, read-only open-data service for Brazilian Federal Senate public datasets. It is not affiliated with, maintained by, or endorsed by the Brazilian Federal Senate, OpenAI, or ChatGPT.</p>

    <h2>Information processed</h2>
    <p>The service processes the MCP requests sent by your client, such as search terms, years, state abbreviations, senator names, bill identifiers, or other parameters needed to query public datasets. It does not require an account, login, or end-user API key in its public mode.</p>
    <p>The service returns public information from official open-data sources, including legislative data, administrative data, and public e-Cidadania content. Some public source records may include names, roles, compensation, expenses, procurement data, comments, or other information that the source itself makes public.</p>

    <h2>Logs and analytics</h2>
    <p>Operational logs may include request method, path, status code, latency, error class, cache/live indicators, and aggregate tool-use metrics. The service is not designed to store full user prompts, authentication headers, or a database of individual user queries.</p>
    <p>Cloudflare, as the hosting provider, may process standard network metadata such as IP address, user agent, and request timing to deliver and secure the service. If you use the service through ChatGPT or another client, that client may process your messages under its own privacy policy.</p>

    <h2>Retention</h2>
    <p>Application-level operational logs are intended to be transient and retained for up to 30 days, unless a longer period is needed to investigate abuse, security incidents, or service failures. Aggregate, non-identifying tool-use metrics may be retained longer to understand reliability and adoption trends. Cloudflare platform logs and security records are retained according to Cloudflare's own policies.</p>

    <h2>Public-data cache</h2>
    <p>The service caches and stores copies of public upstream data to improve reliability and performance. The D1 database stores public e-Cidadania corpus data and scrape metadata; it does not store private user submissions to this MCP server.</p>

    <h2>How information is used</h2>
    <p>Operational information is used to run the service, debug failures, measure aggregate usage, protect upstream systems, and improve reliability. Public source data is used only to answer user requests and provide provenance.</p>

    <h2>Sharing</h2>
    <p>The service queries official public Senate endpoints and runs on Cloudflare infrastructure. It does not sell personal information. It may disclose operational information when required by law or to protect the service from abuse.</p>

    <h2>Your choices and contact</h2>
    <p>Do not send sensitive personal information to the service. The service operator and contact for privacy requests is Sidney Bissoli, reachable at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>. You may ask about privacy or request deletion of operational data that may be associated with you. Because the service primarily handles public data and aggregate logs, some records may not be individually identifiable.</p>

    <h2>Changes</h2>
    <p>This policy may be updated as the service evolves. The date above identifies the current version.</p>
`;

const termsBody = `
    <h1>Terms of Use</h1>
    <p class="muted">Last updated: ${UPDATED_AT}</p>
    <p>Dados Abertos Senado BR MCP is an independent, read-only open-data service for Brazilian Federal Senate public datasets. It is not affiliated with, maintained by, or endorsed by the Brazilian Federal Senate, OpenAI, or ChatGPT.</p>

    <h2>Use of the service</h2>
    <p>You may use the service to search, analyze, and cite public Senate data. You are responsible for your use of the results and for complying with applicable laws, platform rules, and upstream source terms.</p>

    <h2>No official status</h2>
    <p>The service is not an official source. It queries and normalizes public data, but official records, legal effects, deadlines, votes, expenses, and administrative information should be verified against the original source linked in each response provenance field.</p>

    <h2>No professional advice</h2>
    <p>Responses are for information and research. They are not legal, financial, political, journalistic, procurement, or compliance advice.</p>

    <h2>Availability and accuracy</h2>
    <p>The service is provided as is and as available. Public upstream APIs may change, fail, rate-limit, or contain errors. The service includes provenance and error envelopes to help users verify results, but it does not guarantee uninterrupted availability or perfect accuracy.</p>

    <h2>Acceptable use</h2>
    <p>Do not overload, scrape aggressively, interfere with, reverse engineer abusive limits around, or use the service to attack the service itself, Cloudflare, OpenAI, the Brazilian Federal Senate, or upstream public systems. Automated heavy use may be rate-limited or blocked.</p>

    <h2>Open source</h2>
    <p>The source code is MIT licensed at <a href="https://github.com/SidneyBissoli/senado-br-mcp-cloudflare">github.com/SidneyBissoli/senado-br-mcp-cloudflare</a>. The open-source license applies to the code, not to third-party platforms or upstream public data terms.</p>

    <h2>Contact</h2>
    <p>Questions about these terms can be sent to <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
`;

function legalHtmlResponse(title: string, body: string): Response {
  return new Response(htmlPage(title, body), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export function legalResponseForPath(pathname: string): Response | null {
  if (PRIVACY_PATHS.has(pathname)) {
    return legalHtmlResponse("Privacy Policy | Dados Abertos Senado BR MCP", privacyBody);
  }
  if (TERMS_PATHS.has(pathname)) {
    return legalHtmlResponse("Terms of Use | Dados Abertos Senado BR MCP", termsBody);
  }
  return null;
}
