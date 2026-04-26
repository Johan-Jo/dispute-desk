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
  /**
   * Whether AVS/CVV codes are actually present from the gateway.
   * Card payments through external gateways often return null for
   * AVS/CVV — this flag prevents treating missing codes as a gap
   * when the data simply isn't available from the payment processor.
   */
  avsCvvAvailable: boolean;
  /**
   * Whether the order has at least one fulfillment record carrying a
   * tracking number/URL, even if `displayFulfillmentStatus` is
   * `UNFULFILLED`. Distinguishes "no shipment at all" from "shipped
   * but delivery not yet confirmed" — only affects the reason text
   * shown for `delivery_proof` rows so we don't tell merchants the
   * order is unfulfilled when tracking already exists.
   * Optional for back-compat; defaults to `false`.
   */
  hasShippingEvidence?: boolean;
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
    { field: "activity_log", label: "Customer Purchase History", requirementMode: "recommended" },
    { field: "shipping_tracking", label: "Shipping Tracking", requirementMode: "required_if_fulfilled" },
    { field: "delivery_proof", label: "Delivery Confirmation", requirementMode: "required_if_fulfilled" },
    { field: "customer_communication", label: "Customer Communication", requirementMode: "recommended" },
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
      if (!ctx.avsCvvAvailable) {
        return {
          required: false,
          collectable: false,
          unavailableReason: "AVS/CVV not returned by payment gateway",
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

/**
 * Conservative default: assume conditional fields are NOT available.
 * This prevents false blockers when the order couldn't be fetched or
 * when a pack was built before context-aware evaluation was added.
 * Better to under-require than to show alarming "blocked" states
 * for data the merchant cannot provide.
 */
const DEFAULT_ORDER_CONTEXT: OrderContext = {
  isFulfilled: false,
  hasCardPayment: false,
  avsCvvAvailable: false,
  hasShippingEvidence: false,
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

/* ═══════════════════════════════════════════════════════════════════
 *  V2 Evidence Model — priority + blocking + waive
 * ═══════════════════════════════════════════════════════════════════ */

import type {
  TemplateFieldV2,
  ChecklistItemV2,
  EvidenceItemPriority,
  EvidenceItemSource,
  EvidenceItemStatus,
  SubmissionReadiness,
  CompletenessResultV2,
  WaivedItemRecord,
} from "@/lib/types/evidenceItem";

export type { TemplateFieldV2, ChecklistItemV2, CompletenessResultV2 };

/**
 * V2 reason templates.
 *
 * Key difference from v1: every field has `priority` and `blocking`.
 * `blocking: false` for ALL default fields because Shopify accepts
 * partial evidence submissions. The product should guide, not
 * falsely prevent.
 */
const REASON_TEMPLATES_V2: Record<string, TemplateFieldV2[]> = {
  PRODUCT_NOT_RECEIVED: [
    { field: "order_confirmation", label: "Order Confirmation", requirementMode: "required_always", priority: "critical", blocking: false, expectedSource: "auto_shopify", collectionType: "auto" },
    { field: "shipping_tracking", label: "Shipping Tracking", requirementMode: "required_if_fulfilled", priority: "critical", blocking: false, expectedSource: "auto_shopify", collectionType: "conditional_auto" },
    { field: "delivery_proof", label: "Delivery Proof", requirementMode: "required_if_fulfilled", priority: "critical", blocking: false, expectedSource: "auto_shopify", collectionType: "conditional_auto" },
    { field: "shipping_policy", label: "Shipping Policy", requirementMode: "recommended", priority: "recommended", blocking: false, expectedSource: "auto_policy", collectionType: "conditional_auto" },
    { field: "customer_communication", label: "Customer Communication", requirementMode: "optional", priority: "recommended", blocking: false, expectedSource: "auto_shopify", collectionType: "auto" },
    { field: "supporting_documents", label: "Supporting Documents", requirementMode: "optional", priority: "optional", blocking: false, expectedSource: "manual_upload", collectionType: "manual" },
  ],
  FRAUDULENT: [
    { field: "order_confirmation", label: "Transaction Record", requirementMode: "required_always", priority: "critical", blocking: false, expectedSource: "auto_shopify", collectionType: "auto" },
    { field: "billing_address_match", label: "Billing Address Match", requirementMode: "required_always", priority: "critical", blocking: false, expectedSource: "auto_shopify", collectionType: "auto" },
    { field: "avs_cvv_match", label: "Payment Verification (AVS & CVV)", requirementMode: "required_if_card_payment", priority: "critical", blocking: false, expectedSource: "auto_shopify", collectionType: "conditional_auto" },
    { field: "activity_log", label: "Customer History", requirementMode: "recommended", priority: "critical", blocking: false, expectedSource: "auto_shopify", collectionType: "auto" },
    { field: "ip_location_check", label: "IP & Location Check", requirementMode: "recommended", priority: "recommended", blocking: false, expectedSource: "auto_ipinfo", collectionType: "auto" },
    { field: "shipping_tracking", label: "Shipping Confirmation", requirementMode: "required_if_fulfilled", priority: "recommended", blocking: false, expectedSource: "auto_shopify", collectionType: "conditional_auto" },
    { field: "delivery_proof", label: "Delivery Confirmation (Signature / Photo)", requirementMode: "required_if_fulfilled", priority: "recommended", blocking: false, expectedSource: "auto_shopify", collectionType: "conditional_auto" },
    { field: "customer_communication", label: "Customer Communication", requirementMode: "recommended", priority: "recommended", blocking: false, expectedSource: "auto_shopify", collectionType: "auto" },
    { field: "refund_policy", label: "Refund Policy", requirementMode: "optional", priority: "optional", blocking: false, expectedSource: "auto_policy", collectionType: "conditional_auto" },
    { field: "shipping_policy", label: "Shipping Policy", requirementMode: "optional", priority: "optional", blocking: false, expectedSource: "auto_policy", collectionType: "conditional_auto" },
    { field: "cancellation_policy", label: "Cancellation Policy", requirementMode: "optional", priority: "optional", blocking: false, expectedSource: "auto_policy", collectionType: "conditional_auto" },
    { field: "supporting_documents", label: "Supporting Documents", requirementMode: "optional", priority: "optional", blocking: false, expectedSource: "manual_upload", collectionType: "manual" },
  ],
  PRODUCT_UNACCEPTABLE: [
    { field: "order_confirmation", label: "Order Confirmation", requirementMode: "required_always", priority: "critical", blocking: false, expectedSource: "auto_shopify", collectionType: "auto" },
    { field: "product_description", label: "Product Description", requirementMode: "required_always", priority: "critical", blocking: false, expectedSource: "manual_upload", collectionType: "manual" },
    { field: "refund_policy", label: "Refund Policy", requirementMode: "required_always", priority: "critical", blocking: false, expectedSource: "auto_policy", collectionType: "conditional_auto" },
    { field: "customer_communication", label: "Customer Communication", requirementMode: "recommended", priority: "recommended", blocking: false, expectedSource: "auto_shopify", collectionType: "auto" },
    { field: "shipping_tracking", label: "Shipping Tracking", requirementMode: "optional", priority: "optional", blocking: false, expectedSource: "auto_shopify", collectionType: "conditional_auto" },
    { field: "supporting_documents", label: "Supporting Documents", requirementMode: "optional", priority: "optional", blocking: false, expectedSource: "manual_upload", collectionType: "manual" },
  ],
  DUPLICATE: [
    { field: "order_confirmation", label: "Order Confirmation", requirementMode: "required_always", priority: "critical", blocking: false, expectedSource: "auto_shopify", collectionType: "auto" },
    { field: "duplicate_explanation", label: "Duplicate Explanation", requirementMode: "required_always", priority: "critical", blocking: false, expectedSource: "manual_upload", collectionType: "manual" },
    { field: "supporting_documents", label: "Supporting Documents", requirementMode: "optional", priority: "optional", blocking: false, expectedSource: "manual_upload", collectionType: "manual" },
  ],
  SUBSCRIPTION_CANCELED: [
    { field: "order_confirmation", label: "Order Confirmation", requirementMode: "required_always", priority: "critical", blocking: false, expectedSource: "auto_shopify", collectionType: "auto" },
    { field: "cancellation_policy", label: "Cancellation Policy", requirementMode: "required_always", priority: "critical", blocking: false, expectedSource: "auto_policy", collectionType: "conditional_auto" },
    { field: "customer_communication", label: "Customer Communication", requirementMode: "recommended", priority: "recommended", blocking: false, expectedSource: "auto_shopify", collectionType: "auto" },
    { field: "supporting_documents", label: "Supporting Documents", requirementMode: "optional", priority: "optional", blocking: false, expectedSource: "manual_upload", collectionType: "manual" },
  ],
  GENERAL: [
    { field: "order_confirmation", label: "Order Confirmation", requirementMode: "required_always", priority: "critical", blocking: false, expectedSource: "auto_shopify", collectionType: "auto" },
    { field: "shipping_tracking", label: "Shipping Tracking", requirementMode: "optional", priority: "recommended", blocking: false, expectedSource: "auto_shopify", collectionType: "conditional_auto" },
    { field: "customer_communication", label: "Customer Communication", requirementMode: "optional", priority: "recommended", blocking: false, expectedSource: "auto_shopify", collectionType: "auto" },
    { field: "refund_policy", label: "Refund Policy", requirementMode: "optional", priority: "optional", blocking: false, expectedSource: "auto_policy", collectionType: "conditional_auto" },
    { field: "supporting_documents", label: "Supporting Documents", requirementMode: "optional", priority: "optional", blocking: false, expectedSource: "manual_upload", collectionType: "manual" },
  ],
};

function getTemplateV2(reason: string | null | undefined): TemplateFieldV2[] {
  if (!reason) return REASON_TEMPLATES_V2.GENERAL;
  const key = reason.toUpperCase().replace(/\s+/g, "_");
  return REASON_TEMPLATES_V2[key] ?? REASON_TEMPLATES_V2.GENERAL;
}

/** Score weight by priority. */
const PRIORITY_WEIGHT: Record<EvidenceItemPriority, number> = {
  critical: 1.0,
  recommended: 0.5,
  optional: 0.1,
};

/**
 * Resolve v2 item status from requirement mode, order context, and
 * waive state.
 */
function resolveItemStatus(
  mode: RequirementMode,
  ctx: OrderContext,
  isPresent: boolean,
  waivedItem?: WaivedItemRecord,
  field?: string,
): { status: EvidenceItemStatus; collectable: boolean; unavailableReason?: string } {
  if (waivedItem) {
    return { status: "waived", collectable: true };
  }
  if (isPresent) {
    return { status: "available", collectable: true };
  }

  // Check if the field is collectable given order context
  switch (mode) {
    case "required_if_fulfilled":
      if (!ctx.isFulfilled) {
        // When the order is structurally `UNFULFILLED` but has at
        // least one fulfillment record with tracking, "Order is
        // unfulfilled" misrepresents reality — the merchant has
        // shipped something, just not yet seen delivery confirmed.
        // Only swap the reason for `delivery_proof`; `shipping_tracking`
        // can never reach this branch with `hasShippingEvidence === true`
        // (it would have been `available` via `isPresent` short-circuit).
        const inTransit = field === "delivery_proof" && ctx.hasShippingEvidence === true;
        return {
          status: "unavailable",
          collectable: false,
          unavailableReason: inTransit
            ? "Awaiting delivery confirmation"
            : "Order is unfulfilled",
        };
      }
      break;
    case "required_if_card_payment":
      if (!ctx.hasCardPayment) {
        return {
          status: "unavailable",
          collectable: false,
          unavailableReason: "No card payment on this order",
        };
      }
      if (!ctx.avsCvvAvailable) {
        return {
          status: "unavailable",
          collectable: false,
          unavailableReason: "AVS/CVV not returned by payment gateway",
        };
      }
      break;
  }

  return { status: "missing", collectable: true };
}

/**
 * Evaluate completeness using the v2 evidence model.
 *
 * Returns both v2 results (checklist with priority/blocking/status)
 * and legacy-compat v1 fields so callers that write both columns
 * can do so from a single evaluation.
 */
export function evaluateCompletenessV2(
  reason: string | null | undefined,
  presentFields: Set<string>,
  waivedItems?: WaivedItemRecord[] | null,
  templateItems?: TemplateChecklistItem[] | null,
  orderContext?: OrderContext,
): CompletenessResultV2 {
  const ctx = orderContext ?? DEFAULT_ORDER_CONTEXT;
  const waiveMap = new Map<string, WaivedItemRecord>();
  for (const w of waivedItems ?? []) {
    waiveMap.set(w.field, w);
  }

  // Build v2 checklist
  const reasonTemplate = getTemplateV2(reason);
  const checklist: ChecklistItemV2[] =
    templateItems && templateItems.length > 0
      ? templateItems.map((t) => {
          const mode: RequirementMode =
            t.requirement_mode ?? (t.required ? "required_always" : "optional");
          const field = t.collector_key ?? t.key;
          const isPresent =
            t.collector_key != null
              ? presentFields.has(t.collector_key)
              : presentFields.has(MANUAL_UPLOAD_FIELD);
          const waivedItem = waiveMap.get(field);
          const resolved = resolveItemStatus(mode, ctx, isPresent, waivedItem, field);

          // Priority comes from the reason-specific template when it carries
          // one for this field. DB-backed templates don't encode reason
          // criticality, and a blanket "required_if_fulfilled → critical"
          // mapping mislabels shipping/delivery as a Critical gap on
          // unauthorized-transaction (FRAUDULENT) disputes, where payment
          // verification is the true critical signal. When the reason
          // template doesn't cover the field, fall back to mode-based
          // inference, biasing conditional modes toward "recommended".
          const reasonField = reasonTemplate.find((r) => r.field === field);
          let priority: EvidenceItemPriority;
          if (reasonField) {
            priority = reasonField.priority;
          } else if (mode === "required_always") {
            priority = "critical";
          } else if (
            mode === "required_if_fulfilled" ||
            mode === "required_if_card_payment" ||
            mode === "recommended"
          ) {
            priority = "recommended";
          } else {
            priority = "optional";
          }

          return {
            field,
            label: t.label,
            status: resolved.status,
            priority,
            blocking: false, // template items never hard-block by default
            source: "auto_shopify" as EvidenceItemSource,
            unavailableReason: resolved.unavailableReason,
            waiveReason: waivedItem?.reason,
            waiveNote: waivedItem?.note,
            waivedAt: waivedItem?.waivedAt,
            waivedBy: waivedItem?.waivedBy,
          };
        })
      : getTemplateV2(reason).map((t) => {
          const isPresent = presentFields.has(t.field);
          const waivedItem = waiveMap.get(t.field);
          const resolved = resolveItemStatus(t.requirementMode, ctx, isPresent, waivedItem, t.field);
          return {
            field: t.field,
            label: t.label,
            // If collectionType is "unavailable", force status to unavailable
            // (e.g., 3DS — we cannot auto-collect it from Shopify)
            status: t.collectionType === "unavailable" && !isPresent && !waivedItem
              ? "unavailable" as const
              : resolved.status,
            priority: t.priority,
            blocking: t.blocking,
            source: resolved.collectable ? t.expectedSource : ("unavailable_from_source" as EvidenceItemSource),
            collectionType: t.collectionType,
            unavailableReason: t.collectionType === "unavailable" && !isPresent
              ? "Not available automatically \u2014 upload manually if you have it"
              : resolved.unavailableReason,
            waiveReason: waivedItem?.reason,
            waiveNote: waivedItem?.note,
            waivedAt: waivedItem?.waivedAt,
            waivedBy: waivedItem?.waivedBy,
          };
        });

  // Always-include fields: evidence that the collector produces regardless
  // of template (e.g. Device & Location Consistency is a system-wide signal,
  // not template-owned). If the collector wrote the field into the pack
  // AND the checklist doesn't already carry a row for it, append one so the
  // UI renders the card. Priority is `recommended` / `supporting_only` —
  // never critical — because these fields never block submission.
  const ALWAYS_INCLUDE_IF_COLLECTED: Array<{
    field: string;
    label: string;
    priority: EvidenceItemPriority;
    source: EvidenceItemSource;
  }> = [
    {
      field: "ip_location_check",
      label: "IP & Location Check",
      priority: "recommended",
      source: "auto_ipinfo",
    },
    // Reserved slot for the future Device & Session Consistency collector.
    // No collector writes this today, so the row is naturally hidden
    // (presentFields.has(...) is false → checklist push skipped).
    {
      field: "device_session_consistency",
      label: "Device & Session Consistency",
      priority: "recommended",
      source: "auto_ipinfo",
    },
  ];
  for (const extra of ALWAYS_INCLUDE_IF_COLLECTED) {
    if (!presentFields.has(extra.field)) continue;
    if (checklist.some((c) => c.field === extra.field)) continue;
    checklist.push({
      field: extra.field,
      label: extra.label,
      status: "available",
      priority: extra.priority,
      blocking: false,
      source: extra.source,
    });
  }

  const metrics = deriveCompletenessMetrics(checklist);
  return { checklist, ...metrics };
}

/**
 * Derive score, submission readiness, and legacy mirrors from a v2 checklist.
 *
 * Pure function over the checklist — no order context, no template lookup.
 * Extracted so callers that need to patch an existing `checklist_v2` (e.g.
 * the manual-upload route, which has no Shopify order context on hand)
 * can update a single row's status without re-resolving order-context-
 * sensitive fields like `required_if_fulfilled` back to `unavailable`.
 */
export function deriveCompletenessMetrics(
  checklist: ChecklistItemV2[],
): Omit<CompletenessResultV2, "checklist"> {
  // Scoring: waived + available count as "present"
  const scorableItems = checklist.filter(
    (c) => c.status !== "unavailable",
  );
  let totalWeight = 0;
  let presentWeight = 0;
  for (const c of scorableItems) {
    const weight = PRIORITY_WEIGHT[c.priority];
    totalWeight += weight;
    if (c.status === "available" || c.status === "waived") {
      presentWeight += weight;
    }
  }
  const completenessScore =
    totalWeight > 0 ? Math.round((presentWeight / totalWeight) * 100) : 0;

  // Evidence strength: simple present count (excludes waived)
  const collectableCount = scorableItems.length;
  const presentCount = scorableItems.filter(
    (c) => c.status === "available",
  ).length;
  const evidenceStrengthScore =
    collectableCount > 0 ? Math.round((presentCount / collectableCount) * 100) : 0;

  // Derive readiness
  const missingBlockers = checklist.filter(
    (c) => c.blocking && c.status === "missing",
  );
  const missingCritical = checklist.filter(
    (c) => c.priority === "critical" && !c.blocking && c.status === "missing",
  );

  let submissionReadiness: SubmissionReadiness;
  if (missingBlockers.length > 0) {
    submissionReadiness = "blocked";
  } else if (missingCritical.length > 0) {
    submissionReadiness = "ready_with_warnings";
  } else {
    submissionReadiness = "ready";
  }

  const blockers = missingBlockers.map((c) => c.label);
  const warnings = missingCritical.map((c) => c.label);
  const recommendedActions = checklist
    .filter(
      (c) =>
        c.priority === "recommended" && c.status === "missing",
    )
    .map((c) => `Add ${c.label}`);

  // Legacy compat output
  const legacyChecklist = checklist.map((c) => ({
    field: c.field,
    label: c.label,
    required: c.priority === "critical",
    present: c.status === "available" || c.status === "waived",
  }));
  const legacyBlockers = checklist
    .filter(
      (c) =>
        c.priority === "critical" &&
        c.status === "missing",
    )
    .map((c) => c.label);
  const legacyRecommendedActions = checklist
    .filter(
      (c) =>
        c.priority !== "critical" &&
        c.status === "missing",
    )
    .map((c) => `Add ${c.label}`);

  return {
    completenessScore,
    evidenceStrengthScore,
    submissionReadiness,
    blockers,
    warnings,
    recommendedActions,
    legacyChecklist,
    legacyBlockers,
    legacyRecommendedActions,
  };
}
