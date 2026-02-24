import type { DisputeEvidenceUpdateInput } from "./mutations/disputeEvidenceUpdate";

/**
 * Maps internal evidence pack sections to Shopify's DisputeEvidenceUpdateInput fields.
 * V1: static mapping with toggle/override support in UI before save.
 */

export interface PackSection {
  key: string;
  label: string;
  shopifyField: keyof DisputeEvidenceUpdateInput;
  value: string;
  enabled: boolean;
}

export function buildEvidenceInput(
  sections: PackSection[]
): DisputeEvidenceUpdateInput {
  const input: DisputeEvidenceUpdateInput = {};

  for (const section of sections) {
    if (!section.enabled || !section.value.trim()) continue;
    input[section.shopifyField] = section.value;
  }

  return input;
}

export const SECTION_FIELD_MAP: Record<string, keyof DisputeEvidenceUpdateInput> = {
  order_timeline: "accessActivityLog",
  refund_policy: "refundPolicyDisclosure",
  cancellation_policy: "cancellationPolicyDisclosure",
  cancellation_rebuttal: "cancellationRebuttal",
  customer_comms: "customerCommunication",
  refund_refusal: "refundRefusalExplanation",
  shipping_docs: "shippingDocumentation",
  additional_context: "uncategorizedText",
};
