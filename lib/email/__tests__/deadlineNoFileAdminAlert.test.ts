import { describe, expect, it } from "vitest";
import { buildDeadlineNoFileAdminAlert } from "../sendDeadlineNoFileAdminAlert";

describe("buildDeadlineNoFileAdminAlert", () => {
  const base = {
    shopDomain: "blume-box.myshopify.com",
    orderName: "#353605",
    disputeId: "77eb59a3",
    reason: "PRODUCT_NOT_RECEIVED",
    amount: 75,
    currencyCode: "USD",
    dueAt: "2026-08-11T23:00:00+00:00",
    refusal: "unsafe_address_claim",
  };

  it("names the shop, order and refusal, and says nothing was filed", () => {
    const { subject, text } = buildDeadlineNoFileAdminAlert({
      ...base,
      detail: { packageId: "e3343f7d", version: 5, unsafeReasons: ["affirmative_address_delivery_claim"] },
    });
    expect(subject).toBe("Deadline today — DisputeDesk filed nothing: blume-box.myshopify.com #353605");
    expect(text).toContain("Refusal: unsafe_address_claim");
    expect(text).toContain("Amount: 75 USD");
    expect(text).toContain('unsafeReasons: ["affirmative_address_delivery_claim"]');
    expect(text).toContain("Shopify submits its own");
  });

  it("drops empty detail values and escapes html", () => {
    const { text, html } = buildDeadlineNoFileAdminAlert({
      ...base,
      orderName: "<b>#1</b>",
      detail: { packageId: null, unsafeReasons: [], selectionReason: undefined },
    });
    expect(text).not.toContain("packageId");
    expect(text).not.toContain("unsafeReasons");
    expect(html).toContain("&lt;b&gt;#1&lt;/b&gt;");
  });
});
