/**
 * The dispute record: ONE record of facts per dispute, read by every sentence
 * on every tab of the dispute page.
 *
 * Spec: Claude Design project fca59ec9… `NewDispute.dc.html` + `dispute-data.js`
 * (`NEW[x]` is the record; `F` holds each fact once; `account` is an ordered
 * list of fact KEYS; `items` carry exactly one `role`). This module is the
 * transcription of that data model, driven by the workspace payload instead of
 * hand-written strings:
 *
 *   - `facts` (design `F`): one `I18nToken` per fact key. The Overview account,
 *     the timeline, the package card, the checklist note and the "What
 *     reaches the bank" sentence all read the SAME token, so one fact cannot
 *     be stated two ways on one page.
 *   - `items`: every piece of evidence, each with exactly ONE role (cited |
 *     context | internal | unavailable). The per-role counts are computed
 *     from the items, never stored, so the Overview, Evidence and Review tabs
 *     cannot disagree on a count.
 *   - `account`: the ordered fact keys the hero paragraph joins.
 *
 * Merchant-side, read-time only. Nothing here writes to `pack_json`, and
 * nothing here is bank-facing: the letter, the PDF, the chronology and the
 * hashes do not read it. No English: every sentence is an `I18nToken`
 * (CLAUDE.md rule 5); dates and money arrive pre-formatted from `RecordFormat`.
 *
 * Roles follow what the product actually does, not what a sentence would like
 * to say: an item is "cited" only when the evidence line marks it as positive
 * bank evidence (and, for a decided dispute, the submitted package carried it).
 * A card-security check is not an address check, so a Mastercard AVS match is
 * context, as `lib/argument/paymentVerification.ts` decides.
 */

import type { I18nKeyParam, I18nToken } from "@/lib/i18n/token";
import { resolveReasonFamily } from "@/lib/argument/reasonFamily";
import { readPaymentVerification, type VerificationOutcome } from "@/lib/argument/paymentVerification";
import { detectCardholderNameMismatch } from "@/lib/argument/nameMismatch";
import {
  buildChecklistRows,
  buildDecidedView,
  storeRateToken,
  type DecidedViewInputs,
} from "@/lib/disputes/decidedView";
import { RETURN_EVIDENCE_FIELD } from "@/lib/packs/returnEvidenceField";
import { utcDaysUntil, type RecordFormat } from "@/lib/disputes/recordFormat";

const NS = "disputes.record";
const tk = (key: string, params?: I18nToken["params"]): I18nToken => ({
  key: `${NS}.${key}`,
  ...(params ? { params } : {}),
});
const nest = (key: string, params?: I18nKeyParam["params"]): I18nKeyParam => ({
  type: "i18n-key",
  key: `${NS}.${key}`,
  ...(params ? { params } : {}),
});

/* ── Types ── */

export type RecordStatus = "open" | "won" | "lost" | "closed";

/** Where the dispute stands. Every stage reads the same record and the same
 *  layout; only the sentences about "where it stands" differ. */
export type RecordStage =
  | "no_pack"
  | "building"
  | "failed"
  | "prepared"
  | "prepared_review"
  | "held"
  | "needs_attention"
  | "covered"
  | "fatal"
  | "saved"
  | "under_review"
  | "decided";
export type RecordRole = "cited" | "context" | "internal" | "unavailable";
export const ROLE_ORDER: readonly RecordRole[] = ["cited", "context", "internal", "unavailable"];

export type ItemKey =
  | "signature"
  | "pay"
  | "name"
  | "screen"
  | "ip"
  | "delivery"
  | "return"
  | "order"
  | "history"
  | "shipping"
  | "refundpol"
  | "cancel"
  | "addr"
  | "tds"
  | "comms";

/** The canonical item order. Within a role the rows read in this order on
 *  every tab. */
const ITEM_ORDER: readonly ItemKey[] = [
  "signature",
  "pay",
  "name",
  "screen",
  "ip",
  "delivery",
  "return",
  "order",
  "history",
  "shipping",
  "refundpol",
  "cancel",
  "addr",
  "tds",
  "comms",
];

export type FactKey =
  | "claim"
  | "prepared"
  | "autopilot"
  | "strength"
  | "roles"
  | "action"
  | "filed"
  | "cited"
  | "withheld"
  | "outcome"
  | "amounts"
  | "state"
  | "reviewMode"
  | "held"
  | "attention"
  | "covered"
  | "fatal"
  | "saved"
  | "underReview"
  | "due"
  | "reopened"
  | "escalated"
  | "noReason";

export type StrengthPill = "Strong" | "Moderate" | "Supporting";

export interface RecordItem {
  key: ItemKey;
  role: RecordRole;
  /** Shown for cited / context rows only. */
  strength: StrengthPill | null;
  label: I18nToken;
  detail: I18nToken;
  source: I18nToken;
  /** A fact that would weaken the case with the bank; named in the "withheld" sentence. */
  adverse: boolean;
  /** The short noun phrase used inside the cited / withheld list sentences. */
  phrase: I18nKeyParam | null;
}

export type ChecklistState = "had" | "missing" | "none";

export interface ChecklistRow {
  /** Row key (`addressMatch`, `deliveryToBilling`, ...). */
  id: string;
  item: I18nToken;
  state: ChecklistState;
  label: I18nToken;
  /** The detail of the evidence item this row is graded from, when there is one. */
  sub: I18nToken | null;
}

export type TimelineKind = "done" | "current" | "pending" | "filed" | "lost" | "won";

export interface TimelineStep {
  /** ISO instant; the renderer formats it with the one date format. */
  at: string;
  title: I18nToken;
  text: I18nToken;
  kind: TimelineKind;
}

export interface HelpItem {
  title: I18nToken;
  detail: I18nToken;
  /** "ack" opens the existing cardholder-acknowledgement flow. */
  action: { kind: "ack"; label: I18nToken } | null;
}

