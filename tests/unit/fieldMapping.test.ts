import { describe, it, expect } from "vitest";
import { buildEvidenceInput, type PackSection } from "@/lib/shopify/fieldMapping";

describe("buildEvidenceInput", () => {
  it("maps pack sections to Shopify evidence fields", () => {
    const sections: PackSection[] = [
      { key: "refund_policy", label: "Refund Policy", content: "30-day refund policy applies." },
      { key: "cancellation_rebuttal", label: "Cancellation Rebuttal", content: "Customer did not request cancellation." },
      { key: "other", label: "Additional", content: "Supporting evidence text." },
      { key: "notes", label: "Notes", content: "   " },
    ];

    const input = buildEvidenceInput(sections);
    expect(input.refundPolicyDisclosure).toBe("30-day refund policy applies.");
    expect(input.cancellationRebuttal).toBe("Customer did not request cancellation.");
    expect(input.uncategorizedText).toBe("Supporting evidence text.");
  });

  it("respects disabledFields set", () => {
    const sections: PackSection[] = [
      { key: "refund_policy", label: "Refund Policy", content: "30-day policy." },
      { key: "other", label: "Other", content: "Extra text." },
    ];

    const disabled = new Set(["refundPolicyDisclosure"]);
    const input = buildEvidenceInput(sections, disabled);
    expect(input.refundPolicyDisclosure).toBeUndefined();
    expect(input.uncategorizedText).toBe("Extra text.");
  });

  it("returns empty object when no sections match", () => {
    const sections: PackSection[] = [
      { key: "unknown_section", label: "Unknown", content: "Some data" },
    ];
    const input = buildEvidenceInput(sections);
    expect(Object.keys(input)).toHaveLength(0);
  });
});
