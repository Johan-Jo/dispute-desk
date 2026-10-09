import { describe, it, expect, vi, beforeEach } from "vitest";

const requestHeaders = new Map<string, string>();
const requestCookies = new Map<string, string>();
const shopLookups: string[] = [];
let storedLocale: string | null = "sv";

// `cache` only exists in React's server (RSC) build, which vitest doesn't load.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T,>(fn: T) => fn,
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => requestHeaders.get(k) ?? null }),
  cookies: async () => ({
    get: (k: string) =>
      requestCookies.has(k) ? { value: requestCookies.get(k)! } : undefined,
  }),
}));

vi.mock("@/lib/admin/impersonation", () => ({
  IMPERSONATION_COOKIE: "dd_impersonation",
  IMPERSONATION_MODE_HEADER: "x-dd-impersonation-mode",
  // Stand-in for the HMAC check: only this exact value is a valid cookie.
  verifyImpersonationValue: async (raw: string | undefined) =>
    raw === "signed-ok" ? { shopId: "shop-from-cookie", mode: "read" } : null,
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => {
          shopLookups.push(id);
          return { maybeSingle: async () => ({ data: { locale: storedLocale } }) };
        },
      }),
    }),
  }),
}));

import { getEmbeddedRequestLocale } from "../embeddedRequestLocale";

beforeEach(() => {
  requestHeaders.clear();
  requestCookies.clear();
  shopLookups.length = 0;
  storedLocale = "sv";
});

describe("getEmbeddedRequestLocale", () => {
  it("is null without an embedded signal, so portal/auth keep their own resolution", async () => {
    requestCookies.set("dd_locale", "de");
    requestHeaders.set("accept-language", "fr-FR");

    expect(await getEmbeddedRequestLocale()).toBeNull();
    expect(shopLookups).toEqual([]);
  });

  it("uses Shopify's Admin language over the cookie", async () => {
    requestHeaders.set("x-shopify-locale", "sv");
    requestCookies.set("dd_locale", "en");

    expect(await getEmbeddedRequestLocale()).toBe("sv");
  });

  it("renders English for a Shopify language we don't ship", async () => {
    requestHeaders.set("x-shopify-locale", "da");
    requestHeaders.set("accept-language", "sv-SE");

    expect(await getEmbeddedRequestLocale()).toBe("en");
  });

  it("under impersonation uses the store's locale, keyed on the signed cookie's shop", async () => {
    requestHeaders.set("x-dd-impersonation-mode", "read");
    requestHeaders.set("x-shop-id", "shop-from-header");
    requestCookies.set("dd_impersonation", "signed-ok");
    requestCookies.set("dd_locale", "en");

    expect(await getEmbeddedRequestLocale()).toBe("sv");
    expect(shopLookups).toEqual(["shop-from-cookie"]);
  });

  it("ignores spoofed impersonation headers without a valid signed cookie", async () => {
    requestHeaders.set("x-dd-impersonation-mode", "read");
    requestHeaders.set("x-shop-id", "victim-shop");

    expect(await getEmbeddedRequestLocale()).toBeNull();
    expect(shopLookups).toEqual([]);
  });

  it("does not apply the impersonation cookie outside an impersonated /app request", async () => {
    requestCookies.set("dd_impersonation", "signed-ok");

    expect(await getEmbeddedRequestLocale()).toBeNull();
    expect(shopLookups).toEqual([]);
  });

  it("an explicit ?locale= wins over the store locale under impersonation", async () => {
    requestHeaders.set("x-dd-impersonation-mode", "write");
    requestHeaders.set("x-shopify-locale", "de");
    requestCookies.set("dd_impersonation", "signed-ok");

    expect(await getEmbeddedRequestLocale()).toBe("de");
    expect(shopLookups).toEqual([]);
  });

  it("treats the column default as English", async () => {
    storedLocale = "en-US";
    requestHeaders.set("x-dd-impersonation-mode", "read");
    requestCookies.set("dd_impersonation", "signed-ok");
    requestCookies.set("dd_locale", "pt");

    expect(await getEmbeddedRequestLocale()).toBe("en");
  });
});