export interface DisputeRecord {
  status: RecordStatus;
  stage: RecordStage;
  /** The evidence roles apply: a defence package exists (prepared, saved or filed). */
  showRoles: boolean;
  phase: "chargeback" | "inquiry";
  header: {
    orderName: string | null;
    amount: string;
    customer: string | null;
    opened: string | null;
    deadline: string | null;
    daysLeft: number | null;
    decided: string | null;
  };
  hero: {
    headline: I18nToken;
    claimShort: I18nToken;
    amountLabel: I18nToken;
    statusChip: I18nToken;
    /** The live case-strength band, shown as a pill in the header while a package is prepared and not yet saved (same condition as the strength sentence). */
    strengthBand: "strong" | "moderate" | "weak" | null;
  };
  facts: Partial<Record<FactKey, I18nToken>>;
  /** The hero paragraph: fact keys, in reading order. */
  account: FactKey[];
  counts: Record<RecordRole, number>;
  items: RecordItem[];
  /** "The record" list on Overview: item keys, then the amounts line. */
  recordRows: Array<ItemKey | "amounts">;
  checklist: { rows: ChecklistRow[]; had: number; total: number; odds: I18nToken | null; note: I18nToken | null };
  help: { title: I18nToken; items: HelpItem[] } | null;
  timelineTitle: I18nToken;
  timeline: TimelineStep[];
  /** The package card: the fact keys it reads (first one bold). */
  pkg: { lines: FactKey[] };
  /** Actions the page offers in this stage. The component gates each on the
   *  package's own action state. */
  canDecide: boolean;
  decision: "approved" | "conceded" | "in_review" | null;
}

export interface RecordLine {
  field: string;
  hasEvidence: boolean;
  method: string;
  /** Lower-case strength contribution of the evidence line. */
  strength: string;
}

export interface RecordInputs {
  status: RecordStatus;
  /** The decided view's inputs (synthesised for an open dispute): reason,
   *  amounts, dates, the evidence payloads by field, order facts. */
  view: DecidedViewInputs;
  /** The instant "days left" is counted from. */
  now: string;
  orderName: string | null;
  customerName: string | null;
  cardholderName: string | null;
  cardNetwork: string | null;
  cardLast4: string | null;
  gateway: string | null;
  /** Open only: the presentation strength band. */
  strength: string | null;
  pkg: { version: number | null; preparedAt: string | null; filedAt: string | null };
  lines: RecordLine[];
  /** Decided only: evidence fields the SUBMITTED package carried as bank-eligible
   *  narrative. Null = unknown (an open dispute, or no submitted package read). */
  bankCitedFields: string[] | null;
  /**
   * What the STORED letter cites (`lib/disputes/letterCitations.ts`): the
   * evidence fields its Evidence Basis lists, under the rule the package was
   * built with. When present it IS the cited set — the page says "only the items
   * cited to the bank appear in the letter's evidence basis", and this is how
   * that sentence stays true for a new package and for a legacy one. Absent
   * (no stored letter yet) keeps the live evidence line's own reading.
   */
  letter?: { rule: 1 | 2; citedFields: string[] } | null;
  /** Shopify's refund situation for the order. */
  refund: "none" | "some" | "unknown";
  timelineEvents: Array<{ at?: string; text?: string }>;
  /** Gorgias is connected and found no conversations for this customer. */
  gorgiasFoundNone: boolean;
  /** The cardholder-acknowledgement flow is offered on this dispute. */
  offerAck: boolean;
  /** Open only: automation mode the package is filed under. */
  automationMode: "auto" | "review" | null;
  stage: RecordStage;
  /** The dispute list already calls this state "Pack prepared" (the evidence pack is ready while the defence package is still being built). The header chip then uses the same word from the same key, so list and page cannot disagree. */
  packPrepared?: boolean;
  /** A defence package exists for the roles to describe. */
  hasPackage: boolean;
  /** Decided: who responded. */
  responder: "we" | "shopify" | "none" | "before_install" | "sent_before_install" | null;
  sentAt: string | null;
  /** When the package was saved to Shopify (open, after saving). */
  savedAt: string | null;
  reopenedAt: string | null;
  escalatedAt: string | null;
  /** Absolute i18n key of the existing attention label for this dispute. */
  attentionKey: string | null;
  /** `inr_no_fulfillment` | `refund_issued` when the fatal-loss gate fired. */
  fatalReason: string | null;
  /** Shopify's return situation for the order. */
  returns: "none" | "requested" | "in_progress" | "returned" | "failed" | "unknown";
  /** A customer message in the support inbox asks to return this order (read-time, Gorgias). */
  customerAskedInSupport?: boolean;
  canDecide: boolean;
  decision: "approved" | "conceded" | "in_review" | null;
}

/* ── Readers ── */

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}
function rec(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const DELIVERY_CONFIRMED = new Set(["delivered_confirmed", "signature_confirmed"]);

/** Fact category -> evidence field, for reading the submitted package's facts. */
export const FACT_CATEGORY_FIELD: Record<string, string> = {
  ip_location: "ip_location_check",
  fraud_screening: "fraud_risk_screening",
  shipping_tracking: "shipping_tracking",
  delivery_proof: "shipping_tracking",
  no_return_initiated: RETURN_EVIDENCE_FIELD,
  payment_authentication: "avs_cvv_match",
  order_record: "order_confirmation",
};

function sameAddress(a: unknown, b: unknown): boolean | null {
  const x = rec(a);
  const y = rec(b);
  if (!x || !y) return null;
  const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : null);
  const keys = ["city", "countryCode"];
  if (keys.some((k) => norm(x[k]) === null || norm(y[k]) === null)) return null;
  return keys.every((k) => norm(x[k]) === norm(y[k]));
}

function strengthPill(s: string | undefined): StrengthPill | null {
  switch ((s ?? "").toLowerCase()) {
    case "strong":
      return "Strong";
    case "moderate":
      return "Moderate";
    case "supporting":
      return "Supporting";
    default:
      return null;
  }
}

/* ── Items ── */

