import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { callClaude, isAiConfigured, AiNotConfiguredError } from "@/lib/ai/client";

describe("isAiConfigured", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("returns false when no key is set", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(isAiConfigured()).toBe(false);
  });

  it("returns true when a key is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    expect(isAiConfigured()).toBe(true);
  });
});

describe("callClaude", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("throws AiNotConfiguredError when no API key is set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(callClaude("system", "user")).rejects.toThrow(AiNotConfiguredError);
  });

  it("returns the text content on a successful response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "This is the explanation." }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await callClaude("system prompt", "user prompt");
    expect(result).toBe("This is the explanation.");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(options.headers["x-api-key"]).toBe("sk-test-key");
    const body = JSON.parse(options.body);
    expect(body.system).toBe("system prompt");
    expect(body.messages[0].content).toBe("user prompt");
  });

  it("throws a clear error on a non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "invalid api key",
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(callClaude("system", "user")).rejects.toThrow(/401/);
  });

  it("throws if the response contains no text block", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "tool_use" }] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(callClaude("system", "user")).rejects.toThrow(/no text content/);
  });

  it("uses the AI_MODEL env override when set", async () => {
    process.env.AI_MODEL = "claude-haiku-4-5-20251001";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "ok" }] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await callClaude("system", "user");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("claude-haiku-4-5-20251001");
    delete process.env.AI_MODEL;
  });
});
