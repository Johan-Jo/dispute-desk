/**
 * The fatal-loss alert must tell the merchant what to DO, and must be honest
 * about what was and was not filed.
 *
 * Context: the fatal-loss gate stands DisputeDesk down, but Shopify still
 * files its own scrape of the order at the deadline. Before 2026-09-04 the
 * merchant's only signal was a line of in-app strength copy explaining the
 * verdict — no action, no email. Found on blume-box #360499.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      if (table === "shop_setup") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { steps: { team: { payload: { teamEmail: "ops@blume-box.test" } } } },
              }),
            }),
          }),
        };
      }
      // shops
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { shop_domain: "blume-box.myshopify.com" } }),
          }),
        }),
      };
    },
  }),
}));

import { sendFatalLossAlert } from "../sendFatalLossAlert";

const BASE = {
  shopId: "shop-1",
  disputeId: "8d8a1db7-17b2-415a-befe-ab65b757affb",
  disputeGid: "gid://shopify/Dispute/123",
  disputeReason: "PRODUCT_NOT_RECEIVED",
  amount: 85.41,
  currencyCode: "USD",
  dueAt: "2026-09-11T23:00:00Z",
  orderName: "#360499",
} as const;

function sentBody(): { subject: string; html: string; text: string } {
  const call = sendMock.mock.calls.at(-1)?.[0];
  return { subject: call.subject, html: call.html, text: call.text };
}

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ error: null });
  process.env.RESEND_API_KEY = "test-key";
});

describe("inr_no_fulfillment — the two-cause ask", () => {
  it("offers BOTH branches: add tracking, or refund", async () => {
    const r = await sendFatalLossAlert({ ...BASE, reason: "inr_no_fulfillment" });
    expect(r.ok).toBe(true);
    const { html } = sentBody();
    // Cause 2 — shipped but never marked fulfilled. Asking for this is the
    // whole point: without it we silently concede a WINNABLE case.
    expect(html).toContain("tracking number");
    // Cause 1 — genuinely never shipped.
    expect(html).toMatch(/refund the order/i);
  });

  it("names the order and the amount so it is actionable from the inbox", async () => {
    await sendFatalLossAlert({ ...BASE, reason: "inr_no_fulfillment" });
    const { subject, html } = sentBody();
    expect(subject).toContain("#360499");
    expect(html).toContain("#360499");
    expect(html).toContain("USD 85.41");
  });

  it("says WE filed nothing, and that Shopify still sends its own scrape", async () => {
    // The honesty pair. "We filed nothing" alone is incomplete (Shopify files
    // anyway); "nothing has been filed" alone is FALSE — that was the
    // 2026-07-30 defect in the deadline-fallback email.
    await sendFatalLossAlert({ ...BASE, reason: "inr_no_fulfillment" });
    const { html } = sentBody();
    expect(html).toMatch(/DisputeDesk has <strong>not<\/strong> sent a defence/);
    expect(html).toMatch(/Shopify will pass on the basic order details/);
    expect(html).not.toMatch(/nothing has been filed/i);
  });

  it("never claims we submitted or will submit evidence", async () => {
    await sendFatalLossAlert({ ...BASE, reason: "inr_no_fulfillment" });
    const { html, text } = sentBody();
    for (const body of [html, text]) {
      expect(body).not.toMatch(/we (have )?submitted/i);
      expect(body).not.toMatch(/we will (submit|file) (your |the )?evidence/i);
    }
  });

  it("links straight to the dispute", async () => {
    await sendFatalLossAlert({ ...BASE, reason: "inr_no_fulfillment" });
    expect(sentBody().html).toContain("admin.shopify.com/store/blume-box");
  });
});

describe("refund_issued — do not chase the merchant", () => {
  it("leads with 'no action needed' rather than an ask", async () => {
    const r = await sendFatalLossAlert({
      ...BASE,
      reason: "refund_issued",
      disputeReason: "FRAUDULENT",
    });
    expect(r.ok).toBe(true);
    const { subject, html } = sentBody();
    expect(subject).toMatch(/no action needed/i);
    expect(html).toMatch(/No action needed/);
    // Never tell a merchant who already refunded to go add tracking.
    expect(html).not.toContain("tracking number");
  });

  it("still surfaces the pre-dispute-credit escape hatch", async () => {
    // A credit issued BEFORE the dispute is among the strongest representments
    // available — the gate cannot always tell, so the merchant is invited to.
    await sendFatalLossAlert({ ...BASE, reason: "refund_issued" });
    expect(sentBody().html).toMatch(/BEFORE the customer disputed/);
  });
});

describe("guards", () => {
  it("does not send without a configured team email", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { steps: {} } }),
              single: async () => ({ data: null }),
            }),
          }),
        }),
      }),
    }));
    const mod = await import("../sendFatalLossAlert");
    const r = await mod.sendFatalLossAlert({ ...BASE, reason: "inr_no_fulfillment" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/team email/i);
  });

  it("does not throw when Resend fails", async () => {
    sendMock.mockResolvedValue({ error: { message: "rate limited" } });
    const r = await sendFatalLossAlert({ ...BASE, reason: "inr_no_fulfillment" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("rate limited");
  });
});
