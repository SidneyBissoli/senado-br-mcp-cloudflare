import { describe, it, expect } from "vitest";
import {
  OPENAI_APP_WIDGET_HTML,
  OPENAI_APP_WIDGET_META,
  OPENAI_APP_WIDGET_MIME_TYPE,
} from "../src/openai-app-widget.js";
import {
  OPENAI_APP_WIDGET_DOMAIN,
  OPENAI_APP_WIDGET_URI,
} from "../src/app-surface.js";

describe("OpenAI app widget", () => {
  it("uses the MCP Apps HTML MIME profile", () => {
    expect(OPENAI_APP_WIDGET_MIME_TYPE).toBe("text/html;profile=mcp-app");
    expect(OPENAI_APP_WIDGET_URI).toContain("v2");
  });

  it("declares a submission-ready isolated widget origin and CSP", () => {
    expect(OPENAI_APP_WIDGET_META.ui.domain).toBe(OPENAI_APP_WIDGET_DOMAIN);
    expect(OPENAI_APP_WIDGET_META.ui.csp.connectDomains).toEqual([]);
    expect(OPENAI_APP_WIDGET_META.ui.csp.resourceDomains).toEqual([]);
    expect(OPENAI_APP_WIDGET_META["openai/widgetCSP"].connect_domains).toEqual([]);
    expect(OPENAI_APP_WIDGET_META["openai/widgetDomain"]).toBe(OPENAI_APP_WIDGET_DOMAIN);
  });

  it("renders from the Apps SDK bridge without external scripts", () => {
    expect(OPENAI_APP_WIDGET_HTML).toContain("window.openai");
    expect(OPENAI_APP_WIDGET_HTML).toContain("toolOutput");
    expect(OPENAI_APP_WIDGET_HTML).toContain("ui/notifications/tool-result");
    expect(OPENAI_APP_WIDGET_HTML).toContain("latestToolResult");
    expect(OPENAI_APP_WIDGET_HTML).toContain("textContent");
    expect(OPENAI_APP_WIDGET_HTML).not.toContain("<script src=");
  });

  it("prioritizes matter-search fields in the compact result cards", () => {
    expect(OPENAI_APP_WIDGET_HTML).toContain("priorityDetailKeys");
    expect(OPENAI_APP_WIDGET_HTML).toContain('"dataApresentacao"');
    expect(OPENAI_APP_WIDGET_HTML).toContain('"situacao"');
    expect(OPENAI_APP_WIDGET_HTML).toContain('"tramitando"');
    expect(OPENAI_APP_WIDGET_HTML).toContain("slice(0, 10)");
  });
});
