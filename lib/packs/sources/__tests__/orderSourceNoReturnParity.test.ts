/**
 * PR 0 parity (docs/plans/single-source-architecture-audit.plan.md §2.2/§2.4):
 * moving the collector's `no_return_initiated` emission decision into
 * `noReturnFactVerdict` must not change ONE byte of what `collectOrderEvidence`
 * returns, for any combination of return status, refund total, refund entries,
 * returns-outside-Shopify setting and merchant answer.
 *
 * Two independent checks:
 *  1. a sha256 of the collector's COMPLETE output per grid cell, captured from
 *     the code BEFORE the extraction (`__fixtures__/orderSourceNoReturnParity.json`);
 *  2. the emission rule restated from the pre-extraction source, as an
 *     independent expectation of whether `no_return_initiated` is present.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OrderDetailNode } from "@/lib/shopify/queries/orders";
import { collectOrderEvidence } from "../orderSource";
import type { BuildContext } from "../../types";

const STATUSES: Array<string | null> = [
  null,
  "NO_RETURN",
  "RETURN_REQUESTED",
  "IN_PROGRESS",
  "RETURNED",
  "INSPECTION_COMPLETE",
  "RETURN_FAILED",
  "A_STATUS_SHOPIFY_ADDS_LATER",
  "",
];
const REFUNDED = ["0.00", "0.0", "12.50", "not-a-number", ""];
const ENTRIES = [0, 1] as const;
type Scope = BuildContext["returnScope"];
const SCOPES: Scope[] = [
  undefined,
  { returnsOutsideShopify: false, answer: null },
  { returnsOutsideShopify: true, answer: null },
  { returnsOutsideShopify: true, answer: "no_request_received" },
  { returnsOutsideShopify: true, answer: "request_received" },
  { returnsOutsideShopify: true, answer: "not_sure" },
  { returnsOutsideShopify: false, answer: "request_received" },
];

function ctxFor(status: string | null, refunded: string, entries: number, scope: Scope): BuildContext {
  const refunds = Array.from({ length: entries }, (_, i) => ({
    id: `gid://shopify/Refund/${i + 1}`,
    createdAt: "2026-10-20T10:00:00Z",
    note: null,
    totalRefundedSet: { shopMoney: { amount: refunded, currencyCode: "SEK" } },
  }));
  return {
    packId: "p1",
    disputeId: "d1",
    shopId: "s1",
    disputeReason: "CREDIT_NOT_PROCESSED",
    orderGid: "gid://shopify/Order/1",
    shopDomain: "t.myshopify.com",
    accessToken: "x",
    disputeAmount: 618,
    disputeCurrency: "SEK",
    disputeInitiatedAt: "2026-10-27T00:00:00Z",
    order: {
      id: "gid://shopify/Order/1",
      name: "#24612",
      createdAt: "2026-10-01T07:08:00Z",
      displayFinancialStatus: "PAID",
      displayFulfillmentStatus: "FULFILLED",
      lineItems: { edges: [] },
      totalPriceSet: { shopMoney: { amount: "618.00", currencyCode: "SEK" } },
      subtotalPriceSet: { shopMoney: { amount: "618.00", currencyCode: "SEK" } },
      totalShippingPriceSet: { shopMoney: { amount: "0.00", currencyCode: "SEK" } },
      totalTaxSet: { shopMoney: { amount: "0.00", currencyCode: "SEK" } },
      totalDiscountsSet: { shopMoney: { amount: "0.00", currencyCode: "SEK" } },
      totalRefundedSet: { shopMoney: { amount: refunded, currencyCode: "SEK" } },
      billingAddress: null,
      shippingAddress: null,
      transactions: [],
      refunds,
      events: { edges: [] },
      customer: null,
      fulfillments: [],
      returnStatus: status,
    } as unknown as OrderDetailNode,
    paymentContext: { family: "card", raw: null, label: "Card", cardNetwork: null },
    returnScope: scope,
  } as BuildContext;
}

/** The emission rule exactly as the collector stated it BEFORE the extraction. */
function legacyEmits(status: string | null, refunded: string, scope: Scope): boolean {
  const answer = scope?.answer ?? null;
  const scopeEmits = answer !== "request_received";
  const refundedNum = Number.parseFloat(refunded);
  const refundSome = Number.isFinite(refundedNum) && refundedNum > 0;
  // shopifyRecordsReturnOrRefund: refund some, or a non-null status that is not NO_RETURN.
  const recorded = refundSome || (status != null && status !== "NO_RETURN");
  return status === "NO_RETURN" && !recorded && scopeEmits;
}

const FIXTURE = join(__dirname, "__fixtures__", "orderSourceNoReturnParity.json");
const key = (s: string | null, r: string, e: number, sc: Scope) => `${s}|${r}|${e}|${JSON.stringify(sc ?? null)}`;

describe("PR 0 parity: collectOrderEvidence output is unchanged by the verdict extraction", () => {
  it("matches the digests captured before the extraction, and the legacy emission rule", async () => {
    const actual: Record<string, string> = {};
    for (const status of STATUSES)
      for (const refunded of REFUNDED)
        for (const entries of ENTRIES)
          for (const scope of SCOPES) {
            const sections = await collectOrderEvidence(ctxFor(status, refunded, entries, scope));
            const emitted = sections.some((s) => s.fieldsProvided.includes("no_return_initiated"));
            expect(emitted, key(status, refunded, entries, scope)).toBe(legacyEmits(status, refunded, scope));
            actual[key(status, refunded, entries, scope)] = createHash("sha256")
              .update(JSON.stringify(sections))
              .digest("hex");
          }

    if (process.env.CAPTURE_PARITY_FIXTURE === "1") {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, JSON.stringify(actual, null, 1) + "\n");
      return;
    }
    expect(existsSync(FIXTURE), "fixture missing: capture it from the PRE-extraction code").toBe(true);
    const expected = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, string>;
    expect(Object.keys(actual).length).toBe(STATUSES.length * REFUNDED.length * ENTRIES.length * SCOPES.length);
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const k of Object.keys(expected)) expect(actual[k], k).toBe(expected[k]);
  });
});
