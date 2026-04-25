/**
 * Byte-equivalence test for composeShopifyMutationPayload.
 *
 * Plan v3 §3.A.2 demands that the merchant-facing "Raw view" in the
 * dispute Review tab be byte-equivalent to what `saveToShopifyJob` sends
 * to Shopify. We achieve that by routing both callers through this
 * single shared function. This test asserts:
 *
 * 1. The function is pure — same input produces same output across calls.
 * 2. Customer info is injected the same way for both callers.
 * 3. Manual attachments are appended the same way (URLs are inputs, not
 *    transformations performed inside the function).
 * 4. Fixtures cover the 6 reason families that drive reason-aware field
 *    routing.
 */

import { describe, expect, it } from "vitest";
import {
  composeShopifyMutationPayload,
  type ComposeShopifyMutationPayloadInput,
} from "../composeShopifyMutationPayload";
import type { RawPackSection } from "../fieldMapping";

function orderSection(): RawPackSection {
  return {
    type: "order",
    label: "Order",
    source: "shopify",
    data: {
      orderName: "#1235",
      total: "450.00",
      currency: "USD",
      lineItems: [
        { title: "Widget", quantity: 1, price: "450.00", sku: "WGT-001" },
      ],
      financialStatus: "paid",
    },
  };
}

function paymentSection(): RawPackSection {
  return {
    type: "other",
    label: "Payment Verification",
    source: "shopify",
    fieldsProvided: ["avs_cvv_match"],
    data: {
      avsResultCode: "Y",
      cvvResultCode: "M",
      cardCompany: "Visa",
      lastFour: "1234",
    },
  };
}

function shippingSection(): RawPackSection {
  return {
    type: "shipping",
    label: "Shipping",
    source: "shopify",
    data: {
      fulfillments: [
        {
          tracking: [{ carrier: "UPS", number: "1Z999AA10123456784" }],
          createdAt: "2026-04-13T00:00:00Z",
          deliveredAt: "2026-04-15T00:00:00Z",
        },
      ],
    },
  };
}

function baseInput(reason: string): ComposeShopifyMutationPayloadInput {
  return {
    sections: [orderSection(), paymentSection(), shippingSection()],
    rebuttalText:
      "This transaction was authorized and legitimate. AVS and CVV passed.",
    disputeReason: reason,
    customer: { displayName: "Emily Chen", email: "emily@example.com" },
    manualAttachments: [],
    pdfAttachment: null,
  };
}

describe("composeShopifyMutationPayload — byte-equivalence (plan v3 §3.A.2)", () => {
  it("is pure: identical inputs produce byte-identical output", () => {
    const input = baseInput("FRAUDULENT");
    const a = composeShopifyMutationPayload(input);
    const b = composeShopifyMutationPayload(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("splits customer displayName into firstName + lastName", () => {
    const input = baseInput("FRAUDULENT");
    const out = composeShopifyMutationPayload(input);
    expect(out.customerFirstName).toBe("Emily");
    expect(out.customerLastName).toBe("Chen");
    expect(out.customerEmailAddress).toBe("emily@example.com");
  });

  it("handles single-word displayName (lastName falls back to empty string)", () => {
    const input: ComposeShopifyMutationPayloadInput = {
      ...baseInput("FRAUDULENT"),
      customer: { displayName: "Cher", email: null },
    };
    const out = composeShopifyMutationPayload(input);
    expect(out.customerFirstName).toBe("Cher");
    expect(out.customerLastName).toBe("");
    expect(out.customerEmailAddress).toBeUndefined();
  });

  it("omits customer fields entirely when displayName + email are null", () => {
    const input: ComposeShopifyMutationPayloadInput = {
      ...baseInput("FRAUDULENT"),
      customer: { displayName: null, email: null },
    };
    const out = composeShopifyMutationPayload(input);
    expect(out.customerFirstName).toBeUndefined();
    expect(out.customerLastName).toBeUndefined();
    expect(out.customerEmailAddress).toBeUndefined();
  });

  it("preserves the buildEvidenceForShopify reason-aware routing across the 6 families", () => {
    // Each family must produce some payload (even if just rebuttal). The
    // exact field routing is owned by buildEvidenceForShopify and tested
    // separately; here we just verify composeShopifyMutationPayload doesn't
    // drop or mutate any reason in transit.
    for (const reason of [
      "FRAUDULENT",
      "PRODUCT_NOT_RECEIVED",
      "PRODUCT_UNACCEPTABLE",
      "SUBSCRIPTION_CANCELED",
      "CREDIT_NOT_PROCESSED",
      "DUPLICATE",
    ]) {
      const out = composeShopifyMutationPayload(baseInput(reason));
      expect(out.uncategorizedText).toContain(
        "This transaction was authorized and legitimate.",
      );
    }
  });

  it("appends the supporting-documents attachments block when manual attachments are present", () => {
    const input: ComposeShopifyMutationPayloadInput = {
      ...baseInput("FRAUDULENT"),
      manualAttachments: [
        {
          checklistField: "delivery_proof",
          label: "Signed delivery photo",
          fileName: "signature.jpg",
          fileSize: 12345,
          createdAt: "2026-04-15T00:00:00Z",
          url: "https://disputedesk.app/e/<test>",
        },
      ],
      pdfAttachment: null,
    };
    const out = composeShopifyMutationPayload(input);
    expect(out.uncategorizedText).toContain("https://disputedesk.app/e/<test>");
  });

  it("URL choice is an input, not a transformation: same other-fields + different URL produces only that URL difference", () => {
    // This is the hard guarantee: the only difference between the
    // submission-preview's "raw view" and saveToShopifyJob's actual
    // payload (given the same pack + dispute) is the URL token. The
    // function must not synthesise URLs internally.
    const a: ComposeShopifyMutationPayloadInput = {
      ...baseInput("FRAUDULENT"),
      manualAttachments: [
        {
          checklistField: null,
          label: "doc",
          fileName: null,
          fileSize: null,
          createdAt: null,
          url: "https://disputedesk.app/e/<placeholder>",
        },
      ],
    };
    const b: ComposeShopifyMutationPayloadInput = {
      ...a,
      manualAttachments: [{ ...a.manualAttachments[0], url: "https://disputedesk.app/e/realtoken" }],
    };
    const outA = composeShopifyMutationPayload(a);
    const outB = composeShopifyMutationPayload(b);
    const diffA = (outA.uncategorizedText ?? "").replace(/<placeholder>/g, "URL_TOKEN");
    const diffB = (outB.uncategorizedText ?? "").replace(/realtoken/g, "URL_TOKEN");
    expect(diffA).toBe(diffB);
  });
});