interface ItemCtx {
  i: RecordInputs;
  facts: Record<string, Record<string, unknown>>;
  fmt: RecordFormat;
  line: (field: string) => RecordLine | undefined;
  /** Role the evidence line gives a field, before the item's own facts adjust it. */
  lineRole: (field: string) => RecordRole;
  fraud: boolean;
}

function roleFromLine(i: RecordInputs, line: RecordLine | undefined, field: string): RecordRole {
  if (!line || !line.hasEvidence) return "unavailable";
  // The stored letter decides what is cited: a field is cited exactly when the
  // letter's Evidence Basis lists it. Everything else the package carries is
  // context (the package holds it, the argument does not rest on it) or, when
  // the evidence line routes it away from the bank, internal.
  if (i.letter) {
    if (i.letter.citedFields.includes(field)) return "cited";
    return line.method === "bank_argument" || line.method === "context_only" ? "context" : "internal";
  }
  let role: RecordRole;
  switch (line.method) {
    case "bank_argument":
      role = "cited";
      break;
    case "context_only":
      role = "context";
      break;
    default:
      role = "internal";
  }
  // A decided dispute: what the SUBMITTED package carried is the truth. A row
  // the live evidence marks citable, but the filed package did not cite, is
  // context.
  if (role === "cited" && i.status !== "open" && i.bankCitedFields && !i.bankCitedFields.includes(field)) {
    role = "context";
  }
  return role;
}

const src = (key: string, params?: I18nToken["params"]) => tk(`source.${key}`, params);

function gatewaySource(i: RecordInputs): I18nToken {
  return i.gateway ? src("gateway", { gateway: i.gateway }) : src("shopify");
}

function deliveryParts(facts: Record<string, Record<string, unknown>>) {
  const d = facts.shipping_tracking ?? facts.delivery_proof ?? null;
  if (!d) return null;
  const fulfillments = Array.isArray(d.fulfillments) ? (d.fulfillments as unknown[]) : [];
  const f = rec(fulfillments[0]);
  const tracking = Array.isArray(f?.tracking) ? rec((f?.tracking as unknown[])[0]) : null;
  const proof = str(d.proofType);
  return {
    confirmed: proof !== null && DELIVERY_CONFIRMED.has(proof),
    deliveredAt: str(d.deliveredAt) ?? str(f?.deliveredAt),
    shippedAt: str(f?.createdAt),
    carrier: str(tracking?.carrier),
    number: str(tracking?.number),
    signed: str(d.signedByName) !== null,
  };
}

