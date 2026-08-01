/**
 * Policy source — evidence eligibility by provenance.
 *
 * Pins the source-of-truth rule: only citable sources
 * (shopify_published / uploaded / external_url) become bank evidence;
 * `template` drafts are excluded, and the live published_url is carried
 * through for the PDF's disclosure citation.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { BuildContext } from "../../types";

// The collector runs a defensive refresh first — make it a no-op here.
const ingestShopifyPolicies = vi.fn().mockResolvedValue({
  ok: true,
  ingested: 0,
  unchanged: 0,
});
vi.mock("@/lib/policies/ingestShopifyPolicies", () => ({
  ingestShopifyPolicies: (...a: unknown[]) => ingestShopifyPolicies(...a),
}));

let rows: Record<string, unknown>[] = [];
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: rows }),
        }),
      }),
    }),
  }),
}));

import { collectPolicyEvidence } from "../policySource";

const ctx: BuildContext = {
  packId: "p1",
  disputeId: "d1",
  shopId: "s1",
  disputeReason: "fraudulent",
  orderGid: null,
  shopDomain: "test.myshopify.com",
  accessToken: "x",
  order: null,
  paymentContext: { family: "unknown", raw: null, label: null, cardNetwork: null },
  priorHistory: null,
  disputeInitiatedAt: null,
  disputeAmount: null,
  disputeCurrency: null,
  disputePhase: null,
};

function row(
  policy_type: string,
  source: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `${policy_type}-${source}`,
    policy_type,
    source,
    published_url:
      source === "shopify_published"
        ? `https://store.example/policies/${policy_type}`
        : null,
    storage_path: source === "uploaded" ? `s1/${policy_type}/1.pdf` : null,
    content_hash: "hash",
    extracted_text: "Policy text.",
    captured_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  rows = [];
  ingestShopifyPolicies.mockClear();
});

describe("collectPolicyEvidence", () => {
  it("runs the defensive published-policy refresh before reading", async () => {
    rows = [row("refunds", "shopify_published")];
    await collectPolicyEvidence(ctx);
    expect(ingestShopifyPolicies).toHaveBeenCalledWith("s1");
  });

  it("excludes template drafts from fieldsProvided and the policy section", async () => {
    rows = [
      row("refunds", "template"),
      row("shipping", "shopify_published"),
    ];
    const sections = await collectPolicyEvidence(ctx);
    const combined = sections.find((s) => s.type === "policy");
    expect(combined?.fieldsProvided).toEqual(["shipping_policy"]);
    const policies = (combined?.data.policies ?? []) as Record<
      string,
      unknown
    >[];
    expect(policies.map((p) => p.policyType)).toEqual(["shipping"]);
  });

  it("carries publishedUrl through for the disclosure citation", async () => {
    rows = [row("refunds", "shopify_published")];
    const sections = await collectPolicyEvidence(ctx);
    const combined = sections.find((s) => s.type === "policy");
    const policies = combined?.data.policies as Record<string, unknown>[];
    expect(policies[0].source).toBe("shopify_published");
    expect(policies[0].publishedUrl).toBe(
      "https://store.example/policies/refunds",
    );
  });

  it("returns [] when only template drafts exist (nothing citable)", async () => {
    rows = [row("refunds", "template"), row("terms", "template")];
    const sections = await collectPolicyEvidence(ctx);
    expect(sections).toEqual([]);
  });

  it("keeps the latest eligible snapshot per type (dedup)", async () => {
    rows = [
      row("refunds", "shopify_published", {
        id: "new",
        captured_at: "2026-06-10T00:00:00Z",
      }),
      row("refunds", "uploaded", {
        id: "old",
        captured_at: "2026-01-01T00:00:00Z",
      }),
    ];
    const sections = await collectPolicyEvidence(ctx);
    const combined = sections.find((s) => s.type === "policy");
    const policies = combined?.data.policies as Record<string, unknown>[];
    expect(policies).toHaveLength(1);
    expect(policies[0].policySnapshotId).toBe("new");
  });
});
