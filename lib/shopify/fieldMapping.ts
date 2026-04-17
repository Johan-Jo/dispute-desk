import type { DisputeEvidenceUpdateInput } from "./mutations/disputeEvidenceUpdate";

/**
 * STRICT SUBMISSION RULES (NON-NEGOTIABLE):
 *
 * 1. All evidence submitted to Shopify MUST be in English.
 *
 * 2. DUAL RENDER RULE: Bank-facing output MUST NEVER include:
 *    - Missing or unavailable evidence
 *    - Completeness scores or readiness states
 *    - Checklists or audit-style sections
 *    - Internal logic, scoring, or system state
 *    - Any section not supported by actual evidence
 *
 * 3. Every statement MUST be backed by available evidence.
 *    If evidence is missing, the section is OMITTED — never mentioned.
 *
 * 4. Response shape MUST match the dispute reason family.
 *    See lib/argument/responseEngine.ts for family strategies.
 *
 * 5. NEVER weaken the case by referencing what is absent.
 *    "Not available" must not exist in bank output.
 */

/**
 * Legacy PackSection shape — used by preview and any callers that
 * pre-serialize section data into { key, content }.
 */
export interface PackSection {
  key: string;
  label: string;
  content: string | null;
}

/**
 * Raw pack_json section shape as produced by buildPack collectors.
 * Each collector writes { type, label, source, data, fieldsProvided }.
 */
export interface RawPackSection {
  type: string;
  label: string;
  source: string;
  fieldsProvided?: string[];
  data: Record<string, unknown>;
}

export interface FieldMapping {
  shopifyField: keyof DisputeEvidenceUpdateInput;
  label: string;
  /** Match against PackSection.key OR RawPackSection.type */
  packSectionKeys: string[];
}

/**
 * Maps internal pack section keys/types to Shopify DisputeEvidenceUpdateInput fields.
 * Keys cover both the legacy { key } format and the raw { type } format from collectors.
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
    packSectionKeys: ["order", "timeline", "order_activity", "access_log"],
  },
  {
    shopifyField: "cancellationPolicyDisclosure",
    label: "Cancellation Policy",
    packSectionKeys: ["cancellation_policy"],
  },
  {
    shopifyField: "refundPolicyDisclosure",
    label: "Refund Policy",
    packSectionKeys: ["refund_policy", "refund_policy_snapshot", "policy"],
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
  // customerCommunication is NOT a valid Shopify field.
  // Customer comms go into uncategorizedText instead.
  {
    shopifyField: "uncategorizedText",
    label: "Additional Evidence",
    // access_log intentionally NOT here — it maps to accessActivityLog only
    packSectionKeys: ["other", "notes", "additional", "uncategorized", "comms", "customer_comms", "customer_communication"],
  },
];

/**
 * Serialize a raw section's structured data into a plain text string
 * suitable for the Shopify disputeEvidenceUpdate mutation.
 */
