import { describe, it, expect } from "vitest";
import { landingResponseForPath, buildLandingBody } from "../src/landing.js";
import { USER_AGENT, VERSION } from "../src/version.js";
import { CONTACT_EMAIL } from "../src/legal.js";

describe("landing page", () => {
  it("serves the root landing page", async () => {
    const response = landingResponseForPath("/");

    expect(response).toBeInstanceOf(Response);
    expect(response!.status).toBe(200);
    expect(response!.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response!.headers.get("Cache-Control")).toContain("public");

    const html = await response!.text();
    expect(html).toContain('lang="pt-BR"');
    expect(html).toContain("Dados Abertos Senado BR MCP");
  });

  it("identifies the client: exact User-Agent, version and contact email", () => {
    const body = buildLandingBody();
    expect(body).toContain(USER_AGENT);
    expect(body).toContain(VERSION);
    expect(body).toContain(`mailto:${CONTACT_EMAIL}`);
  });

  it("links the operational endpoints and the source repository", () => {
    const body = buildLandingBody();
    expect(body).toContain("/status");
    expect(body).toContain("/health");
    expect(body).toContain("github.com/SidneyBissoli/senado-br-mcp-cloudflare");
  });

  it("ignores non-root paths", () => {
    expect(landingResponseForPath("/mcp")).toBeNull();
    expect(landingResponseForPath("/health")).toBeNull();
    expect(landingResponseForPath("")).toBeNull();
  });
});
