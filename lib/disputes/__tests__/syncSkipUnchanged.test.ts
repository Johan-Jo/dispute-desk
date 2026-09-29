import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));

import { isUnchangedClosedDispute, stableStringify, syncDriftDetected } from "../syncDisputes";

const NOW = Date.parse("2026-09-29T12:00:00Z");
const node = { id: "gid://shopify/ShopifyPaymentsDispute/1", status: "WON", amount: { amount: "10.0", currencyCode: "EUR" }, evidenceSentOn: "2026-08-01" };
// jsonb returns keys sorted, not in insertion order.
const storedRaw = { amount: { currencyCode: "EUR", amount: "10.0" }, evidenceSentOn: "2026-08-01", id: node.id, status: "WON" };
const fresh = new Date(NOW - 60 * 60 * 1000).toISOString();

describe("stableStringify", () => {
  it("ignores key order", () => {
    expect(stableStringify(node)).toBe(stableStringify(storedRaw));
  });
});

describe("isUnchangedClosedDispute", () => {
  it("skips a closed dispute whose node matches what we stored within the day", () => {
    expect(isUnchangedClosedDispute({ status: "won", raw_snapshot: storedRaw, last_synced_at: fresh }, node, NOW)).toBe(true);
  });

  it("never skips an open dispute", () => {
    const open = { ...node, status: "NEEDS_RESPONSE" };
    expect(isUnchangedClosedDispute({ status: "needs_response", raw_snapshot: { ...storedRaw, status: "NEEDS_RESPONSE" }, last_synced_at: fresh }, open, NOW)).toBe(false);
  });

  it("applies when Shopify's node changed", () => {
    expect(isUnchangedClosedDispute({ status: "won", raw_snapshot: { ...storedRaw, status: "UNDER_REVIEW" }, last_synced_at: fresh }, node, NOW)).toBe(false);
  });

  it("applies when our row is not closed yet (a webhook-free transition)", () => {
    expect(isUnchangedClosedDispute({ status: "under_review", raw_snapshot: storedRaw, last_synced_at: fresh }, node, NOW)).toBe(false);
  });

  it("re-applies every closed dispute once a day", () => {
    const stale = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();
    expect(isUnchangedClosedDispute({ status: "won", raw_snapshot: storedRaw, last_synced_at: stale }, node, NOW)).toBe(false);
  });

  it("applies when nothing was stored", () => {
    expect(isUnchangedClosedDispute(undefined, node, NOW)).toBe(false);
    expect(isUnchangedClosedDispute({ status: "won", raw_snapshot: null, last_synced_at: fresh }, node, NOW)).toBe(false);
  });
});

describe("syncDriftDetected", () => {
  it("counts only new disputes and real transitions, not re-applied ones", () => {
    expect(syncDriftDetected({ created: 0, changed: 0 })).toBe(false);
    expect(syncDriftDetected({ created: 0 })).toBe(false);
    expect(syncDriftDetected({ created: 1, changed: 0 })).toBe(true);
    expect(syncDriftDetected({ created: 0, changed: 2 })).toBe(true);
  });
});
