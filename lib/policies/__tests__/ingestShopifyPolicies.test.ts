/**
 * Published-policy ingest — type mapping, HTML strip, dedup-by-hash,
 * and that only mapped/non-empty policies become snapshots.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { htmlToPlainText } from "../ingestShopifyPolicies";
import {
  mapShopPolicyType,
  type ShopPolicyType,
} from "@/lib/shopify/queries/shopPolicies";

// ---- mocks ----------------------------------------------------------
const makeAuthedRequest = vi.fn();
vi.mock("@/lib/shopify/makeAuthedRequest", () => ({
  makeAuthedRequest: (...args: unknown[]) => makeAuthedRequest(...args),
}));

const inserted: Record<string, unknown>[] = [];
let latestHashByPolicy: Record<string, string | undefined> = {};

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      // read chain → resolves to { data: { content_hash } | null }
      Object.assign(builder, {
        select: chain,
        eq() {
          return builder;
        },
        order: chain,
        limit: chain,
        maybeSingle: async () => {
          const id = builder.__shopifyPolicyId as string | undefined;
          const hash = id ? latestHashByPolicy[id] : undefined;
          return { data: hash ? { content_hash: hash } : null };
        },
        // capture the shopify_policy_id filter so maybeSingle can look up the hash
        insert: async (row: Record<string, unknown>) => {
          inserted.push(row);
          return { error: null };
        },
      });
      // intercept .eq("shopify_policy_id", id) to remember the id
      const origEq = builder.eq as () => unknown;
      builder.eq = (col?: string, val?: string) => {
        if (col === "shopify_policy_id") builder.__shopifyPolicyId = val;
        return origEq();
      };
      return builder;
    },
  }),
}));

import { ingestShopifyPolicies } from "../ingestShopifyPolicies";

function policy(
  type: ShopPolicyType,
  body: string,
  overrides: Partial<{ id: string; url: string; updatedAt: string }> = {},
) {
  return {
    id: overrides.id ?? `gid://shopify/ShopPolicy/${type}`,
    type,
    title: type,
    body,
    url: overrides.url ?? `https://store.example/policies/${type}`,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-06-01T00:00:00Z",
  };
}

beforeEach(() => {
  inserted.length = 0;
  latestHashByPolicy = {};
  makeAuthedRequest.mockReset();
});

// ---- pure helpers ---------------------------------------------------
describe("htmlToPlainText", () => {
  it("strips tags, decodes entities, collapses whitespace", () => {
    const out = htmlToPlainText(
      "<h2>Refunds</h2><p>30&nbsp;days &amp; no questions.</p><br/>Email&nbsp;us.",
    );
    expect(out).toContain("Refunds");
    expect(out).toContain("30 days & no questions.");
    expect(out).not.toMatch(/<[^>]+>/);
  });

  it("returns empty string for tag-only / blank HTML", () => {
    expect(htmlToPlainText("<p></p>")).toBe("");
    expect(htmlToPlainText("")).toBe("");
  });
});

describe("mapShopPolicyType", () => {
  it("maps known types to internal policy_type", () => {
    expect(mapShopPolicyType("REFUND_POLICY")).toBe("refunds");
    expect(mapShopPolicyType("SHIPPING_POLICY")).toBe("shipping");
    expect(mapShopPolicyType("TERMS_OF_SERVICE")).toBe("terms");
    expect(mapShopPolicyType("PRIVACY_POLICY")).toBe("privacy");
    expect(mapShopPolicyType("CONTACT_INFORMATION")).toBe("contact");
    expect(mapShopPolicyType("SUBSCRIPTION_POLICY")).toBe("subscription");
  });

  it("returns null for untracked types", () => {
    expect(mapShopPolicyType("LEGAL_NOTICE")).toBeNull();
    expect(mapShopPolicyType("TERMS_OF_SALE")).toBeNull();
  });
});

// ---- ingest end-to-end (mocked) ------------------------------------
describe("ingestShopifyPolicies", () => {
  it("inserts shopify_published snapshots for mapped, non-empty policies", async () => {
    makeAuthedRequest.mockResolvedValue({
      data: {
        shop: {
          shopPolicies: [
            policy("REFUND_POLICY", "<p>Full refunds within 30 days.</p>"),
            policy("SHIPPING_POLICY", "<p>Ships in 2 days.</p>"),
            policy("LEGAL_NOTICE", "<p>Ignored type.</p>"),
            policy("PRIVACY_POLICY", "<p></p>"), // empty body → skipped
          ],
        },
      },
    });

    const res = await ingestShopifyPolicies("shop-1");

    expect(res.ok).toBe(true);
    expect(res.ingested).toBe(2);
    const types = inserted.map((r) => r.policy_type).sort();
    expect(types).toEqual(["refunds", "shipping"]);
    for (const row of inserted) {
      expect(row.source).toBe("shopify_published");
      expect(row.published_url).toMatch(/^https:\/\/store\.example/);
      expect(row.content_hash).toBeTruthy();
    }
  });

  it("skips a policy whose latest snapshot already has the same content hash", async () => {
    const body = "<p>Full refunds within 30 days.</p>";
    // First run to learn the hash the code will compute.
    makeAuthedRequest.mockResolvedValue({
      data: { shop: { shopPolicies: [policy("REFUND_POLICY", body)] } },
    });
    await ingestShopifyPolicies("shop-1");
    const firstHash = inserted[0].content_hash as string;

    // Second run: pretend the latest stored snapshot already has that hash.
    inserted.length = 0;
    latestHashByPolicy["gid://shopify/ShopPolicy/REFUND_POLICY"] = firstHash;

    const res = await ingestShopifyPolicies("shop-1");
    expect(res.ingested).toBe(0);
    expect(res.unchanged).toBe(1);
    expect(inserted).toHaveLength(0);
  });

  it("returns ok:false and inserts nothing when data.shop is empty (drift)", async () => {
    makeAuthedRequest.mockResolvedValue({
      data: { shop: null },
      errors: [{ message: "undefinedField" }],
    });
    const res = await ingestShopifyPolicies("shop-1");
    expect(res.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("swallows thrown errors and reports ok:false", async () => {
    makeAuthedRequest.mockRejectedValue(new Error("network down"));
    const res = await ingestShopifyPolicies("shop-1");
    expect(res.ok).toBe(false);
    expect(res.ingested).toBe(0);
  });
});
