import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/admin/auth", () => ({
  hasAdminSession: vi.fn(),
}));

import { hasAdminSession } from "@/lib/admin/auth";
import { POST } from "@/app/api/admin/resources/ai-assist/route";

const mockHasAdmin = vi.mocked(hasAdminSession);

describe("POST /api/admin/resources/ai-assist", () => {
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
    else delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
  });

  it("returns 401 when not authenticated", async () => {
    mockHasAdmin.mockResolvedValue(false);
    process.env.OPENAI_API_KEY = "sk-test";
    const req = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ action: "improve_readability", content: "hi" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("returns 503 when OPENAI_API_KEY is not set", async () => {
    mockHasAdmin.mockResolvedValue(true);
    const req = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ action: "improve_readability", content: "hi" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(503);
  });

  it("returns 400 for invalid action", async () => {
    mockHasAdmin.mockResolvedValue(true);
    process.env.OPENAI_API_KEY = "sk-test";
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "not_real", content: "hi" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when content is missing", async () => {
    mockHasAdmin.mockResolvedValue(true);
    process.env.OPENAI_API_KEY = "sk-test";
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "improve_readability" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 200 with result when OpenAI responds ok", async () => {
    mockHasAdmin.mockResolvedValue(true);
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Better text" } }],
          usage: { total_tokens: 42 },
        }),
      })
    );

    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "improve_readability", content: "Raw" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result: string; tokensUsed: number };
    expect(json.result).toBe("Better text");
    expect(json.tokensUsed).toBe(42);
  });
});