function serializeSectionData(section: RawPackSection): string {
  const { data, label, type } = section;
  if (!data || typeof data !== "object") return "";

  const lines: string[] = [];

  // Shipping / fulfillment sections
  if (type === "shipping") {
    if (data.overallStatus) lines.push(`Fulfillment Status: ${data.overallStatus}`);
    const fulfillments = data.fulfillments as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(fulfillments)) {
      for (const f of fulfillments) {
        if (f.status) lines.push(`Status: ${f.status}`);
        if (f.carrier) lines.push(`Carrier: ${f.carrier}`);
        if (f.trackingNumber) lines.push(`Tracking Number: ${f.trackingNumber}`);
        if (f.trackingUrl) lines.push(`Tracking URL: ${f.trackingUrl}`);
        if (f.deliveredAt) lines.push(`Delivered: ${f.deliveredAt}`);
        if (f.estimatedDeliveryAt) lines.push(`Estimated Delivery: ${f.estimatedDeliveryAt}`);
        if (f.createdAt) lines.push(`Shipped: ${f.createdAt}`);
        lines.push("");
      }
    }
    return lines.filter(Boolean).join("\n").trim();
  }

  // Order sections
  if (type === "order") {
    if (data.orderName) lines.push(`Order: ${data.orderName}`);
    if (data.createdAt) lines.push(`Date: ${data.createdAt}`);
    if (data.totalAmount) lines.push(`Total: ${data.totalAmount} ${data.currencyCode ?? ""}`);
    if (data.customerEmail) lines.push(`Customer Email: ${data.customerEmail}`);
    if (data.billingAddress) lines.push(`Billing Address: ${formatAddress(data.billingAddress)}`);
    if (data.shippingAddress) lines.push(`Shipping Address: ${formatAddress(data.shippingAddress)}`);
    const items = data.lineItems as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(items) && items.length > 0) {
      lines.push("\nLine Items:");
      for (const item of items) {
        lines.push(`  - ${item.name ?? item.title ?? "Item"} (qty: ${item.quantity ?? 1})`);
      }
    }
    return lines.filter(Boolean).join("\n").trim();
  }

  // Policy sections — serialize as English summaries, never raw URLs
  if (type === "policy") {
    const policySummaries: Record<string, string> = {
      refunds: "The store's refund policy was clearly disclosed and accepted by the customer at checkout. The policy outlines conditions for returns, refunds, and exchanges.",
      shipping: "The store's shipping policy was disclosed at checkout, covering processing times, shipping methods, and delivery estimates.",
      terms: "The store's terms of service were presented and accepted by the customer before completing the purchase.",
      privacy: "The store's privacy policy was available to the customer, disclosing how personal information is collected and used.",
    };

    // Handle array format: { policies: [...] }
    const policies = data.policies as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(policies)) {
      for (const p of policies) {
        const pType = String(p.policyType ?? "");
        const summary = policySummaries[pType];
        if (summary) {
          lines.push(summary);
        }
      }
    } else {
      // Flat format fallback
      const pType = String(data.policyType ?? "");
      const summary = policySummaries[pType];
      if (summary) lines.push(summary);
      else if (data.body) lines.push(String(data.body));
    }
    return lines.filter(Boolean).join("\n").trim();
  }

  // Customer communication sections
  if (type === "comms") {
    if (data.emails && Array.isArray(data.emails)) {
      for (const email of data.emails as Array<Record<string, unknown>>) {
        if (email.subject) lines.push(`Subject: ${email.subject}`);
        if (email.body) lines.push(String(email.body));
        if (email.sentAt) lines.push(`Sent: ${email.sentAt}`);
        lines.push("");
      }
    }
    if (data.summary) lines.push(String(data.summary));
    return lines.filter(Boolean).join("\n").trim();
  }

  // Access / activity log sections
  if (type === "access_log") {
    const tenure = data.customerTenure as Record<string, unknown> | null;
    if (tenure) {
      if (tenure.totalOrders) lines.push(`Total Prior Orders: ${tenure.totalOrders}`);
      if (tenure.customerSince) lines.push(`Customer Since: ${tenure.customerSince}`);
      if (tenure.customerNote) lines.push(`Customer Note: ${tenure.customerNote}`);
    }
    const events = data.timelineEvents as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(events) && events.length > 0) {
      lines.push("\nOrder Timeline:");
      for (const evt of events.slice(0, 15)) {
        lines.push(`  [${evt.createdAt ?? ""}] ${evt.message ?? ""}`);
      }
    }
    return lines.filter(Boolean).join("\n").trim();
  }

  // "other" type: payment verification, risk assessment, manual evidence, etc.
  // Fallback: serialize key-value pairs
  for (const [key, value] of Object.entries(data)) {
    if (value == null) continue;
    if (typeof value === "object") {
      lines.push(`${formatKey(key)}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${formatKey(key)}: ${value}`);
    }
  }
  return lines.join("\n").trim();
}

function formatKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

function formatAddress(addr: unknown): string {
  if (!addr || typeof addr !== "object") return String(addr ?? "");
  const a = addr as Record<string, unknown>;
  return [a.address1, a.city, a.province, a.zip, a.country]
    .filter(Boolean)
    .join(", ");
}

/**
 * Build the Shopify evidence input from raw pack_json sections.
 * Serializes structured data into text and maps to Shopify fields.
 */
export function buildEvidenceInputFromRaw(
  sections: RawPackSection[],
  disabledFields: Set<string> = new Set(),
): DisputeEvidenceUpdateInput {
  const input: DisputeEvidenceUpdateInput = {};

  for (const mapping of FIELD_MAPPINGS) {
    if (disabledFields.has(mapping.shopifyField)) continue;

    const matching = sections.filter((s) =>
      mapping.packSectionKeys.includes(s.type),
    );

    if (matching.length > 0) {
      const combined = matching
        .map((s) => serializeSectionData(s))
        .filter(Boolean)
        .join("\n\n");
      if (combined) {
        input[mapping.shopifyField] = combined;
      }
    }
  }

  return input;
}

/**
 * Build the Shopify evidence input from legacy PackSection format.
 * Returns only fields that have non-empty content.
 */
export function buildEvidenceInput(
  sections: PackSection[],
  disabledFields: Set<string> = new Set(),
): DisputeEvidenceUpdateInput {
  const input: DisputeEvidenceUpdateInput = {};

  for (const mapping of FIELD_MAPPINGS) {
    if (disabledFields.has(mapping.shopifyField)) continue;

    const matchingSections = sections.filter(
      (s) => mapping.packSectionKeys.includes(s.key) && s.content?.trim(),
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
  sections: PackSection[],
): Array<{
  shopifyField: string;
  label: string;
  content: string;
  enabled: boolean;
}> {
  return FIELD_MAPPINGS.map((mapping) => {
    const matchingSections = sections.filter(
      (s) => mapping.packSectionKeys.includes(s.key) && s.content?.trim(),
    );
    const content = matchingSections
      .map((s) => s.content!.trim())
      .join("\n\n");
    return {
      shopifyField: mapping.shopifyField,
      label: mapping.label,
      content,
      enabled: content.length > 0,
    };
  });
}
