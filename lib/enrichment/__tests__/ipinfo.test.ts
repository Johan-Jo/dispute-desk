import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchIpinfo } from "../ipinfo";

const originalFetch = global.fetch;

function ok(json: Record<string, unknown>): Response {
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function err(status: number, body: string = ""): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

describe("fetchIpinfo", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns null when apiKey is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await fetchIpinfo("1.2.3.4", undefined);
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("returns null when ip is empty", async () => {
    const result = await fetchIpinfo("", "key");
    expect(result).toBeNull();
  });

  it("normalises a happy-path response", async () => {
    global.fetch = vi.fn(async () =>
      ok({
        ip: "1.2.3.4",
        city: "San Francisco",
        region: "California",
        country: "US",
        loc: "37.7749,-122.4194",
        org: "AS15169 Google LLC",
        privacy: { vpn: false, proxy: false, hosting: false },
      }),
    ) as unknown as typeof fetch;

    const result = await fetchIpinfo("1.2.3.4", "key");
    expect(result).toEqual({
      ip: "1.2.3.4",
      city: "San Francisco",
      region: "California",
      country: "US",
      loc: "37.7749,-122.4194",
      org: "AS15169 Google LLC",
      privacy: { vpn: false, proxy: false, hosting: false },
    });
  });

  it("defaults missing privacy flags to false", async () => {
    global.fetch = vi.fn(async () =>
      ok({ ip: "1.2.3.4", city: "Tokyo", country: "JP" }),
    ) as unknown as typeof fetch;

    const result = await fetchIpinfo("1.2.3.4", "key");
    expect(result?.privacy).toEqual({ vpn: false, proxy: false, hosting: false });
    expect(result?.region).toBeNull();
    expect(result?.loc).toBeNull();
  });

  it("retries on 429 then succeeds", async () => {
    let n = 0;
    global.fetch = vi.fn(async () => {
      n++;
      if (n === 1) return err(429);
      return ok({ ip: "1.2.3.4", city: "Austin", country: "US" });
    }) as unknown as typeof fetch;

    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await fetchIpinfo("1.2.3.4", "key", { maxRetries: 2 });
    expect(result?.city).toBe("Austin");
    expect(n).toBe(2);
  });

  it("gives up with null after persistent 5xx", async () => {
    global.fetch = vi.fn(async () => err(502)) as unknown as typeof fetch;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await fetchIpinfo("1.2.3.4", "key", { maxRetries: 2 });
    expect(result).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("returns null without retrying on 4xx auth failure", async () => {
    global.fetch = vi.fn(async () => err(401, "bad token")) as unknown as typeof fetch;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await fetchIpinfo("1.2.3.4", "key", { maxRetries: 2 });
    expect(result).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns null after a network-layer abort across all retries", async () => {
    global.fetch = vi.fn(async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    }) as unknown as typeof fetch;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await fetchIpinfo("1.2.3.4", "key", { maxRetries: 1 });
    expect(result).toBeNull();
  });
});
