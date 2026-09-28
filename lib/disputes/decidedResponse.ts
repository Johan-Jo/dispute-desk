/**
 * Decided dispute — who responded, and why DisputeDesk did not.
 *
 * `outcomeExplanation.ts` explains a case DisputeDesk FILED. It used to
 * collapse every other decided case into one sentence — "This dispute was
 * decided before DisputeDesk filed any evidence for it." — which is true for a
 * historical import and false for a case we deliberately held. Order #360499
 * (blume-box, 2026-09) is the reference: the fatal-loss gate held it for two
 * weeks because the order never shipped, Shopify sent its own response after
 * the deadline, and the page claimed we had simply run out of time.
 *
 * This module separates the two questions the old sentence conflated:
 *
 *   1. Who responded? — DisputeDesk, a response sent through Shopify (the API
 *      cannot say whether Shopify or the merchant in Admin sent it, so copy
 *      never names which — and never calls it an "automatic response"), or
 *      nobody. Plus the two pre-install shapes.
 *   2. If not DisputeDesk, why not? — resolved from the audit trail the
 *      pipeline already writes. See `docs/plans/decided-dispute-view.plan.md` §4.
 *
 * Pure. The loader in `loadDecidedResponse.ts` gathers the inputs; the
 * Overview and the outcome email both render through `decidedResponseTokens`,
 * so the page and the email cannot describe one case two ways.
 *
 * Merchant-facing only — none of this may reach the bank-facing package.
 */

import type { I18nToken } from "@/lib/i18n/token";

export type DecidedResponder =
  /** DisputeDesk saved evidence to Shopify. `outcomeExplanation` owns the copy. */
  | "we"
  /** A response reached the issuer, but not one DisputeDesk saved. */
  | "shopify"
  /** Nothing was sent. */
  | "none"
  /** Decided before the shop installed DisputeDesk. */
  | "before_install"
  /** A response went through Shopify before the shop installed DisputeDesk. */
  | "sent_before_install";

/**
 * Why DisputeDesk did not file. Declaration order is PRIORITY order — the
 * first that applies wins, because one sentence names one reason. A merchant's
 * own decision outranks anything the pipeline did; an order-record fact
 * outranks a policy hold; a plan limit only explains a case with no pack.
 */
export const HOLD_REASONS = [
  "merchant_conceded",
  "not_shipped",
  "refunded",
  "covered",
  "plan_limit",
  "auto_build_off",
  "awaiting_review",
  "thin_evidence",
] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export interface DecidedResponse {
  responder: DecidedResponder;
  /** When DisputeDesk saved evidence (`responder = "we"`). */
  filedAt: string | null;
  /** Shopify's `evidenceSentOn` (`responder = "shopify" | "sent_before_install"`). */
  sentAt: string | null;
  closedAt: string | null;
  /** True only when both dates are known and the decision came first. */
  decidedBeforeDeadline: boolean;
  /** Null when we filed, or when the audit trail names no reason. */
  holdReason: HoldReason | null;
}

export interface DecidedAuditEvent {
  event_type: string;
  event_payload: unknown;
  created_at?: string | null;
}

/** Audit types the classifier reads — the loader selects exactly these. */
export const DECIDED_AUDIT_EVENT_TYPES = [
  "auto_save_blocked",
  "parked_for_review",
  "defence_package_blocked_unsafe_claim",
  "auto_build_skipped",
  "billing_blocked_email_sent",
  "review_conceded",
  "review_approved",
  // Timeline only (decided view): the merchant was told.
  "fatal_loss_alert_sent",
] as const;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Every string a hold payload carries, lower-cased, for substring checks.
 *  Payload shapes vary across pipeline generations (prod has at least eight
 *  `auto_save_blocked` shapes), so the classifier reads meaning from any of
 *  the fields that have ever carried it rather than from one schema. */
function payloadText(p: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of [
    "reason",
    "decision",
    "fatal_loss",
    "verdict_reason",
    "coverage",
    "fallbackReason",
    "selectionReason",
  ]) {
    const v = p[key];
    if (typeof v === "string") parts.push(v);
  }
  parts.push(...strings(p.reasons));
  parts.push(...strings(p.decision_reason_codes));
  parts.push(...strings(p.decisionReasonCodes));
  return parts.join(" ").toLowerCase();
}

/** The hold reasons one audit row supports. Exported for the decided view's
 *  timeline, which dates the hold by the first row carrying the reason. */
