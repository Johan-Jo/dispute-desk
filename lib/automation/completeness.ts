/**
 * Completeness scorer and blocker detector.
 *
 * Per dispute reason, defines which evidence fields are required vs recommended.
 * Computes a 0–100 score and returns blockers (missing required items).
 */

export interface ChecklistItem {
  field: string;
  label: string;
  required: boolean;
  present: boolean;
}

export interface CompletenessResult {
  score: number;
  checklist: ChecklistItem[];
  blockers: string[];
  recommended_actions: string[];
}

type ReasonTemplate = { field: string; label: string; required: boolean }[];

const REASON_TEMPLATES: Record<string, ReasonTemplate> = {
  PRODUCT_NOT_RECEIVED: [
    { field: "order_confirmation", label: "Order Confirmation", required: true },
    { field: "shipping_tracking", label: "Shipping Tracking", required: true },
    { field: "delivery_proof", label: "Delivery Proof", required: true },
    { field: "shipping_policy", label: "Shipping Policy", required: false },
    { field: "customer_communication", label: "Customer Communication", required: false },
    { field: "supporting_documents", label: "Supporting documents", required: false },
  ],
  FRAUDULENT: [
    { field: "order_confirmation", label: "Order Confirmation", required: true },
    { field: "billing_address_match", label: "Billing Address Match", required: true },
    { field: "avs_cvv_result", label: "AVS / CVV Result", required: false },
    { field: "customer_communication", label: "Customer Communication", required: false },
    { field: "activity_log", label: "Activity Log", required: false },
    { field: "supporting_documents", label: "Supporting documents", required: false },
  ],
  PRODUCT_UNACCEPTABLE: [
    { field: "order_confirmation", label: "Order Confirmation", required: true },
    { field: "product_description", label: "Product Description", required: true },
    { field: "refund_policy", label: "Refund Policy", required: true },
    { field: "customer_communication", label: "Customer Communication", required: false },
    { field: "shipping_tracking", label: "Shipping Tracking", required: false },
    { field: "supporting_documents", label: "Supporting documents", required: false },
  ],
  DUPLICATE: [
    { field: "order_confirmation", label: "Order Confirmation", required: true },
    { field: "duplicate_explanation", label: "Duplicate Explanation", required: true },
    { field: "supporting_documents", label: "Supporting documents", required: false },
  ],
  SUBSCRIPTION_CANCELED: [
    { field: "order_confirmation", label: "Order Confirmation", required: true },
    { field: "cancellation_policy", label: "Cancellation Policy", required: true },
    { field: "customer_communication", label: "Customer Communication", required: false },
    { field: "supporting_documents", label: "Supporting documents", required: false },
  ],
  GENERAL: [
    { field: "order_confirmation", label: "Order Confirmation", required: true },
    { field: "shipping_tracking", label: "Shipping Tracking", required: false },
    { field: "customer_communication", label: "Customer Communication", required: false },
    { field: "refund_policy", label: "Refund Policy", required: false },
    { field: "supporting_documents", label: "Supporting documents", required: false },
  ],
};

/** Field used when pack has at least one manual upload (evidence_items with source manual_upload). */
export const MANUAL_UPLOAD_FIELD = "supporting_documents";

function getTemplate(reason: string | null | undefined): ReasonTemplate {
  if (!reason) return REASON_TEMPLATES.GENERAL;
  const key = reason.toUpperCase().replace(/\s+/g, "_");
  return REASON_TEMPLATES[key] ?? REASON_TEMPLATES.GENERAL;
}

/**
 * Row from pack_template_items (plus its parent section's title) used
 * when the pack was built from an admin-defined template. The
 * collector_key column points at a collector field; NULL means the
 * item is merchant-supplied and satisfied by any manual upload.
 */
export interface TemplateChecklistItem {
  key: string;
  label: string;
  required: boolean;
  collector_key: string | null;
}

/**
 * Evaluate completeness of an evidence pack against its dispute reason.
 *
 * @param reason - The dispute reason code from Shopify
 * @param presentFields - Set of field keys that the pack currently has
 * @param templateItems - Optional admin-defined template items. When
 *   provided, takes precedence over the reason-based REASON_TEMPLATES
 *   fallback. Items with a non-null `collector_key` are matched against
 *   `presentFields` directly; items with `collector_key === null` are
 *   treated as satisfied when any manual upload exists
 *   (`presentFields.has(MANUAL_UPLOAD_FIELD)`).
 */
export function evaluateCompleteness(
  reason: string | null | undefined,
  presentFields: Set<string>,
  templateItems?: TemplateChecklistItem[] | null,
): CompletenessResult {
  // When the caller supplies admin-defined template items, use them as
  // the source of truth. Otherwise fall back to the hardcoded
  // REASON_TEMPLATES map keyed on dispute reason.
  const checklist: ChecklistItem[] =
    templateItems && templateItems.length > 0
      ? templateItems.map((t) => ({
          field: t.collector_key ?? t.key,
          label: t.label,
          required: t.required,
          present:
            t.collector_key != null
              ? presentFields.has(t.collector_key)
              : presentFields.has(MANUAL_UPLOAD_FIELD),
        }))
      : getTemplate(reason).map((t) => ({
          ...t,
          present: presentFields.has(t.field),
        }));

  const total = checklist.length;
  const present = checklist.filter((c) => c.present).length;
  const score = total > 0 ? Math.round((present / total) * 100) : 0;

  const blockers = checklist
    .filter((c) => c.required && !c.present)
    .map((c) => c.label);

  const recommended_actions = checklist
    .filter((c) => !c.required && !c.present)
    .map((c) => `Add ${c.label}`);

  return { score, checklist, blockers, recommended_actions };
}
