import { describe, it, expect } from "vitest";
import {
  handlerRouteForPath,
  minimizeToolResultForProfile,
  normalizeMcpRoute,
  OPENAI_APP_MCP_ROUTE,
  toolProfileForRoute,
} from "../src/app-surface.js";

describe("OpenAI app surface helpers", () => {
  it("normalizes near-miss MCP app routes", () => {
    expect(normalizeMcpRoute("/mcp/openai-app/")).toBe(OPENAI_APP_MCP_ROUTE);
    expect(normalizeMcpRoute("/MCP/OpenAI-App")).toBe(OPENAI_APP_MCP_ROUTE);
    expect(toolProfileForRoute("/mcp/openai-app/")).toBe("openai-app");
    expect(handlerRouteForPath("/mcp/openai-app/", "openai-app")).toBe("/mcp/openai-app/");
    expect(handlerRouteForPath("/MCP/OpenAI-App", "openai-app")).toBe("/MCP/OpenAI-App");
  });

  it("strips top-level operational meta only from the OpenAI app profile", () => {
    const result = {
      content: [
        { type: "text", text: JSON.stringify({ count: 1, meta: { fonte: "d1" } }, null, 2) },
        { type: "text", text: "Fonte: Senado Federal" },
      ],
      structuredContent: {
        count: 1,
        meta: { fonte: "d1" },
        provenance: { source_url: "https://example.test" },
        attribution: ["https://example.test"],
      },
    };

    const minimized = minimizeToolResultForProfile(result, "openai-app") as typeof result;
    expect(minimized.structuredContent).not.toHaveProperty("meta");
    expect(minimized.structuredContent).toHaveProperty("provenance");
    expect(minimized.content[0].text).not.toContain('"meta"');
    expect(minimized.content[1].text).toBe("Fonte: Senado Federal");
  });

  it("keeps full-profile results untouched", () => {
    const result = {
      content: [{ type: "text", text: JSON.stringify({ meta: { fonte: "d1" } }) }],
      structuredContent: { meta: { fonte: "d1" } },
    };

    expect(minimizeToolResultForProfile(result, "full")).toBe(result);
  });
});
