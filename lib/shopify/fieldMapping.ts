import type { DisputeEvidenceUpdateInput } from "./mutations/disputeEvidenceUpdate";

export interface PackSection {
  key: string;
  label: string;
  content: string | null;
}

export interface FieldMapping {
  shopifyField: keyof DisputeEvidenceUpdateInput;
  label: string;
  packSectionKeys: string[];
}

/**
 * Maps internal pack section keys to Shopify DisputeEvidenceUpdateInput fields.
 * Each mapping pulls content from one or more pack sections.
 */
export const FIELD_MAPPINGS: FieldMapping[] = [
  {
    shopifyField: "shippingDocumentation",
    label: "Shipping & Tracking",
    packSectionKeys: ["fulfillment", "tracking", "shipping"],
  },
  {
    shopifyField: "accessActivityLog",
    label: "Order Timeline",
    packSectionKeys: ["timeline", "order_activity", "access_log"],
  },
  {
    shopifyField: "cancellationPolicyDisclosure",
    label: "Cancellation Policy",
    packSectionKeys: ["cancellation_policy", "refund_policy"],
  },
  {
    shopifyField: "refundPolicyDisclosure",
    label: "Refund Policy",
    packSectionKeys: ["refund_policy_snapshot", "refund_policy"],
  },
  {
    shopifyField: "refundRefusalExplanation",
    label: "Refund Refusal Explanation",
    packSectionKeys: ["refund_refusal"],
  },
  {
    shopifyField: "cancellationRebuttal",
    label: "Cancellation Rebuttal",
    packSectionKeys: ["cancellation_rebuttal"],
  },
  {
    shopifyField: "customerCommunication",
    label: "Customer Communication",
    packSectionKeys: ["customer_comms", "customer_communication"],
  },
  {
    shopifyField: "uncategorizedText",
    label: "Additional Evidence",
    packSectionKeys: ["notes", "additional", "uncategorized"],
  },
];

/**
 * Build the Shopify evidence input from pack sections.
 * Returns only fields that have non-empty content.
 * `disabledFields` allows the merchant to toggle off specific fields before saving.
 */
export function buildEvidenceInput(
  sections: PackSection[],
  disabledFields: Set<string> = new Set()
): DisputeEvidenceUpdateInput {
  const input: DisputeEvidenceUpdateInput = {};

  for (const mapping of FIELD_MAPPINGS) {
    if (disabledFields.has(mapping.shopifyField)) continue;

    const matchingSections = sections.filter(
      (s) => mapping.packSectionKeys.includes(s.key) && s.content?.trim()
    );

    if (matchingSections.length > 0) {
      const combined = matchingSections
        .map((s) => s.content!.trim())
        .join("\n\n");
      input[mapping.shopifyField] = combined;
    }
  }

  return input;
}

/**
 * Preview what would be sent to Shopify — returns mapped fields with their content.
 */
export function previewEvidenceMapping(
  sections: PackSection[]
): Array<{ shopifyField: string; label: string; content: string; enabled: boolean }> {
  return FIELD_MAPPINGS.map((mapping) => {
    const matchingSections = sections.filter(
      (s) => mapping.packSectionKeys.includes(s.key) && s.content?.trim()
    );
    const content = matchingSections.map((s) => s.content!.trim()).join("\n\n");
    return {
      shopifyField: mapping.shopifyField,
      label: mapping.label,
      content,
      enabled: content.length > 0,
    };
  });
}
