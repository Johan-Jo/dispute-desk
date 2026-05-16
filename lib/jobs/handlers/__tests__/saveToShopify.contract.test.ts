/**
 * Post-retirement contract test for saveToShopifyJob.
 *
 * Verifies the 4-field mutation payload at the boundary between
 * `composeShopifyMutationPayload` and the Shopify mutation input. The
 * full handler does I/O (Supabase, Shopify upload, GraphQL); rather
 * than mock the world, we pin the contract at the function that owns
 * the shape.
 *
 * The old byte-equivalence snapshot fixtures (four dispute families,
 * 460 lines) were deleted with the legacy text-routing path —
 * snapshots over a 9-field text-routing payload no longer applied to
 * the 4-field replacement.
 */

import { describe, it, expect } from "vitest";
import { composeShopifyMutationPayload } from "@/lib/shopify/composeShopifyMutationPayload";

const PDF_GID = "gid://shopify/ShopifyPaymentsDisputeFileUpload/12345";

describe("saveToShopifyJob — submission contract (post-retirement)", () => {
  it("emits exactly the 4-field payload for a fully-populated dispute", () => {
    const out = composeShopifyMutationPayload({
      customer: { displayName: "Johan Jonsson", email: "hej@example.com" },
      defencePackagePdfGid: PDF_GID,
    });
    expect(Object.keys(out).sort()).toEqual(
      [
        "customerEmailAddress",
        "customerFirstName",
        "customerLastName",
        "submitEvidence",
        "uncategorizedFile",
      ].sort(),
    );
    expect(out.uncategorizedFile?.id).toBe(PDF_GID);
    expect(out.submitEvidence).toBe(true);
  });

  it("omits customer fields when the dispute lacks them", () => {
    const out = composeShopifyMutationPayload({
      customer: { displayName: null, email: null },
      defencePackagePdfGid: PDF_GID,
    });
    expect(out).toEqual({
      uncategorizedFile: { id: PDF_GID },
      submitEvidence: true,
    });
  });

  it("NEVER leaks a legacy text field, regardless of dispute reason", () => {
    const out = composeShopifyMutationPayload({
      customer: { displayName: "Test User", email: "x@y.com" },
      defencePackagePdfGid: PDF_GID,
    });
    const obj = out as unknown as Record<string, unknown>;
    expect(obj).not.toHaveProperty("accessActivityLog");
    expect(obj).not.toHaveProperty("cancellationPolicyDisclosure");
    expect(obj).not.toHaveProperty("cancellationRebuttal");
    expect(obj).not.toHaveProperty("refundPolicyDisclosure");
    expect(obj).not.toHaveProperty("refundRefusalExplanation");
    expect(obj).not.toHaveProperty("uncategorizedText");
    expect(obj).not.toHaveProperty("shippingDocumentationFile");
    expect(obj).not.toHaveProperty("customerCommunicationFile");
    expect(obj).not.toHaveProperty("refundPolicyFile");
    expect(obj).not.toHaveProperty("cancellationPolicyFile");
    expect(obj).not.toHaveProperty("serviceDocumentationFile");
  });
});
