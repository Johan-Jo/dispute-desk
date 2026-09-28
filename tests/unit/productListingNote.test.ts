/**
 * Not-as-described PR 3c — what the Evidence tab says about the listing.
 */
import { describe, it, expect } from "vitest";
import { productListingNote } from "@/app/(embedded)/app/disputes/[id]/tabs/useEvidenceSections";
import en from "@/messages/en.json";

const t = (key: string, params?: Record<string, string | number>) => {
  const v = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], (en as { disputes: unknown }).disputes);
  return String(v).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? ""));
};
const item = (payload: Record<string, unknown>) => [{ source: "shopify_product", payload }];

describe("productListingNote", () => {
  it("collected: names the listing and the date, and says it is today's version", () => {
    const n = productListingNote(item({ listings: [{ title: "Linen cushion cover", fetchedAt: "2026-09-28T10:00:00Z" }], outcomes: [] }), t);
    expect(n.present).toBe(
      "Collected from your store on 2026-09-28: Linen cushion cover This is your listing as it is today. Shopify doesn't keep how it looked when the order was placed.",
    );
    expect(n.missing).toBeNull();
  });

  it("not collected: explains why, and asks for access only when that is the cause", () => {
    const deleted = productListingNote(item({ listings: [], outcomes: [{ outcome: "deleted" }] }), t);
    expect(deleted.missing).toMatch(/deleted from your store/);
    expect(deleted.needsAccess).toBe(false);
    const denied = productListingNote(item({ listings: [], outcomes: [{ outcome: "absent" }, { outcome: "inaccessible" }] }), t);
    expect(denied.missing).toMatch(/can't read your products/);
    expect(denied.needsAccess).toBe(true);
  });

  it("no collector section (flag off): says nothing new", () => {
    expect(productListingNote([], t)).toEqual({ present: null, missing: null, needsAccess: false });
  });
});
