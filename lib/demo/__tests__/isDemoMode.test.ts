import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isDemoMode, isDemoRequest, clearDemoMode, DEMO_QUERY_KEY } from "../isDemoMode";

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

describe("isDemoMode — sticky session", () => {
  const originalEnv = process.env.NEXT_PUBLIC_DISPUTEDESK_DEMO_MODE;
  let store: Record<string, string>;
  let originalWindow: unknown;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_DISPUTEDESK_DEMO_MODE;
    store = {};
    originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window: unknown }).window = {
      sessionStorage: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
      },
      location: { search: "" },
    };
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_DISPUTEDESK_DEMO_MODE;
    else process.env.NEXT_PUBLIC_DISPUTEDESK_DEMO_MODE = originalEnv;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = originalWindow;
    }
  });

  it("?demo=true persists across subsequent calls without the param", () => {
    expect(isDemoMode(new URLSearchParams("demo=true"))).toBe(true);
    expect(isDemoMode(new URLSearchParams(""))).toBe(true);
    expect(store["dd_demo_mode"]).toBe("1");
  });

  it("?demo=off clears the sticky flag and disables demo", () => {
    isDemoMode(new URLSearchParams("demo=true"));
    expect(store["dd_demo_mode"]).toBe("1");

    expect(isDemoMode(new URLSearchParams("demo=off"))).toBe(false);
    expect(store["dd_demo_mode"]).toBeUndefined();
    expect(isDemoMode(new URLSearchParams(""))).toBe(false);
  });

  it("clearDemoMode() removes the session flag", () => {
    isDemoMode(new URLSearchParams("demo=true"));
    clearDemoMode();
    expect(store["dd_demo_mode"]).toBeUndefined();
    expect(isDemoMode(new URLSearchParams(""))).toBe(false);
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
