import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isDemoMode, isDemoRequest, DEMO_QUERY_KEY } from "../isDemoMode";

describe("isDemoMode", () => {
  const originalEnv = process.env.NEXT_PUBLIC_DISPUTEDESK_DEMO_MODE;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_DISPUTEDESK_DEMO_MODE;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_DISPUTEDESK_DEMO_MODE;
    else process.env.NEXT_PUBLIC_DISPUTEDESK_DEMO_MODE = originalEnv;
  });

  it("returns true when ?demo=true is in the searchParams", () => {
    const sp = new URLSearchParams(`${DEMO_QUERY_KEY}=true`);
    expect(isDemoMode(sp)).toBe(true);
  });

  it("returns true for truthy-ish values", () => {
    expect(isDemoMode(new URLSearchParams("demo=1"))).toBe(true);
    expect(isDemoMode(new URLSearchParams("demo=YES"))).toBe(true);
    expect(isDemoMode(new URLSearchParams("demo=True"))).toBe(true);
  });

  it("returns false when the param is missing or off", () => {
    expect(isDemoMode(new URLSearchParams(""))).toBe(false);
    expect(isDemoMode(new URLSearchParams("demo=false"))).toBe(false);
    expect(isDemoMode(new URLSearchParams("demo=0"))).toBe(false);
  });

  it("falls back to the env flag", () => {
    process.env.NEXT_PUBLIC_DISPUTEDESK_DEMO_MODE = "true";
    expect(isDemoMode(new URLSearchParams(""))).toBe(true);
  });
});

describe("isDemoRequest", () => {
  function mockReq(opts: { url?: string; header?: string }): {
    nextUrl: { searchParams: URLSearchParams };
    headers: { get(name: string): string | null };
  } {
    const url = opts.url ?? "https://example.com/api/whatever";
    const u = new URL(url);
    const headerVal = opts.header ?? null;
    return {
      nextUrl: { searchParams: u.searchParams },
      headers: {
        get: (name: string) => (name.toLowerCase() === "x-dd-demo" ? headerVal : null),
      },
    };
  }

  it("returns true when ?demo=true is on the URL", () => {
    expect(
      isDemoRequest(mockReq({ url: "https://x/api/y?demo=true" }) as never),
    ).toBe(true);
  });

  it("returns true when x-dd-demo header is set", () => {
    expect(
      isDemoRequest(mockReq({ header: "true" }) as never),
    ).toBe(true);
  });

  it("returns false on a clean request", () => {
    expect(isDemoRequest(mockReq({}) as never)).toBe(false);
  });
});
