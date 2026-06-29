import { describe, expect, it } from "vitest";
import {
  OPENAI_APPS_CHALLENGE_PATH,
  openAiAppsChallengeResponseForPath,
} from "../src/openai-domain-verification.js";

describe("OpenAI Apps domain verification", () => {
  it("serves the challenge token as plain text", async () => {
    const token = "a-qZzjjz8ccDmm2bE1FTQQYOZvASUyGUhKIz5BRu8KQ";
    const response = openAiAppsChallengeResponseForPath(OPENAI_APPS_CHALLENGE_PATH, token);

    expect(response).toBeInstanceOf(Response);
    expect(response!.status).toBe(200);
    expect(response!.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response!.headers.get("Cache-Control")).toBe("no-store");
    expect(await response!.text()).toBe(token);
  });

  it("ignores unrelated paths and missing tokens", () => {
    expect(openAiAppsChallengeResponseForPath("/mcp", "token")).toBeNull();
    expect(openAiAppsChallengeResponseForPath(OPENAI_APPS_CHALLENGE_PATH)).toBeNull();
  });
});
