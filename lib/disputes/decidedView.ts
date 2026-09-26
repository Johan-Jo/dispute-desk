/**
 * Decided-dispute view model — plan `docs/plans/decided-dispute-view.plan.md`
 * PR 2, design `Decided Dispute View.dc.html` (Claude Design project
 * 39b1425e…). Pure: the workspace route gathers `DecidedViewInputs`, the
 * client calls `buildDecidedView` with its own date formatters, and every
 * string is an `I18nToken` (CLAUDE.md rule 5).
 *
 * Sections, in the design's order:
 *   outcome   — title, product · claim, amount, who responded
 *   facts     — "What we saw in the record" (lost) / "What carried the case" (won)
 *   checklist — "What wins this type of dispute", had / missing for THIS case
 *   nextTime  — lost only; each recommendation needs a trigger in the data
 *   timeline  — "What happened", past tense, from stored timestamps
 *
 * Rules carried from `outcomeExplanation.ts`, all load-bearing:
 *   - Observed facts only. Never "you lost because" — the issuer's reasoning
 *     is Admin-UI-only and we cannot read it.
 *   - Merchant-facing only. Nothing here may reach the bank-facing package.
 *   - No bare gateway codes.
 *   - An empty list is a valid result; the card hides rather than pads.
 */

import type { I18nToken } from "@/lib/i18n/token";
import { resolveReasonFamily, type ReasonFamily } from "@/lib/argument/reasonFamily";
import { readPaymentVerification } from "@/lib/argument/paymentVerification";
import { deriveOutcomeFactors } from "@/lib/disputes/outcomeExplanation";
import {
  decidedResponseTokens,
  holdReasonsOfEvent,
  type DecidedAuditEvent,
  type DecidedResponse,
  type HoldReason,
} from "@/lib/disputes/decidedResponse";

const K = "disputes.decidedView";
const tk = (key: string, params?: I18nToken["params"]): I18nToken => ({
  key: `${K}.${key}`,
  ...(params ? { params } : {}),
});
const nested = (key: string) => ({ type: "i18n-key" as const, key });

export interface DecidedViewInputs {
  outcome: "won" | "lost";
  phase: "inquiry" | "chargeback";
  reason: string | null;
  /** Amount lost or recovered, already chosen by the route. */
  amount: number;
  currency: string;
  openedAt: string | null;
  dueAt: string | null;
  closedAt: string | null;
  response: DecidedResponse | null;
  order: {
    createdAt: string | null;
    fulfillmentStatus: string | null;
    fulfilledAt: string | null;
    cancelledAt: string | null;
    riskRecommendation: string | null;
  } | null;
  lineItems: Array<{ title: string; quantity: number }>;
  /** `evidence_items` payloads keyed by field — the merchant-side record,
   *  including facts correctly withheld from the issuer. */
  facts: Record<string, Record<string, unknown>>;
  /** `pack_json.fatal_loss.reason` when the gate fired. */
  fatalLossReason: string | null;
  /** First evidence pack for this dispute — "Evidence gathered". */
  firstPackAt: string | null;
  /** Dispute-level audit rows, ascending. */
  events: DecidedAuditEvent[];
}

export type ChecklistState = "had" | "missing" | "none";
export type TimelineTone = "muted" | "neutral" | "warning" | "primary" | "danger" | "success";

export interface DecidedView {
  outcome: {
    title: I18nToken;
    decidedAt: string | null;
    product: I18nToken | null;
    claim: I18nToken;
    amountLabel: I18nToken;
  };
  who: { first: I18nToken; second: I18nToken | null } | null;
  facts: { title: I18nToken; items: I18nToken[]; note: I18nToken | null };
  checklist: Array<{ item: I18nToken; state: ChecklistState; label: I18nToken }>;
  nextTime: Array<{ title: I18nToken; detail: I18nToken | null }>;
  timeline: Array<{ at: string; title: I18nToken; detail: I18nToken | null; tone: TimelineTone }>;
}

const DELIVERY_CONFIRMED = new Set(["delivered_confirmed", "signature_confirmed"]);
const DAY_MS = 86_400_000;