function buildItems(c: ItemCtx): RecordItem[] {
  const { i, facts, fmt } = c;
  const items: RecordItem[] = [];
  const add = (it: RecordItem) => items.push(it);

  /* Payment authentication */
  const avs = facts.avs_cvv_match;
  if (avs) {
    const v = readPaymentVerification(avs);
    const a: VerificationOutcome | null = v.avs.outcome;
    const cv: VerificationOutcome | null = v.cvv.outcome;
    let variant: string;
    if (a === "match" && cv === "match") variant = "both";
    else if (a === "no_match" && cv === "match") variant = "cvvOnly";
    else if (a === "match" && cv === "no_match") variant = "avsOnly";
    else if (a === "match") variant = "avsMatch";
    else if (a === "no_match" && cv === "no_match") variant = "neither";
    else if (a === "no_match") variant = "avsNo";
    else if (cv === "match") variant = "cvvMatch";
    else if (cv === "no_match") variant = "cvvNo";
    else variant = "unchecked";
    const bad = a === "no_match" || cv === "no_match";
    add({
      key: "pay",
      role: bad ? "internal" : c.lineRole("avs_cvv_match") === "unavailable" ? "context" : c.lineRole("avs_cvv_match"),
      strength: bad ? null : strengthPill(c.line("avs_cvv_match")?.strength),
      label: tk("item.pay.label"),
      detail: tk(`item.pay.${variant}`),
      source: gatewaySource(i),
      adverse: bad,
      phrase: bad
        ? nest(a === "no_match" ? "phrase.withheld.avsMismatch" : "phrase.withheld.cvvMismatch")
        : nest("phrase.cited.pay"),
    });
  }

  /* Cardholder name */
  const cardName = str(avs?.cardholderName) ?? i.cardholderName;
  const buyer = i.customerName;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  if (cardName && buyer && norm(cardName) !== norm(buyer)) {
    add({
      key: "name",
      role: "internal",
      strength: null,
      label: tk("item.name.label"),
      detail: tk("item.name.detail", { card: cardName, buyer }),
      source: gatewaySource(i),
      adverse: c.fraud && detectCardholderNameMismatch(cardName, buyer),
      phrase: nest("phrase.withheld.name"),
    });
  }

  /* Pre-authorization fraud screening */
  const risk = facts.fraud_risk_screening;
  if (risk) {
    const rec_ = (str(risk.recommendation) ?? str(i.view.order?.riskRecommendation) ?? "").toUpperCase();
    const known = rec_ === "ACCEPT" ? "accept" : rec_ === "CANCEL" ? "cancel" : rec_ === "INVESTIGATE" ? "investigate" : "noVerdict";
    const negative = known === "cancel" || known === "investigate";
    const lr = c.lineRole("fraud_risk_screening");
    add({
      key: "screen",
      role: negative ? "internal" : lr === "unavailable" ? "context" : lr,
      strength: negative ? null : strengthPill(c.line("fraud_risk_screening")?.strength),
      label: tk("item.screen.label"),
      detail: tk(`item.screen.${known}`),
      source: src("shopify"),
      adverse: negative,
      phrase: negative ? nest("phrase.withheld.screen") : nest("phrase.cited.screen"),
    });
  }

  /* IP & location */
  const ip = facts.ip_location_check;
  if (ip) {
    const match = str(ip.locationMatch);
    const priv = rec(rec(ip.ipinfo)?.privacy);
    const anonymised = priv ? priv.vpn === true || priv.proxy === true || priv.hosting === true : false;
    const variant = anonymised ? "anonymised" : match === "same_country" ? "same" : match === "different_country" ? "different" : "unknown";
    const bad = variant === "anonymised" || variant === "different";
    const lr = c.lineRole("ip_location_check");
    add({
      key: "ip",
      role: bad ? "internal" : lr === "unavailable" ? "context" : lr,
      strength: bad ? null : strengthPill(c.line("ip_location_check")?.strength),
      label: tk("item.ip.label"),
      detail: tk(`item.ip.${variant}`),
      source: src("ip"),
      adverse: bad,
      phrase: bad ? nest("phrase.withheld.ip") : nest("phrase.cited.ip"),
    });
  }

  /* Delivery (+ signature) */
  const dl = deliveryParts(facts);
  if (dl) {
    const p: I18nToken["params"] = {};
    let variant: string;
    if (dl.confirmed && dl.deliveredAt) {
      p.date = fmt.date(dl.deliveredAt);
      if (dl.carrier) p.carrier = dl.carrier;
      if (dl.number) p.number = dl.number;
      variant = dl.carrier ? (dl.number ? "full" : "noNumber") : dl.number ? "noCarrier" : "dateOnly";
    } else {
      if (dl.carrier) p.carrier = dl.carrier;
      if (dl.number) p.number = dl.number;
      variant = dl.carrier ? (dl.number ? "pending" : "pendingNoNumber") : "pendingNoCarrier";
    }
    const lr = c.lineRole("shipping_tracking");
    add({
      key: "delivery",
      role: lr === "unavailable" ? "context" : lr,
      strength: strengthPill(c.line("shipping_tracking")?.strength),
      label: tk("item.delivery.label"),
      detail: tk(`item.delivery.${variant}`, p),
      source: src("carrier"),
      adverse: false,
      phrase: nest("phrase.cited.delivery"),
    });
    if (i.status === "lost" && c.fraud && dl.confirmed && !dl.signed) {
      add({
        key: "signature",
        role: "internal",
        strength: null,
        label: tk("item.signature.label"),
        detail: tk("item.signature.detail"),
        source: src("carrier"),
        adverse: true,
        phrase: nest("phrase.withheld.signature"),
      });
    }
  }

  /* Return and refund */
  const retLine = c.line(RETURN_EVIDENCE_FIELD);
  const returnOnRecord = i.returns !== "none" && i.returns !== "unknown";
  if (returnOnRecord || i.refund === "some") {
    // The order carries a return or a refund: stated once, kept internal (it is
    // not evidence the bank is given), and named among the facts withheld.
    const detail = returnOnRecord ? `item.return.${i.returns}` : "item.return.refundSome";
    add({
      key: "return",
      role: "internal",
      strength: null,
      label: tk("item.return.label"),
      detail: tk(detail),
      source: src("shopify"),
      adverse: true,
      phrase: nest(returnOnRecord ? "phrase.withheld.returnOnRecord" : "phrase.withheld.refundOnRecord"),
    });
  } else if (i.customerAskedInSupport === true) {
    // Shopify records no return, but a customer message in the support inbox asks
    // to return the order: "no return on record" would be a false claim. Stated
    // once, adverse, and named among the facts withheld. It is internal unless the
    // letter that was built already cites the no-return fact: then the page must
    // still say the bank was told so (role "cited"), beside the true sentence.
    const filed = c.lineRole(RETURN_EVIDENCE_FIELD) === "cited";
    add({
      key: "return",
      role: filed ? "cited" : "internal",
      strength: null,
      label: tk("item.return.label"),
      detail: tk("item.return.askedInSupport"),
      source: src("gorgias"),
      adverse: true,
      phrase: filed ? nest("phrase.cited.returnOnly") : nest("phrase.withheld.returnAskedInSupport"),
    });
  } else if (retLine?.hasEvidence) {
    const none = i.refund === "none";
    const lr = c.lineRole(RETURN_EVIDENCE_FIELD);
    add({
      key: "return",
      role: lr === "unavailable" ? "context" : lr,
      strength: strengthPill(retLine.strength),
      label: tk("item.return.label"),
      detail: tk(none ? "item.return.none" : "item.return.returnOnly"),
      source: src("shopify"),
      adverse: false,
      phrase: nest(none ? "phrase.cited.returnNone" : "phrase.cited.returnOnly"),
    });
  }

  /* Documents and policies */
  const doc = (key: ItemKey, field: string, detail: string, source: I18nToken) => {
    const l = c.line(field);
    if (!l?.hasEvidence) return;
    const lr = c.lineRole(field);
    add({
      key,
      role: lr === "unavailable" ? "context" : lr,
      strength: strengthPill(l.strength),
      label: tk(`item.${key}.label`),
      detail: tk(detail),
      source,
      adverse: false,
      phrase: null,
    });
  };
  doc("order", "order_confirmation", c.fraud ? "item.order.fraud" : "item.order.generic", src("shopify"));
  doc("history", "activity_log", "item.history.detail", src("shopify"));
  doc("shipping", "shipping_policy", "item.shipping.detail", src("policy"));
  doc("refundpol", "refund_policy", "item.refundpol.detail", src("policy"));
  doc("cancel", "cancellation_policy", "item.cancel.detail", src("policy"));

  /* Billing and shipping addresses */
  const order = facts.order_confirmation;
  const agree = order ? sameAddress(order.billingAddress, order.shippingAddress) : null;
  if (agree !== null) {
    add({
      key: "addr",
      role: "internal",
      strength: null,
      label: tk(agree ? "item.addr.labelAgree" : "item.addr.labelDiffer"),
      detail: tk(agree ? "item.addr.agree" : "item.addr.differ"),
      source: src("order"),
      adverse: !agree,
      phrase: agree ? null : nest("phrase.withheld.addr"),
    });
  }

  /* 3-D Secure */
  const tds = facts.tds_authentication;
  add({
    key: "tds",
    role: tds ? (i.letter?.citedFields.includes("tds_authentication") ? "cited" : "context") : "unavailable",
    strength: tds ? strengthPill(c.line("tds_authentication")?.strength) : null,
    label: tk("item.tds.label"),
    detail: tk(tds ? "item.tds.present" : "item.tds.none"),
    source: gatewaySource(i),
    adverse: false,
    phrase: null,
  });

  /* Customer communication */
  const commsLine = c.line("customer_communication");
  const hasComms = Boolean(commsLine?.hasEvidence);
  const commsRole = hasComms ? c.lineRole("customer_communication") : "unavailable";
  add({
    key: "comms",
    role: commsRole === "unavailable" ? "unavailable" : commsRole,
    strength: hasComms ? strengthPill(commsLine?.strength) : null,
    label: tk("item.comms.label"),
    detail: tk(hasComms ? "item.comms.present" : i.gorgiasFoundNone ? "item.comms.noneGorgias" : "item.comms.none"),
    source: src(hasComms ? "shopify" : i.gorgiasFoundNone ? "gorgias" : "upload"),
    adverse: false,
    phrase: null,
  });

  return items.sort((a, b) => ITEM_ORDER.indexOf(a.key) - ITEM_ORDER.indexOf(b.key));
}

