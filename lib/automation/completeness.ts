/**
 * Completeness scorer — context-aware evidence engine.
 *
 * Per dispute reason, defines which evidence fields are required,
 * conditional, recommended, or optional. Evaluates requirements
 * against order context (fulfillment state, payment method) so
 * inapplicable fields don't block pack generation.
 *
 * Packs are ALWAYS generated. Blockers only gate auto-save.
 */

export type RequirementMode =
  | "required_always"
  | "required_if_fulfilled"
  | "required_if_card_payment"
  | "recommended"
  | "optional";

export interface OrderContext {
  isFulfilled: boolean;
  hasCardPayment: boolean;
}

export interface ChecklistItem {
  field: string;
  label: string;
  required: boolean;
  present: boolean;
  collectable: boolean;
  unavailableReason?: string;
}

export interface CompletenessResult {
  score: number;
  evidenceStrengthScore: number;
  checklist: ChecklistItem[];
  blockers: string[];
  recommended_actions: string[];
}

interface TemplateField {
  field: string;
  label: string;
  requirementMode: RequirementMode;
}

type ReasonTemplate = TemplateField[];

const REASON_TEMPLATES: Record<string, ReasonTemplate> = {
  PRODUCT_NOT_RECEIVED: [
    { field: "order_confirmation", label: "Order Confirmation", requirementMode: "required_always" },
    { field: "shipping_tracking", label: "Shipping Tracking", requirementMode: "required_if_fulfilled" },
    { field: "delivery_proof", label: "Delivery Proof", requirementMode: "required_if_fulfilled" },
    { field: "shipping_policy", label: "Shipping Policy", requirementMode: "recommended" },
    { field: "customer_communication", label: "Customer Communication", requirementMode: "optional" },
    { field: "supporting_documents", label: "Supporting documents", requirementMode: "optional" },
  ],
  FRAUDULENT: [
    { field: "order_confirmation", label: "Order Confirmation", requirementMode: "required_always" },
    { field: "billing_address_match", label: "Billing Address Match", requirementMode: "required_always" },
    { field: "avs_cvv_match", label: "AVS / CVV Result", requirementMode: "required_if_card_payment" },
    { field: "shipping_tracking", label: "Shipping Tracking", requirementMode: "required_if_fulfilled" },
    { field: "customer_communication", label: "Customer Communication", requirementMode: "recommended" },
    { field: "activity_log", label: "Activity Log", requirementMode: "optional" },
    { field: "supporting_documents", label: "Supporting documents", requirementMode: "optional" },
  ],
  PRODUCT_UNACCEPTABLE: [
    { field: "order_confirmation", label: "Order Confirmation", requirementMode: "required_always" },
    { field: "product_description", label: "Product Description", requirementMode: "required_always" },
    { field: "refund_policy", label: "Refund Policy", requirementMode: "required_always" },
    { field: "customer_communication", label: "Customer Communication", requirementMode: "recommended" },
    { field: "shipping_tracking", label: "Shipping Tracking", requirementMode: "optional" },
    { field: "supporting_documents", label: "Supporting documents", requirementMode: "optional" },
  ],
  DUPLICATE: [
    { field: "order_confirmation", label: "Order Confirmation", requirementMode: "required_always" },
    { field: "duplicate_explanation", label: "Duplicate Explanation", requirementMode: "required_always" },
    { field: "supporting_documents", label: "Supporting documents", requirementMode: "optional" },
  ],
  SUBSCRIPTION_CANCELED: [
    { field: "order_confirmation", label: "Order Confirmation", requirementMode: "required_always" },
    { field: "cancellation_policy", label: "Cancellation Policy", requirementMode: "required_always" },
    { field: "customer_communication", label: "Customer Communication", requirementMode: "recommended" },
    { field: "supporting_documents", label: "Supporting documents", requirementMode: "optional" },
  ],
  GENERAL: [
    { field: "order_confirmation", label: "Order Confirmation", requirementMode: "required_always" },
    { field: "shipping_tracking", label: "Shipping Tracking", requirementMode: "optional" },
    { field: "customer_communication", label: "Customer Communication", requirementMode: "optional" },
    { field: "refund_policy", label: "Refund Policy", requirementMode: "optional" },
    { field: "supporting_documents", label: "Supporting documents", requirementMode: "optional" },
  ],
};

/** Field used when pack has at least one manual upload. */
export const MANUAL_UPLOAD_FIELD = "supporting_documents";