function t(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Plain-language claim, per canonical reason. */
function claimToken(reason: string | null): I18nToken {
  const key = (reason ?? "").toUpperCase();
  const known = [
    "FRAUDULENT",
    "UNRECOGNIZED",
    "PRODUCT_NOT_RECEIVED",
    "PRODUCT_UNACCEPTABLE",
    "SUBSCRIPTION_CANCELLED",
    "DUPLICATE",
    "CREDIT_NOT_PROCESSED",
  ];
  return tk(`claim.${known.includes(key) ? key : "GENERAL"}`);
}

function productToken(items: DecidedViewInputs["lineItems"]): I18nToken | null {
  const valid = items.filter((i) => i.title);
  if (valid.length === 0) return null;
  const count = valid.reduce((n, i) => n + (Number.isFinite(i.quantity) && i.quantity > 0 ? i.quantity : 1), 0);
  if (valid.length === 1) return tk("product.one", { title: valid[0].title, count });
  return tk("product.many", { title: valid[0].title, others: valid.length - 1, count });
}

interface CaseFacts {
  family: ReasonFamily;
  hasTracking: boolean;
  deliveryConfirmed: boolean;
  signed: boolean;
  neverFulfilled: boolean;
  fulfilledAfterOpen: boolean;
  avsOutcome: "match" | "no_match" | "unchecked" | null;
  priorUndisputed: number;
  /** Order shipped to its own billing address (city, postcode prefix,
   *  region and country all equal). False when either side is missing. */
  shipsToBilling: boolean;
  has: (field: string) => boolean;
}

function sameAddress(a: unknown, b: unknown): boolean {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : null);
  const keys = ["countryCode", "provinceCode", "zipPrefix", "city"];
  return keys.every((k) => norm(x[k]) !== null && norm(x[k]) === norm(y[k]));
}

function readCase(input: DecidedViewInputs): CaseFacts {
  const f = input.facts;
  const has = (field: string) => Boolean(f[field]);
  const delivery = f.delivery_proof ?? f.shipping_tracking ?? null;
  const proofType = str(delivery?.proofType);
  const avs = f.avs_cvv_match ?? null;
  const account = f.customer_account_info ?? null;
  const prior = Number(account?.priorUndisputedOrders ?? 0);
  const orderUnfulfilled =
    input.order?.fulfillmentStatus === "UNFULFILLED" && !input.order.fulfilledAt;
  const fulfilledAt = t(input.order?.fulfilledAt);
  const openedAt = t(input.openedAt);
  return {
    family: resolveReasonFamily(input.reason),
    hasTracking: has("shipping_tracking"),
    deliveryConfirmed: proofType !== null && DELIVERY_CONFIRMED.has(proofType),
    signed: str(delivery?.signedByName) !== null,
    neverFulfilled: input.fatalLossReason === "inr_no_fulfillment" || orderUnfulfilled,
    fulfilledAfterOpen: fulfilledAt !== null && openedAt !== null && fulfilledAt > openedAt,
    avsOutcome: avs ? readPaymentVerification(avs).avs.outcome : null,
    priorUndisputed: Number.isFinite(prior) ? prior : 0,
    shipsToBilling: sameAddress(f.order_confirmation?.billingAddress, f.order_confirmation?.shippingAddress),
    has,
  };
}

