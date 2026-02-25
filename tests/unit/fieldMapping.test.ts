import { describe, it, expect } from "vitest";
import { buildEvidenceInput, type PackSection } from "@/lib/shopify/fieldMapping";

describe("buildEvidenceInput", () => {
  it("maps pack sections to Shopify evidence fields", () => {
    const sections: PackSection[] = [
      { key: "refund_policy", label: "Refund Policy", content: "30-day refund policy applies." },
      { key: "shipping", label: "Shipping Docs", content: "Tracked via UPS #1Z999" },
      { key: "cancellation_rebuttal", label: "Cancellation Rebuttal", content: "Customer did not request cancellation." },
      { key: "notes", label: "Additional Context", content: "   " },
    ];

    const input = buildEvidenceInput(sections);
    expect(input.refundPolicyDisclosure).toBe("30-day refund policy applies.");
    expect(input.shippingDocumentation).toBe("Tracked via UPS #1Z999");
    expect(input.cancellationRebuttal).toBe("Customer did not request cancellation.");
    expect(input.uncategorizedText).toBeUndefined(); // whitespace-only = excluded
  });

  it("respects disabledFields set", () => {
    const sections: PackSection[] = [
      { key: "refund_policy", label: "Refund Policy", content: "30-day policy." },
      { key: "shipping", label: "Shipping", content: "UPS tracking." },
    ];

    const disabled = new Set(["refundPolicyDisclosure"]);
    const input = buildEvidenceInput(sections, disabled);
    expect(input.refundPolicyDisclosure).toBeUndefined();
    expect(input.shippingDocumentation).toBe("UPS tracking.");
  });

  it("returns empty object when no sections match", () => {
    const sections: PackSection[] = [
      { key: "unknown_section", label: "Unknown", content: "Some data" },
    ];
    const input = buildEvidenceInput(sections);
    expect(Object.keys(input)).toHaveLength(0);
  });
});