function getTemplate(reason: string | null | undefined): ReasonTemplate {
  if (!reason) return REASON_TEMPLATES.GENERAL;
  const key = reason.toUpperCase().replace(/\s+/g, "_");
  return REASON_TEMPLATES[key] ?? REASON_TEMPLATES.GENERAL;
}

const SCORE_WEIGHT: Record<RequirementMode, number> = {
  required_always: 1.0,
  required_if_fulfilled: 1.0,
  required_if_card_payment: 1.0,
  recommended: 0.5,
  optional: 0.1,
};

/**
 * Resolve whether a requirement mode is effectively required and
 * available given the order context.
 */
function resolveRequirement(
  mode: RequirementMode,
  ctx: OrderContext,
): { required: boolean; collectable: boolean; unavailableReason?: string } {
  switch (mode) {
    case "required_always":
      return { required: true, collectable: true };
    case "required_if_fulfilled":
      if (!ctx.isFulfilled) {
        return {
          required: false,
          collectable: false,
          unavailableReason: "Order is unfulfilled",
        };
      }
      return { required: true, collectable: true };
    case "required_if_card_payment":
      if (!ctx.hasCardPayment) {
        return {
          required: false,
          collectable: false,
          unavailableReason: "No card payment on this order",
        };
      }
      return { required: true, collectable: true };
    case "recommended":
      return { required: false, collectable: true };
    case "optional":
      return { required: false, collectable: true };
  }
}

/**
 * Row from pack_template_items used when the pack was built from an
 * admin-defined template.
 */
export interface TemplateChecklistItem {
  key: string;
  label: string;
  required: boolean;
  collector_key: string | null;
  requirement_mode?: RequirementMode;
}

const DEFAULT_ORDER_CONTEXT: OrderContext = {
  isFulfilled: true,
  hasCardPayment: true,
};

/**
 * Evaluate completeness of an evidence pack against its dispute reason.
 */
export function evaluateCompleteness(
  reason: string | null | undefined,
  presentFields: Set<string>,
  templateItems?: TemplateChecklistItem[] | null,
  orderContext?: OrderContext,
): CompletenessResult {
  const ctx = orderContext ?? DEFAULT_ORDER_CONTEXT;

  const checklist: ChecklistItem[] =
    templateItems && templateItems.length > 0
      ? templateItems.map((t) => {
          const mode: RequirementMode =
            t.requirement_mode ?? (t.required ? "required_always" : "optional");
          const resolved = resolveRequirement(mode, ctx);
          const present =
            t.collector_key != null
              ? presentFields.has(t.collector_key)
              : presentFields.has(MANUAL_UPLOAD_FIELD);
          return {
            field: t.collector_key ?? t.key,
            label: t.label,
            required: resolved.required,
            present,
            collectable: resolved.collectable,
            unavailableReason: resolved.unavailableReason,
          };
        })
      : getTemplate(reason).map((t) => {
          const resolved = resolveRequirement(t.requirementMode, ctx);
          return {
            field: t.field,
            label: t.label,
            required: resolved.required,
            present: presentFields.has(t.field),
            collectable: resolved.collectable,
            unavailableReason: resolved.unavailableReason,
          };
        });

  // Weighted scoring: only count collectable items
  const collectableItems = checklist.filter((c) => c.collectable);
  let totalWeight = 0;
  let presentWeight = 0;
  for (const c of collectableItems) {
    const mode = templateItems?.length
      ? "required_always" // simplified; real weight comes from mode
      : getTemplate(reason).find((t) => t.field === c.field)?.requirementMode ?? "optional";
    const weight = c.required ? 1.0 : SCORE_WEIGHT[mode] ?? 0.1;
    totalWeight += weight;
    if (c.present) presentWeight += weight;
  }
  const score = totalWeight > 0 ? Math.round((presentWeight / totalWeight) * 100) : 0;

  // Evidence strength: simple ratio of all present vs all collectable
  const strengthScore =
    collectableItems.length > 0
      ? Math.round(
          (collectableItems.filter((c) => c.present).length /
            collectableItems.length) *
            100,
        )
      : 0;

  const blockers = checklist
    .filter((c) => c.required && !c.present && c.collectable)
    .map((c) => c.label);

  const recommended_actions = checklist
    .filter((c) => !c.required && !c.present && c.collectable)
    .map((c) => `Add ${c.label}`);

  return {
    score,
    evidenceStrengthScore: strengthScore,
    checklist,
    blockers,
    recommended_actions,
  };
}