/* ── Lists ── */

function listToken(base: "cited" | "withheld", phrases: I18nKeyParam[]): I18nToken | null {
  const n = Math.min(phrases.length, 6);
  if (n === 0) return null;
  const params: Record<string, I18nKeyParam> = {};
  phrases.slice(0, n).forEach((p, idx) => {
    params["abcdef"[idx]] = p;
  });
  return tk(`list.${base === "cited" ? "and" : "or"}.n${n}`, params);
}

/* ── Facts ── */

const CLAIM_REASONS = [
  "FRAUDULENT",
  "UNRECOGNIZED",
  "PRODUCT_NOT_RECEIVED",
  "PRODUCT_UNACCEPTABLE",
  "SUBSCRIPTION_CANCELLED",
  "DUPLICATE",
  "CREDIT_NOT_PROCESSED",
];
function claimKey(reason: string | null): string {
  const k = (reason ?? "").toUpperCase();
  return CLAIM_REASONS.includes(k) ? k : "GENERAL";
}

/** The two chargeback amounts Shopify's own order timeline may state. */
function timelineChargebackTotal(events: RecordInputs["timelineEvents"], currency: string): number | null {
  // Shopify writes "totaling $225.00." for a single-currency chargeback and
  // "totaling $112.67 CAD + $15.00 USD" when fees are added in another
  // currency. A bare amount is read in the dispute's own currency.
  const re = /opened a chargeback totaling \$?([\d,]+(?:\.\d+)?)(?:\s*([A-Z]{3}))?/i;
  for (const e of events) {
    const m = typeof e.text === "string" ? re.exec(e.text) : null;
    if (!m) continue;
    if (m[2] && m[2].toUpperCase() !== currency.toUpperCase()) continue;
    const n = Number.parseFloat(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** What the customer paid, in the dispute's currency. */
function paymentInCurrency(facts: Record<string, Record<string, unknown>>, currency: string): number | null {
  const totals = rec(facts.order_confirmation?.totals);
  if (!totals) return null;
  const presentment = rec(totals.presentment);
  if (presentment && str(presentment.currency)?.toUpperCase() === currency.toUpperCase()) {
    const n = num(presentment.total);
    if (n !== null) return n;
  }
  if (str(totals.currency)?.toUpperCase() === currency.toUpperCase()) return num(totals.total);
  return null;
}

/* ── Build ── */

const PREPARED_STAGES: readonly RecordStage[] = ["prepared", "prepared_review", "held", "needs_attention", "fatal"];

export function buildDisputeRecord(i: RecordInputs, fmt: RecordFormat): DisputeRecord {
  const v = i.view;
  const facts = v.facts;
  const status = i.status;
  const stage = i.stage;
  const decided = status !== "open";
  const family = resolveReasonFamily(v.reason);
  const fraud = family === "fraud";
  const lineBy = new Map(i.lines.map((l) => [l.field, l]));
  const line = (f: string) => lineBy.get(f);
  const items = buildItems({
    i,
    facts,
    fmt,
    line,
    lineRole: (f) => roleFromLine(i, line(f), f),
    fraud,
  });
  const item = (k: ItemKey) => items.find((x) => x.key === k);

  const counts: Record<RecordRole, number> = { cited: 0, context: 0, internal: 0, unavailable: 0 };
  if (i.hasPackage) for (const it of items) counts[it.role] += 1;

  const f: Partial<Record<FactKey, I18nToken>> = {};
  const date = (iso: string | null | undefined) => (iso ? fmt.date(iso) : null);
  const dueDay = date(v.dueAt);

  f.claim = tk(`claim.${claimKey(v.reason)}`);
  if (i.hasPackage) {
    f.roles = tk(decided ? "roles.decided" : "roles.open", {
      cited: counts.cited,
      context: counts.context,
      internal: counts.internal,
      unavailable: counts.unavailable,
    });
  }
  if (i.reopenedAt) f.reopened = tk("reopened", { date: fmt.date(i.reopenedAt) });
  if (i.escalatedAt) f.escalated = tk("escalated", { date: fmt.date(i.escalatedAt) });
  if (!decided && dueDay) f.due = tk("due", { date: dueDay });

  const phase = v.phase;
  const version = i.pkg.version;

  /** The "DisputeDesk saved defence package ... to Shopify" sentence. */
  const savedToken = (atIso: string): I18nToken => {
    const d = fmt.date(atIso);
    const atDeadline = dueDay !== null && dueDay === d;
    return version
      ? tk(atDeadline ? "filed.versionDeadline" : "filed.version", { version, date: d })
      : tk(atDeadline ? "filed.plainDeadline" : "filed.plain", { date: d });
  };

  if (!decided) {
    const preparedAt = i.pkg.preparedAt;
    if (PREPARED_STAGES.includes(stage) && preparedAt) {
      f.prepared = version
        ? tk("prepared.version", { version, date: fmt.date(preparedAt) })
        : tk("prepared.plain", { date: fmt.date(preparedAt) });
    }
    if (stage === "no_pack") f.state = tk("state.noPack");
    if (stage === "building") f.state = tk("state.building");
    if (stage === "failed") f.state = tk("state.failed");

    if (stage === "prepared" && i.automationMode === "auto" && dueDay) f.autopilot = tk("autopilot", { date: dueDay });
    if ((stage === "prepared" || stage === "prepared_review" || stage === "held") && i.decision === "conceded") {
      f.reviewMode = tk("reviewMode.conceded");
      delete f.autopilot;
    } else if (stage === "prepared_review") {
      f.reviewMode =
        i.decision === "approved" && dueDay ? tk("reviewMode.approved", { date: dueDay }) : tk("reviewMode.waiting");
    }
    if (stage === "held" && i.decision !== "conceded" && dueDay) f.held = tk("held", { date: dueDay });
    if (stage === "needs_attention") {
      f.attention = i.attentionKey
        ? tk("attention.reason", { reason: { type: "i18n-key", key: i.attentionKey } })
        : tk("attention.plain");
    }
    if (stage === "covered") f.covered = tk("covered");
    if (stage === "fatal") {
      f.fatal = tk(i.fatalReason === "refund_issued" ? "fatal.refund" : "fatal.notFulfilled");
    }
    if ((stage === "saved" || stage === "under_review") && i.savedAt) f.saved = savedToken(i.savedAt);
    if (stage === "under_review") f.underReview = tk("underReview");

    /* strength (only while a package is prepared and not yet saved) */
    const band = i.strength === "strong" || i.strength === "moderate" || i.strength === "weak" ? i.strength : null;
    if (band && PREPARED_STAGES.includes(stage) && stage !== "fatal") {
      const clauses: I18nKeyParam[] = [];
      const pay = item("pay");
      if (pay && !pay.adverse && pay.detail.key === `${NS}.item.pay.both`) clauses.push(nest("strength.reason.pay"));
      const dl = deliveryParts(facts);
      if (dl?.confirmed && dl.deliveredAt) {
        clauses.push(
          dl.carrier
            ? nest("strength.reason.delivery", { carrier: dl.carrier, date: fmt.date(dl.deliveredAt) })
            : nest("strength.reason.deliveryNoCarrier", { date: fmt.date(dl.deliveredAt) }),
        );
      }
      if (clauses.length === 0) f.strength = tk(`strength.plain.${band}`);
      else {
        const reasons =
          clauses.length === 1 ? clauses[0] : nest("strength.reasons.two", { a: clauses[0], b: clauses[1] });
        f.strength = tk(`strength.withReasons.${band}`, { reasons });
      }
    }

    /* the one thing to do, if there is one */
    if (PREPARED_STAGES.includes(stage) && stage !== "fatal") {
      if (stage === "prepared_review" && i.decision === null) f.action = tk("action.review");
      else if (i.offerAck) f.action = tk("action.ack");
      else if (stage === "needs_attention") f.action = tk("action.evidence");
      else f.action = tk("action.none");
    }
  } else {
    /* filed */
    const filedAt = i.pkg.filedAt;
    if (i.responder === "we") {
      if (filedAt) f.filed = savedToken(filedAt);
    } else if (i.responder === "shopify") {
      f.filed = i.sentAt ? tk("filed.shopify", { date: fmt.date(i.sentAt) }) : tk("filed.shopifyNoDate");
    } else if (i.responder === "before_install" || i.responder === "sent_before_install") {
      f.filed = tk("filed.beforeInstall");
    } else if (i.responder === "none") {
      f.filed = tk("filed.none");
    }

    if (i.hasPackage) {
      // Sentence order is the order a person would say them in, not the row order.
      const byPhrase = (order: ItemKey[]) => (a: RecordItem, b: RecordItem) => order.indexOf(a.key) - order.indexOf(b.key);
      const citedPhrases = items
        .filter((x) => x.role === "cited" && x.phrase)
        .sort(byPhrase(["pay", "screen", "delivery", "ip", "return"]))
        .map((x) => x.phrase as I18nKeyParam);
      const citedList = listToken("cited", citedPhrases);
      f.cited = citedList ? tk("cited.sentence", { list: nestFrom(citedList) }) : tk("cited.none");

      const adversePhrases = items
        .filter((x) => x.role === "internal" && x.adverse && x.phrase)
        .sort(byPhrase(["pay", "name", "signature", "screen", "ip", "addr", "return"]))
        .map((x) => x.phrase as I18nKeyParam);
      const withheldList = listToken("withheld", adversePhrases);
      if (withheldList) f.withheld = tk("withheld.sentence", { list: nestFrom(withheldList) });
    }

    if (v.closedAt) {
      const d = fmt.date(v.closedAt);
      if (status === "closed") {
        f.outcome = tk("outcome.closed", { date: d });
      } else {
        const money = v.amount > 0 ? fmt.money(v.amount, v.currency) : null;
        const base = `outcome.${status}.${phase}`;
        f.outcome = money ? tk(base, { date: d, amount: money }) : tk(`${base}NoAmount`, { date: d });
      }
    }
  }

  /* amounts */
  {
    const chargeback = timelineChargebackTotal(i.timelineEvents, v.currency);
    const paid = paymentInCurrency(facts, v.currency);
    const differs = (a: number, b: number) => Math.abs(a - b) >= 0.005;
    if (chargeback !== null && differs(chargeback, v.amount)) {
      f.amounts = tk("amounts.timeline", {
        listed: fmt.money(chargeback, v.currency),
        disputed: fmt.money(v.amount, v.currency),
      });
    } else if (paid !== null && differs(paid, v.amount)) {
      f.amounts = tk("amounts.payment", {
        paid: fmt.money(paid, v.currency),
        disputed: fmt.money(v.amount, v.currency),
      });
    }
  }

  /* The account: fact keys in reading order. */
  const ACCOUNT: Record<RecordStage, FactKey[]> = {
    no_pack: ["state"],
    building: ["state"],
    failed: ["state"],
    prepared: ["prepared", "autopilot", "reviewMode", "strength", "roles", "action"],
    prepared_review: ["prepared", "reviewMode", "strength", "roles", "action"],
    held: ["prepared", "reviewMode", "held", "strength", "roles", "action"],
    needs_attention: ["prepared", "attention", "strength", "roles", "action"],
    covered: ["covered"],
    fatal: ["prepared", "fatal", "roles"],
    saved: ["saved", "roles"],
    under_review: ["saved", "underReview", "roles"],
    decided: ["filed", "cited", "withheld", "outcome"],
  };
  const account: FactKey[] = (["claim", "reopened", "escalated", ...ACCOUNT[stage]] as FactKey[]).filter((k) => f[k]);

  /* The record list (Overview): evidence facts, not documents or gaps. */
  const RECORD_KEYS: ItemKey[] = ["pay", "name", "screen", "ip", "delivery", "signature", "return"];
  const recordRows: DisputeRecord["recordRows"] = items.filter((x) => RECORD_KEYS.includes(x.key)).map((x) => x.key);
  if (f.amounts) recordRows.push("amounts");

  /* Checklist: one rule, shared with the decided view. */
  const rows = buildChecklistRows(v);
  const checklistRows: ChecklistRow[] = rows.map((r) => {
    const id = r.item.key.split(".").pop() as string;
    const sub = id === "addressMatch" ? item("pay")?.detail ?? null : id === "threeDs" ? item("tds")?.detail ?? null : null;
    return { id, item: r.item, state: r.state, label: checklistLabel(id, r.state, decided, r.label), sub };
  });
  const had = checklistRows.filter((r) => r.state === "had").length;
  const total = checklistRows.length;
  const odds = storeRateToken(v);
  const note =
    status === "won" && total > 0 && had === 0 && f.cited && citedListOf(f.cited)
      ? tk("checklist.noteWonNone", { total, list: citedListOf(f.cited) as I18nKeyParam })
      : null;

  /* Help */
  let help: DisputeRecord["help"] = null;
  if (!decided) {
    if (i.offerAck && stage !== "covered" && stage !== "saved" && stage !== "under_review") {
      help = {
        title: tk("help.openTitle"),
        items: [
          {
            title: tk("help.ack.title"),
            detail: tk("help.ack.detail"),
            action: { kind: "ack", label: tk("help.ack.action") },
          },
        ],
      };
    }
  } else if (status === "lost") {
    const view = buildDecidedView(v, { date: fmt.date, short: fmt.date, money: fmt.money });
    const list: HelpItem[] = view.nextTime.map((n) => {
      const isHold = n.title.key.endsWith("next.holdHighRisk.title");
      let detail: I18nToken | null = n.detail;
      if (isHold) {
        const verdict = (str(facts.fraud_risk_screening?.recommendation) ?? str(v.order?.riskRecommendation) ?? "").toUpperCase();
        const first = nest(verdict === "INVESTIGATE" ? "help.hold.investigate" : "help.hold.cancel");
        detail = n.stat ? tk("help.joinStat", { detail: first, stat: asParam(n.stat) }) : tk("help.hold.only", { first });
      } else if (n.detail && n.stat) {
        detail = tk("help.joinStat", { detail: asParam(n.detail), stat: asParam(n.stat) });
      }
      return { title: n.title, detail: detail ?? tk("help.noDetail"), action: null };
    });
    if (list.length > 0) help = { title: tk("help.nextTime"), items: list };
  }

  /* Timeline: built from the same facts the account reads. */
  const timeline: TimelineStep[] = [];
  const order = facts.order_confirmation;
  const placedAt = str(order?.createdAt) ?? v.order?.createdAt ?? null;
  const dl = deliveryParts(facts);
  if (placedAt) {
    const paidIn = paymentInCurrency(facts, v.currency);
    const paid = paidIn ?? num(rec(order?.totals)?.total);
    const cur = (paidIn !== null ? v.currency : str(rec(order?.totals)?.currency)) ?? v.currency;
    const financial = (str(order?.financialStatus) ?? "").toUpperCase();
    const isPaid = financial === "PAID" || financial === "PARTIALLY_REFUNDED" || financial === "REFUNDED" || financial === "PARTIALLY_PAID";
    let text: I18nToken;
    if (isPaid && paid !== null && i.cardNetwork && i.cardLast4) {
      text = tk("timeline.placed.card", { amount: fmt.money(paid, cur), network: i.cardNetwork, last4: i.cardLast4 });
    } else if (isPaid && paid !== null) {
      text = tk("timeline.placed.paid", { amount: fmt.money(paid, cur) });
    } else if (paid !== null) {
      text = tk("timeline.placed.total", { amount: fmt.money(paid, cur) });
    } else {
      text = tk("timeline.placed.plain");
    }
    timeline.push({ at: placedAt, title: tk(isPaid ? "timeline.t.placedPaid" : "timeline.t.placed"), text, kind: "done" });
  }
  if (dl?.shippedAt) {
    const p: I18nToken["params"] = {};
    if (dl.carrier) p.carrier = dl.carrier;
    if (dl.number) p.number = dl.number;
    const variant = dl.carrier ? (dl.number ? "full" : "carrier") : dl.number ? "number" : "plain";
    timeline.push({ at: dl.shippedAt, title: tk("timeline.t.shipped"), text: tk(`timeline.shipped.${variant}`, p), kind: "done" });
  }
  const deliveryItem = item("delivery");
  if (dl?.confirmed && dl.deliveredAt && deliveryItem) {
    timeline.push({ at: dl.deliveredAt, title: tk("timeline.t.delivered"), text: deliveryItem.detail, kind: "done" });
  }
  if (v.openedAt) timeline.push({ at: v.openedAt, title: tk("timeline.t.opened"), text: f.claim, kind: "done" });
  if (i.escalatedAt && f.escalated) timeline.push({ at: i.escalatedAt, title: tk("timeline.t.escalated"), text: f.escalated, kind: "done" });
  if (i.reopenedAt && f.reopened) timeline.push({ at: i.reopenedAt, title: tk("timeline.t.reopened"), text: f.reopened, kind: "done" });
  if (!decided) {
    const preparedText = f.prepared ?? f.state ?? f.covered;
    if (preparedText && (i.pkg.preparedAt || stage === "no_pack" || stage === "building" || stage === "failed" || stage === "covered")) {
      const at = i.pkg.preparedAt ?? v.openedAt;
      if (at) {
        timeline.push({
          at,
          title: tk(f.prepared ? "timeline.t.prepared" : "timeline.t.package"),
          text: preparedText,
          kind: "current",
        });
      }
    }
    if ((stage === "saved" || stage === "under_review") && i.savedAt && f.saved) {
      timeline.push({ at: i.savedAt, title: tk("timeline.t.filed"), text: f.saved, kind: "filed" });
    }
    if (v.dueAt && stage !== "saved" && stage !== "under_review") {
      const text = f.autopilot ?? f.reviewMode ?? f.held ?? f.due;
      if (text) timeline.push({ at: v.dueAt, title: tk("timeline.t.deadline"), text, kind: "pending" });
    }
  } else {
    if (f.filed && (i.pkg.filedAt || i.sentAt)) {
      timeline.push({
        at: (i.responder === "we" ? i.pkg.filedAt : i.sentAt ?? i.pkg.filedAt) as string,
        title: tk(i.responder === "we" ? "timeline.t.filed" : "timeline.t.response"),
        text: f.filed,
        kind: "filed",
      });
    }
    if (v.closedAt && f.outcome) {
      timeline.push({
        at: v.closedAt,
        title: tk("timeline.t.decided"),
        text: f.outcome,
        kind: status === "lost" ? "lost" : status === "won" ? "won" : "done",
      });
    }
  }
  timeline.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const daysLeft = !decided && v.dueAt && stage !== "saved" && stage !== "under_review" ? utcDaysUntil(v.dueAt, i.now) : null;

  const headlineKey = decided ? status : stage;
  const pkgLines: FactKey[] = (
    decided
      ? ["filed", "outcome"]
      : stage === "prepared"
        ? ["prepared", "autopilot"]
        : stage === "prepared_review"
          ? ["prepared", "reviewMode"]
          : stage === "held"
            ? ["prepared", "held"]
            : stage === "needs_attention"
              ? ["prepared", "attention"]
              : stage === "fatal"
                ? ["prepared", "fatal"]
                : stage === "saved"
                  ? ["saved"]
                  : stage === "under_review"
                    ? ["saved", "underReview"]
                    : stage === "covered"
                      ? ["covered"]
                      : ["state"]
  ) as FactKey[];

  return {
    status,
    stage,
    showRoles: i.hasPackage,
    phase,
    header: {
      orderName: i.orderName,
      amount: fmt.money(v.amount, v.currency),
      customer: i.customerName,
      opened: date(v.openedAt),
      deadline: !decided ? date(v.dueAt) : null,
      daysLeft: daysLeft !== null && daysLeft >= 0 ? daysLeft : null,
      decided: decided ? date(v.closedAt) : null,
    },
    hero: {
      headline: tk(`headline.${headlineKey}`),
      claimShort: tk(`claimShort.${claimKey(v.reason)}`),
      amountLabel: tk(`amountLabel.${status}`),
      statusChip: stage === "building" && i.packPrepared ? ({ key: "presentation.lifecycle.pack_prepared" } as I18nToken) : tk(`chip.${headlineKey}`),
      strengthBand:
        (i.strength === "strong" || i.strength === "moderate" || i.strength === "weak") &&
        PREPARED_STAGES.includes(stage) &&
        stage !== "fatal"
          ? i.strength
          : null,
    },
    facts: f,
    account,
    counts,
    items,
    recordRows,
    checklist: { rows: checklistRows, had, total, odds, note },
    help,
    timelineTitle: tk(decided ? "timeline.titleDecided" : "timeline.titleOpen"),
    timeline,
    pkg: { lines: pkgLines.filter((k) => f[k]) },
    canDecide: i.canDecide,
    decision: i.decision,
  };
}

/* ── small helpers ── */

/** A token used as a nested parameter of another token. */
function asParam(t: I18nToken): I18nKeyParam {
  const params: Record<string, string | number> = {};
  for (const [k, p] of Object.entries(t.params ?? {})) {
    if (typeof p === "string" || typeof p === "number") params[k] = p;
  }
  return { type: "i18n-key", key: t.key, ...(Object.keys(params).length > 0 ? { params } : {}) };
}
function nestFrom(t: I18nToken): I18nKeyParam {
  return { type: "i18n-key", key: t.key, ...(t.params ? { params: t.params as I18nKeyParam["params"] } : {}) };
}
function citedListOf(sentence: I18nToken): I18nKeyParam | null {
  const l = sentence.params?.list;
  return l && typeof l === "object" ? (l as I18nKeyParam) : null;
}

/** The right-hand pill of a checklist row. The design words the same state
 *  differently on an open dispute ("Not on record") and a decided one ("None"). */
function checklistLabel(id: string, state: ChecklistState, decided: boolean, existing: I18nToken): I18nToken {
  if (!["deliveryToBilling", "priorOrders", "threeDs"].includes(id)) return existing;
  if (state === "had") return tk("checklist.state.had");
  if (id === "threeDs") return tk("checklist.state.notAvailable");
  if (id === "priorOrders") return tk(decided ? "checklist.state.none" : "checklist.state.notOnRecord");
  if (id === "deliveryToBilling" && !decided) return tk("checklist.state.notConfirmed");
  return tk(state === "missing" ? "checklist.state.missing" : "checklist.state.none");
}