function factsSection(input: DecidedViewInputs, c: CaseFacts, fmtDate: (iso: string) => string) {
  const factorFacts = Object.entries(input.facts).map(([fieldKey, payload]) => ({
    value: { ...payload, fieldKey },
  }));
  const factors = deriveOutcomeFactors({
    facts: factorFacts,
    reason: input.reason,
    outcome: input.outcome,
  });
  const bullet = (key: string): I18nToken => tk("facts.bullet", { clause: nested(key) });
  const items: I18nToken[] = [];

  if (input.outcome === "lost") {
    const deliveryMatters = c.family === "delivery" || c.family === "product" || c.family === "fraud";
    if (c.neverFulfilled) items.push(tk("facts.neverShipped"));
    else if (c.fulfilledAfterOpen && input.order?.fulfilledAt) {
      items.push(tk("facts.shippedAfterDispute", { date: fmtDate(input.order.fulfilledAt) }));
    }
    if (deliveryMatters && !c.deliveryConfirmed) {
      items.push(
        c.hasTracking ? bullet("disputes.outcomeExplanation.factor.no_delivery_confirmation") : tk("facts.noTracking"),
      );
    }
    for (const f of factors) {
      if (f.code === "no_delivery_confirmation") continue; // stated above, more precisely
      items.push(bullet(f.token.key));
    }
    const note =
      c.family === "delivery" && !c.deliveryConfirmed ? tk("facts.noteNotReceived") : null;
    return { title: tk("facts.titleLost"), items, note };
  }

  for (const f of factors) items.push(bullet(f.token.key));
  if (c.priorUndisputed > 0) {
    items.push(tk("facts.priorUndisputed", { count: c.priorUndisputed }));
  }
  return { title: tk("facts.titleWon"), items, note: null };
}

type Row = { item: string; state: ChecklistState; label: string };

function checklistSection(c: CaseFacts, input: DecidedViewInputs): DecidedView["checklist"] {
  // No evidence items at all means we do not know what the case had.
  // "Missing" on every row would be a claim, not an observation (#347615).
  if (Object.keys(input.facts).length === 0) return [];
  const had = (item: string, yes: boolean, missingLabel: "missing" | "none" = "missing", hadLabel = "had"): Row =>
    yes
      ? { item, state: "had", label: hadLabel }
      : { item, state: missingLabel === "missing" ? "missing" : "none", label: missingLabel };
  const comms = had("communication", c.has("customer_communication"), "none");
  let rows: Row[];
  switch (c.family) {
    case "delivery":
      rows = [
        had("tracking", c.hasTracking),
        had("deliveryConfirmation", c.deliveryConfirmed),
        had("promisedDelivery", c.has("shipping_policy"), "missing", "policy"),
        comms,
      ];
      break;
    case "fraud": {
      rows = [];
      // Only where AVS exists at all — a PayPal or Klarna case has none, and
      // "missing" would blame the merchant for a check that could not run.
      if (c.avsOutcome !== null) {
        rows.push(
          c.avsOutcome === "match"
            ? { item: "addressMatch", state: "had", label: "had" }
            : c.avsOutcome === "no_match"
              ? { item: "addressMatch", state: "missing", label: "missing" }
              : { item: "addressMatch", state: "none", label: "notChecked" },
        );
      }
      // "Delivery to the billing address" means the CARDHOLDER's billing
      // address, so it needs all three: a confirmed delivery, a shipping
      // address equal to the order's billing address, and AVS confirming that
      // billing address belongs to the card. #349145 shipped to its own
      // billing address with AVS "N" — that is not delivery to the cardholder.
      rows.push(
        had("deliveryToBilling", c.deliveryConfirmed && c.shipsToBilling && c.avsOutcome === "match"),
      );
      rows.push(had("priorOrders", c.priorUndisputed > 0, "none"));
      rows.push(
        c.has("tds_authentication")
          ? { item: "threeDs", state: "had", label: "had" }
          : { item: "threeDs", state: "none", label: "notUsed" },
      );
      break;
    }
    case "product":
      rows = [
        had("productDescription", c.has("product_description")),
        had("refundPolicy", c.has("refund_policy"), "missing", "policy"),
        had("deliveryConfirmation", c.deliveryConfirmed),
        comms,
      ];
      break;
    case "refund":
      rows = [
        had("refundPolicy", c.has("refund_policy"), "missing", "policy"),
        had("refundRecord", c.has("refund_record")),
        had("noReturn", c.has("no_return_initiated") || c.has("returned_parcel_outcome")),
        comms,
      ];
      break;
    case "subscription":
      rows = [
        had("cancellationPolicy", c.has("cancellation_policy"), "missing", "policy"),
        had("activityAfterCancel", c.has("activity_log")),
        comms,
      ];
      break;
    case "billing":
      rows = [
        had("duplicateExplanation", c.has("duplicate_explanation")),
        had("orderConfirmation", c.has("order_confirmation")),
        comms,
      ];
      break;
    default:
      rows = [
        had("orderConfirmation", c.has("order_confirmation")),
        had("storePolicies", c.has("refund_policy") || c.has("shipping_policy") || c.has("cancellation_policy"), "missing", "policy"),
        comms,
      ];
  }
  return rows.map((r) => ({
    item: tk(`checklist.item.${r.item}`),
    state: r.state,
    label: tk(`checklist.state.${r.label}`),
  }));
}

