/**
 * Post-retirement 4-field Shopify mutation contract.
 *
 *   disputeEvidenceUpdate.input ⊆ {
 *     customerFirstName?, customerLastName?, customerEmailAddress?,
 *     uncategorizedFile: { id }, submitEvidence: true
 *   }
 *
 * The presence of any other key in the output is a regression — the
 * legacy text fields (`refundPolicyDisclosure`, `cancellationRebuttal`,
 * `accessActivityLog`, etc.) MUST NOT appear.
 */

import { describe, it, expect } from "vitest";
import { composeShopifyMutationPayload } from "../composeShopifyMutationPayload";

const PDF_GID = "gid://shopify/ShopifyPaymentsDisputeFileUpload/12345";

describe("composeShopifyMutationPayload — post-retirement 4-field contract", () => {
  it("emits the PDF file slot + submitEvidence even when customer info is missing", () => {
    const out = composeShopifyMutationPayload({
      customer: { displayName: null, email: null },
      defencePackagePdfGid: PDF_GID,
    });
    expect(out).toEqual({
      uncategorizedFile: { id: PDF_GID },
      submitEvidence: true,
    });
  });

  it("splits displayName into firstName / lastName on whitespace", () => {
    const out = composeShopifyMutationPayload({
      customer: { displayName: "Johan Jonsson", email: null },
      defencePackagePdfGid: PDF_GID,
    });
    expect(out.customerFirstName).toBe("Johan");
    expect(out.customerLastName).toBe("Jonsson");
  });

  it("preserves multi-word last names", () => {
    const out = composeShopifyMutationPayload({
      customer: { displayName: "Jane van der Berg", email: null },
      defencePackagePdfGid: PDF_GID,
    });
    expect(out.customerFirstName).toBe("Jane");
    expect(out.customerLastName).toBe("van der Berg");
  });

  it("emits customerEmailAddress when present", () => {
    const out = composeShopifyMutationPayload({
      customer: { displayName: null, email: "hej@example.com" },
      defencePackagePdfGid: PDF_GID,
    });
    expect(out.customerEmailAddress).toBe("hej@example.com");
  });

  it("trims whitespace from displayName + email", () => {
    const out = composeShopifyMutationPayload({
      customer: { displayName: "  Johan  ", email: "  a@b.com  " },
      defencePackagePdfGid: PDF_GID,
    });
    expect(out.customerFirstName).toBe("Johan");
    expect(out.customerLastName).toBeUndefined();
    expect(out.customerEmailAddress).toBe("a@b.com");
  });

  it("NEVER populates any legacy text field", () => {
    const out = composeShopifyMutationPayload({
      customer: { displayName: "Johan Jonsson", email: "hej@example.com" },
      defencePackagePdfGid: PDF_GID,
    });
    const FORBIDDEN_KEYS = [
      "accessActivityLog",
      "cancellationPolicyDisclosure",
      "cancellationRebuttal",
      "refundPolicyDisclosure",
      "refundRefusalExplanation",
      "uncategorizedText",
      "cancellationPolicyFile",
      "customerCommunicationFile",
      "refundPolicyFile",
      "shippingDocumentationFile",
      "serviceDocumentationFile",
    ];
    for (const key of FORBIDDEN_KEYS) {
      expect(
        out as Record<string, unknown>,
        `legacy field ${key} leaked into the mutation payload`,
      ).not.toHaveProperty(key);
    }
  });
});
