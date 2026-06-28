import { describe, it, expect } from "vitest";
import { buildStatus } from "../src/status.js";
import { VERSION } from "../src/version.js";
import { OPENAI_APP_MCP_ROUTE } from "../src/app-surface.js";
import { PRIVACY_URL, TERMS_URL } from "../src/legal.js";

describe("buildStatus", () => {
  it("reports ok, name, version and the mcp path", () => {
    const s = buildStatus({ CACHE_KV: {} } as any);
    expect(s.status).toBe("ok");
    expect(s.name).toBe("senado-br-mcp");
    expect(s.version).toBe(VERSION);
    expect(s.mcp).toBe("/mcp");
    expect(s.openaiAppMcp).toBe(OPENAI_APP_MCP_ROUTE);
    expect(s.legal).toEqual({ privacy: PRIVACY_URL, terms: TERMS_URL });
  });

  it("omits the deploy block when the version_metadata binding is absent", () => {
    const s = buildStatus({ CACHE_KV: {} } as any);
    expect("deploy" in s).toBe(false);
  });

  it("includes deploy id/tag/timestamp when the binding is present", () => {
    const s = buildStatus({
      CACHE_KV: {},
      CF_VERSION_METADATA: { id: "abc-123", tag: "v3", timestamp: "2026-06-22T14:00:00Z" },
    } as any);
    expect((s as any).deploy).toEqual({
      id: "abc-123",
      tag: "v3",
      timestamp: "2026-06-22T14:00:00Z",
    });
  });

  it("normalizes an empty tag to null", () => {
    const s = buildStatus({
      CACHE_KV: {},
      CF_VERSION_METADATA: { id: "abc-123", tag: "", timestamp: "2026-06-22T14:00:00Z" },
    } as any);
    expect((s as any).deploy.tag).toBeNull();
  });
});
