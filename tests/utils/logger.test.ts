import { describe, it, expect, vi, beforeEach } from "vitest";
import { logger, log } from "../../src/utils/logger.js";

// Every level writes to stderr (console.error) so the same logger is safe in the
// npm/stdio channel, where stdout is the JSON-RPC protocol stream. The `level`
// field in the payload preserves the info/warn/error distinction.
describe("logger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("logger.info writes to stderr with JSON containing level:'info'", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.info("test message");
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("test message");
  });

  it("logger.warn writes to stderr with level:'warn'", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.warn("warning msg");
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.level).toBe("warn");
    expect(parsed.msg).toBe("warning msg");
  });

  it("logger.error writes to stderr with level:'error'", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("error msg");
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.level).toBe("error");
    expect(parsed.msg).toBe("error msg");
  });

  it("all entries have a ts field", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.info("ts test");
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed).toHaveProperty("ts");
    expect(typeof parsed.ts).toBe("string");
  });

  it("extra fields are included in output", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.info("with fields", { tool: "senadores", layer: "L0" });
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.tool).toBe("senadores");
    expect(parsed.layer).toBe("L0");
  });

  it("backward-compat log() emits structured JSON via logger.info", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log("upstream", "/senador", 200, 150, 0, "L0");
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.level).toBe("info");
    expect(parsed.status).toBe(200);
    expect(parsed.cache).toBe("L0");
  });

  // stdio-channel invariant: nothing may reach stdout, or it corrupts the
  // JSON-RPC transport in `npx senado-br-mcp`.
  it("never writes to stdout (console.log) at any level", () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    log("upstream", "/senador", 200, 1, 0, "L0");
    expect(stdout).not.toHaveBeenCalled();
  });
});
