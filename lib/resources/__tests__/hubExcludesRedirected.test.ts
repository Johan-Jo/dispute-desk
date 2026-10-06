import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Merging an article into another sets `redirect_to_localization_id` on the
 * old row. The old row stays `is_published` (the detail route needs it to issue
 * the 301), so every hub list/count/related query must filter it out — otherwise
 * the hub keeps linking to a URL that only redirects (2026-10-06: the retired
 * VAMP article sat on page 1 next to the pillar that replaced it).
 */

const calls: Array<{ method: string; args: unknown[] }> = [];

function chain(): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop: string) {
      if (prop === "then") {
        // awaiting the chain resolves like a supabase response
        return (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 });
      }
      return (...args: unknown[]) => {
        calls.push({ method: prop, args });
        return proxy;
      };
    },
  };
  const proxy: unknown = new Proxy({}, handler);
  return proxy;
}

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({ from: () => chain() }),
}));

import {
  countPublishedByPillar,
  countPublishedForRoute,
  findLocalizationBySlugAnyLocale,
  listPublishedByRoute,
  getRelatedResources,
} from "../queries";

const filtersRedirected = () =>
  calls.some((c) => c.method === "is" && c.args[0] === "redirect_to_localization_id" && c.args[1] === null);

describe("hub queries skip redirected localizations", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("listPublishedByRoute", async () => {
    await listPublishedByRoute("resources", "en-US", { includeTotal: false });
    expect(filtersRedirected()).toBe(true);
  });

  it("countPublishedForRoute", async () => {
    await countPublishedForRoute("resources", "en-US");
    expect(filtersRedirected()).toBe(true);
  });

  it("countPublishedByPillar", async () => {
    await countPublishedByPillar("resources", "en-US");
    expect(filtersRedirected()).toBe(true);
  });

  it("getRelatedResources (curated + pillar fallback)", async () => {
    await getRelatedResources({
      routeKind: "resources",
      locale: "en-US",
      pillar: "chargebacks",
      excludeItemId: "00000000-0000-0000-0000-000000000000",
      curatedIds: ["11111111-1111-1111-1111-111111111111"],
    });
    const n = calls.filter((c) => c.method === "is" && c.args[0] === "redirect_to_localization_id").length;
    expect(n).toBeGreaterThanOrEqual(2); // both phases
  });

  it("the slug resolver still sees redirected rows (it exists to redirect them)", async () => {
    await findLocalizationBySlugAnyLocale({ slug: "anything" });
    expect(filtersRedirected()).toBe(false);
  });
});
