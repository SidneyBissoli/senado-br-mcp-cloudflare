import { describe, it, expect, vi, beforeEach } from "vitest";
import { logger, log } from "../../src/utils/logger.js";

describe("logger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("logger.info calls console.log with JSON containing level:'info'", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("test message");
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("test message");
  });

  it("logger.warn calls console.warn with level:'warn'", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("warning msg");
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.level).toBe("warn");
    expect(parsed.msg).toBe("warning msg");
  });

  it("logger.error calls console.error with level:'error'", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("error msg");
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.level).toBe("error");
    expect(parsed.msg).toBe("error msg");
  });

  it("all entries have a ts field", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("ts test");
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed).toHaveProperty("ts");
    expect(typeof parsed.ts).toBe("string");
  });

  it("extra fields are included in output", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("with fields", { tool: "senadores", layer: "L0" });
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.tool).toBe("senadores");
    expect(parsed.layer).toBe("L0");
  });

  it("backward-compat log() emits structured JSON via logger.info", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("upstream", "/senador", 200, 150, 0, "L0");
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.level).toBe("info");
    expect(parsed.status).toBe(200);
    expect(parsed.cache).toBe("L0");
  });
});
