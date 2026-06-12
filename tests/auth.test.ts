import { describe, it, expect, beforeAll } from "vitest";
import { timingSafeEqual, checkAuth } from "../src/auth.js";

// Polyfill crypto.subtle.timingSafeEqual for Node.js test environment
// (available natively in Cloudflare Workers runtime)
beforeAll(() => {
  if (typeof crypto.subtle.timingSafeEqual !== "function") {
    (crypto.subtle as any).timingSafeEqual = (a: ArrayBuffer, b: ArrayBuffer): boolean => {
      const va = new Uint8Array(a);
      const vb = new Uint8Array(b);
      if (va.length !== vb.length) return false;
      let result = 0;
      for (let i = 0; i < va.length; i++) {
        result |= va[i] ^ vb[i];
      }
      return result === 0;
    };
  }
});

describe("timingSafeEqual", () => {
  it("returns true for equal strings", async () => {
    expect(await timingSafeEqual("secret123", "secret123")).toBe(true);
  });

  it("returns false for different strings of same length", async () => {
    expect(await timingSafeEqual("secret123", "secret456")).toBe(false);
  });

  it("returns false for different lengths", async () => {
    expect(await timingSafeEqual("short", "muchlonger")).toBe(false);
  });

  it("returns true for empty strings", async () => {
    expect(await timingSafeEqual("", "")).toBe(true);
  });
});

describe("checkAuth", () => {
  function makeRequest(headers: Record<string, string> = {}): Request {
    return new Request("https://example.com/mcp", { headers });
  }

  it("returns null when no API_KEY is configured (open access)", async () => {
    const result = await checkAuth(makeRequest(), undefined);
    expect(result).toBeNull();
  });

  it("returns null when API_KEY is empty string (open access)", async () => {
    const result = await checkAuth(makeRequest(), "");
    expect(result).toBeNull();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const result = await checkAuth(makeRequest(), "my-secret");
    expect(result).toBeInstanceOf(Response);
    expect(result!.status).toBe(401);
    expect(result!.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("returns 401 for bad format (no Bearer prefix)", async () => {
    const result = await checkAuth(
      makeRequest({ Authorization: "Basic abc123" }),
      "my-secret",
    );
    expect(result).toBeInstanceOf(Response);
    expect(result!.status).toBe(401);
    expect(result!.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("returns 401 for bare token without scheme", async () => {
    const result = await checkAuth(
      makeRequest({ Authorization: "my-secret" }),
      "my-secret",
    );
    expect(result).toBeInstanceOf(Response);
    expect(result!.status).toBe(401);
  });

  it("returns 403 for wrong token", async () => {
    const result = await checkAuth(
      makeRequest({ Authorization: "Bearer wrong-token" }),
      "my-secret",
    );
    expect(result).toBeInstanceOf(Response);
    expect(result!.status).toBe(403);
  });

  it("returns null for correct token", async () => {
    const result = await checkAuth(
      makeRequest({ Authorization: "Bearer my-secret" }),
      "my-secret",
    );
    expect(result).toBeNull();
  });

  it("accepts lowercase 'bearer' scheme", async () => {
    const result = await checkAuth(
      makeRequest({ Authorization: "bearer my-secret" }),
      "my-secret",
    );
    expect(result).toBeNull();
  });

  it("accepts mixed-case 'BEARER' scheme", async () => {
    const result = await checkAuth(
      makeRequest({ Authorization: "BEARER my-secret" }),
      "my-secret",
    );
    expect(result).toBeNull();
  });
});