function nextTimeSection(input: DecidedViewInputs, c: CaseFacts): DecidedView["nextTime"] {
  if (input.outcome !== "lost") return [];
  const out: DecidedView["nextTime"] = [];
  const created = t(input.order?.createdAt);
  const opened = t(input.openedAt);
  const days = created !== null && opened !== null ? Math.max(0, Math.round((opened - created) / DAY_MS)) : null;

  if (c.family === "delivery" && c.neverFulfilled) {
    out.push({
      title: tk("next.shipOrCancel.title"),
      detail: days !== null ? tk(`next.shipOrCancel.detail.${input.phase}`, { days }) : null,
    });
  } else if (c.family === "delivery" && c.fulfilledAfterOpen) {
    out.push({ title: tk("next.shipOrCancel.title"), detail: tk("next.shipOrCancel.detailLate") });
  }
  if (c.family === "delivery" && !c.neverFulfilled && !c.hasTracking) {
    out.push({ title: tk("next.shareTracking.title"), detail: tk("next.shareTracking.detail") });
  }
  if (c.family === "fraud") {
    const risk = (input.order?.riskRecommendation ?? "").toUpperCase();
    if ((risk === "CANCEL" || risk === "INVESTIGATE") && !c.neverFulfilled) {
      out.push({ title: tk("next.holdHighRisk.title"), detail: tk("next.holdHighRisk.detail") });
    }
    if (!c.has("tds_authentication")) {
      out.push({ title: tk("next.threeDs.title"), detail: tk("next.threeDs.detail") });
    }
  }
  if (c.family === "subscription") {
    out.push({ title: tk("next.selfServeCancel.title"), detail: tk("next.selfServeCancel.detail") });
  }
  if (c.family === "product") {
    out.push({ title: tk("next.describeProduct.title"), detail: tk("next.describeProduct.detail") });
  }
  if (c.family === "refund") {
    out.push({ title: tk("next.confirmRefunds.title"), detail: tk("next.confirmRefunds.detail") });
  }
  return out.slice(0, 3);
}

