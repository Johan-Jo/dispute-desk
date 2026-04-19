import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";

const SESSION = { shopDomain: "test.myshopify.com", accessToken: "x" };

describe("requestShopifyGraphQL — abort on timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aborts the fetch when timeoutMs elapses and propagates a timeout error after exhausting retries", async () => {
    // fetch hangs forever — we only resolve when its AbortSignal fires.
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            (err as Error & { name: string }).name = "AbortError";
            reject(err);
          });
        }),
    );

    // Attach the rejection assertion synchronously *before* advancing
    // timers so the rejection isn't briefly unhandled when the abort
    // signal fires.
    const expectation = expect(
      requestShopifyGraphQL({
        session: SESSION,
        query: "{ shop { id } }",
        timeoutMs: 100,
        maxRetries: 2,
      }),
    ).rejects.toThrow(/timed out after 100ms across 3 attempt/);

    // Two retries with backoff (1s + 2s) + three timeout windows.
    await vi.runAllTimersAsync();
    await expectation;
    expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("does not retry when an unrelated error is thrown", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockRejectedValue(
      new Error("ECONNREFUSED"),
    );

    const promise = requestShopifyGraphQL({
      session: SESSION,
      query: "{ shop { id } }",
      maxRetries: 3,
      timeoutMs: 1000,
    });

    await expect(promise).rejects.toThrow(/ECONNREFUSED/);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no retries on non-abort errors
  });

  it("succeeds on first attempt when fetch resolves before the timer", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { shop: { id: "ok" } } }), { status: 200 }),
    );

    const result = await requestShopifyGraphQL<{ shop: { id: string } }>({
      session: SESSION,
      query: "{ shop { id } }",
      timeoutMs: 5000,
    });

    expect(result.data?.shop.id).toBe("ok");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
