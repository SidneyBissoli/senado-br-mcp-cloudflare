import { describe, it, expect } from "vitest";
import { legalResponseForPath, PRIVACY_URL, TERMS_URL } from "../src/legal.js";

describe("legal pages", () => {
  it("serves the privacy policy page", async () => {
    const response = legalResponseForPath(new URL(PRIVACY_URL).pathname);

    expect(response).toBeInstanceOf(Response);
    expect(response!.status).toBe(200);
    expect(response!.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response!.headers.get("Cache-Control")).toContain("public");

    const html = await response!.text();
    expect(html).toContain("Privacy Policy");
    expect(html).toContain("not affiliated with, maintained by, or endorsed by");
    expect(html).toContain("retained for up to 30 days");
  });

  it("serves the terms of use page", async () => {
    const response = legalResponseForPath(new URL(TERMS_URL).pathname);

    expect(response).toBeInstanceOf(Response);
    expect(response!.status).toBe(200);

    const html = await response!.text();
    expect(html).toContain("Terms of Use");
    expect(html).toContain("No official status");
  });

  it("ignores unrelated paths", () => {
    expect(legalResponseForPath("/mcp")).toBeNull();
  });
});