function timelineSection(
  input: DecidedViewInputs,
  claim: I18nToken,
  fmtDate: (iso: string) => string,
  fmtMoney: (amount: number, currency: string) => string,
  c: CaseFacts,
): DecidedView["timeline"] {
  const steps: DecidedView["timeline"] = [];
  const resp = input.response;
  const claimParam = nested(claim.key);

  if (input.openedAt) {
    steps.push({
      at: input.openedAt,
      title: tk("timeline.opened"),
      detail: input.dueAt
        ? tk("timeline.openedDetail", { claim: claimParam, due: fmtDate(input.dueAt) })
        : tk("timeline.openedDetailNoDue", { claim: claimParam }),
      tone: "muted",
    });
  }
  if (input.firstPackAt && resp?.responder !== "before_install") {
    const deliveryMissing =
      input.outcome === "lost" &&
      (c.family === "delivery" || c.family === "product") &&
      !c.deliveryConfirmed &&
      !c.hasTracking;
    steps.push({
      at: input.firstPackAt,
      title: tk("timeline.gathered"),
      detail: deliveryMissing ? tk("timeline.gatheredNoDelivery") : null,
      tone: "neutral",
    });
  }

  const held = resp && (resp.responder === "shopify" || resp.responder === "none") ? resp.holdReason : null;
  if (held) {
    const hasPack = input.firstPackAt !== null;
    const first = input.events.find((e) => holdReasonsOfEvent(e, hasPack).includes(held));
    if (first?.created_at) {
      steps.push({
        at: first.created_at,
        title: tk(`timeline.held.${held}.title`),
        detail: HELD_DETAIL.has(held) ? tk(`timeline.held.${held}.detail`) : null,
        tone: "warning",
      });
    }
  }

  const emailed = new Set<string>();
  for (const e of input.events) {
    if (!e.created_at) continue;
    if (e.event_type === "fatal_loss_alert_sent" && !emailed.has(e.event_type)) {
      emailed.add(e.event_type);
      steps.push({ at: e.created_at, title: tk("timeline.emailed"), detail: tk("timeline.emailedFatalLoss"), tone: "neutral" });
    }
    if (e.event_type === "billing_blocked_email_sent" && !emailed.has(e.event_type)) {
      emailed.add(e.event_type);
      steps.push({ at: e.created_at, title: tk("timeline.emailed"), detail: tk("timeline.emailedPlanLimit"), tone: "neutral" });
    }
  }

  if (resp?.responder === "we" && resp.filedAt) {
    steps.push({ at: resp.filedAt, title: tk("timeline.weFiled"), detail: tk("timeline.weFiledDetail"), tone: "primary" });
  }
  if ((resp?.responder === "shopify" || resp?.responder === "sent_before_install") && resp.sentAt) {
    steps.push({ at: resp.sentAt, title: tk("timeline.shopifySent"), detail: tk("timeline.shopifySentDetail"), tone: "neutral" });
  }

  const cancelled = input.order?.cancelledAt ?? null;
  const cancelledT = t(cancelled);
  const openedT = t(input.openedAt);
  if (cancelled && cancelledT !== null && openedT !== null && cancelledT >= openedT) {
    steps.push({ at: cancelled, title: tk("timeline.cancelled"), detail: null, tone: "neutral" });
  }

  if (input.closedAt) {
    const money = fmtMoney(input.amount, input.currency);
    steps.push(
      input.outcome === "lost"
        ? { at: input.closedAt, title: tk("timeline.lost"), detail: tk("timeline.lostDetail", { amount: money }), tone: "danger" }
        : { at: input.closedAt, title: tk("timeline.won"), detail: tk("timeline.wonDetail", { amount: money }), tone: "success" },
    );
  }

  return steps
    .map((s, i) => ({ s, i, at: t(s.at) ?? 0 }))
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .map(({ s }) => s);
}

/** Held reasons that carry a detail line under the timeline title. */
const HELD_DETAIL = new Set<HoldReason>([
  "not_shipped",
  "refunded",
  "covered",
  "thin_evidence",
  "awaiting_review",
  "plan_limit",
  "auto_build_off",
]);

function whoSection(input: DecidedViewInputs, fmtDate: (iso: string) => string): DecidedView["who"] {
  const resp = input.response;
  if (!resp) return null;
  if (resp.responder === "we") {
    return resp.filedAt ? { first: tk("who.weFiled", { date: fmtDate(resp.filedAt) }), second: null } : null;
  }
  const tokens = decidedResponseTokens(resp, fmtDate);
  if (tokens.length === 0) return null;
  return { first: tokens[0], second: tokens[1] ?? null };
}

export function buildDecidedView(
  input: DecidedViewInputs,
  fmt: {
    /** Full date, e.g. "Sep 17, 2026". */
    date: (iso: string) => string;
    money: (amount: number, currency: string) => string;
  },
): DecidedView {
  const c = readCase(input);
  const claim = claimToken(input.reason);
  return {
    outcome: {
      title: tk(input.outcome === "lost" ? "outcome.titleLost" : "outcome.titleWon"),
      decidedAt: input.closedAt,
      product: productToken(input.lineItems),
      claim,
      amountLabel: tk(input.outcome === "lost" ? "outcome.amountLost" : "outcome.amountRecovered"),
    },
    who: whoSection(input, fmt.date),
    facts: factsSection(input, c, fmt.date),
    checklist: checklistSection(c, input),
    nextTime: nextTimeSection(input, c),
    timeline: timelineSection(input, claim, fmt.date, fmt.money, c),
  };
}