export function holdReasonsOfEvent(ev: DecidedAuditEvent, hasPack: boolean): HoldReason[] {
  const p = asRecord(ev.event_payload);
  const text = payloadText(p);
  const out: HoldReason[] = [];

  switch (ev.event_type) {
    case "review_conceded":
      return ["merchant_conceded"];
    case "parked_for_review":
      return ["awaiting_review"];
    case "auto_build_skipped":
    case "billing_blocked_email_sent":
      // A build skip only explains a case that never got a pack. Once a pack
      // exists the skip was replayed and is history, not the reason.
      if (hasPack) return [];
      if (text.includes("auto_build_off")) return ["auto_build_off"];
      if (text.includes("quota_exceeded") || text.includes("feature_blocked")) return ["plan_limit"];
      return [];
    case "auto_save_blocked":
    case "defence_package_blocked_unsafe_claim":
      break;
    default:
      // Notifications, approvals and anything added later hold nothing.
      return [];
  }

  // auto_save_blocked / defence_package_blocked_unsafe_claim
  if (text.includes("inr_no_fulfillment")) out.push("not_shipped");
  if (text.includes("refund_issued")) out.push("refunded");
  const coverage = typeof p.coverage === "string" ? p.coverage : null;
  if ((coverage && coverage !== "not_covered") || /\bcovered_shopify\b/.test(text)) {
    out.push("covered");
  }
  if (/\bpark(_for_review)?\b/.test(text) || text.includes("parked for merchant review")) {
    out.push("awaiting_review");
  }
  const strength = typeof p.case_strength === "string" ? p.case_strength : null;
  if (
    strength === "weak" ||
    strength === "insufficient" ||
    text.includes("strength_insufficient") ||
    text.includes("strength is weak")
  ) {
    out.push("thin_evidence");
  }
  return out;
}

export function classifyHoldReason(input: {
  events: DecidedAuditEvent[];
  hasPack: boolean;
  reviewState: string | null;
}): HoldReason | null {
  const found = new Set<HoldReason>();
  for (const ev of input.events) {
    for (const r of holdReasonsOfEvent(ev, input.hasPack)) found.add(r);
  }
  if (input.reviewState === "conceded") found.add("merchant_conceded");
  // An approval clears the review hold: "waiting for your review" would then
  // be false. Whatever else held the case still stands.
  const approved =
    input.reviewState === "approved" ||
    input.events.some((e) => e.event_type === "review_approved");
  if (approved) found.delete("awaiting_review");
  return HOLD_REASONS.find((r) => found.has(r)) ?? null;
}

function before(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta < tb;
}

/**
 * Resolve who responded on a decided dispute.
 *
 * `weFiledAt` is the earliest moment DisputeDesk saved evidence to Shopify,
 * from any of the three places that record it — never `submission_state`,
 * which is also true on historical imports and on Shopify's own response.
 */
export function resolveDecidedResponse(input: {
  closedAt: string | null;
  dueAt: string | null;
  evidenceSentOn: string | null;
  installedAt: string | null;
  weFiledAt: string | null;
  hasPack: boolean;
  reviewState: string | null;
  events: DecidedAuditEvent[];
}): DecidedResponse {
  const base = {
    filedAt: null,
    sentAt: null,
    closedAt: input.closedAt,
    decidedBeforeDeadline: before(input.closedAt, input.dueAt),
    holdReason: null,
  };

  if (before(input.closedAt, input.installedAt)) {
    return { ...base, responder: "before_install" };
  }
  if (input.weFiledAt) {
    return { ...base, responder: "we", filedAt: input.weFiledAt };
  }
  if (input.evidenceSentOn && before(input.evidenceSentOn, input.installedAt)) {
    return { ...base, responder: "sent_before_install", sentAt: input.evidenceSentOn };
  }

  const holdReason = classifyHoldReason({
    events: input.events,
    hasPack: input.hasPack,
    reviewState: input.reviewState,
  });
  if (input.evidenceSentOn) {
    return { ...base, responder: "shopify", sentAt: input.evidenceSentOn, holdReason };
  }
  return { ...base, responder: "none", holdReason };
}

/**
 * The sentences for a case DisputeDesk did NOT file, in reading order.
 * Empty for `responder = "we"` — `outcomeExplanationToken` owns that copy.
 *
 * `formatDate` is injected so the page (merchant locale via the translator)
 * and the email (store locale) each format dates their own way while sharing
 * every other decision.
 */
export function decidedResponseTokens(
  resp: DecidedResponse,
  formatDate: (iso: string) => string,
): I18nToken[] {
  const k = (key: string, params?: Record<string, string>): I18nToken => ({
    key: `disputes.decidedResponse.${key}`,
    ...(params ? { params } : {}),
  });

  const out: I18nToken[] = [];
  switch (resp.responder) {
    case "we":
      return [];
    case "before_install":
      return [k("beforeInstall")];
    case "sent_before_install":
      return resp.sentAt ? [k("sentBeforeInstall", { date: formatDate(resp.sentAt) })] : [];
    case "shopify":
      out.push(
        resp.sentAt
          ? k("shopifySent", { date: formatDate(resp.sentAt) })
          : k("shopifySentNoDate"),
      );
      break;
    case "none":
      out.push(
        resp.decidedBeforeDeadline && resp.closedAt
          ? k("noneBeforeDeadline", { date: formatDate(resp.closedAt) })
          : k("noneFiled"),
      );
      break;
  }
  if (resp.holdReason) out.push(k(`holdReason.${resp.holdReason}`));
  return out;
}
