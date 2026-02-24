import { describe, it, expect } from "vitest";
import { buildEvidenceInput, type PackSection } from "@/lib/shopify/fieldMapping";

describe("buildEvidenceInput", () => {
  it("includes only enabled sections with non-empty values", () => {
    const sections: PackSection[] = [
      {
        key: "refund_policy",
        label: "Refund Policy",
        shopifyField: "refundPolicyDisclosure",
        value: "30-day refund policy applies.",
        enabled: true,
      },
      {
        key: "shipping_docs",
        label: "Shipping Documentation",
        shopifyField: "shippingDocumentation",
        value: "Tracked via UPS #1Z999",
        enabled: true,
      },
      {
        key: "cancellation_rebuttal",
        label: "Cancellation Rebuttal",
        shopifyField: "cancellationRebuttal",
        value: "Customer did not request cancellation.",
        enabled: false,
      },
      {
        key: "additional_context",
        label: "Additional Context",
        shopifyField: "uncategorizedText",
        value: "   ",
        enabled: true,
      },
    ];

    const input = buildEvidenceInput(sections);
    expect(input.refundPolicyDisclosure).toBe("30-day refund policy applies.");
    expect(input.shippingDocumentation).toBe("Tracked via UPS #1Z999");
    expect(input.cancellationRebuttal).toBeUndefined();
    expect(input.uncategorizedText).toBeUndefined();
  });
});
