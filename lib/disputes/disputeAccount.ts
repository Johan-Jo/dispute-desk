/**
 * The dispute account: ONE record of facts per dispute, and the ordered
 * account every tab opens with.
 *
 * Spec: Claude Design project fca59ec9… ("Return Record Banner Design"),
 * `DecidedWorkspaceMock.dc.html` — `CASES[x].F` is the record, `account` is
 * the order, `use(key, where)` is the consistency guarantee. This module is the
 * transcription of that data model:
 *
 *   - `buildDisputeAccount` derives the record `facts` (one `I18nToken` per
 *     fact key) from what Shopify and DisputeDesk recorded, and the ordered
 *     `sequence` the hero paragraph joins.
 *   - `createFactReader` is the design's `use(key, where)`. Every surface
 *     (hero, "What we saw", checklist pill, timeline step, evidence row,
 *     missing row, pack line) takes its sentence from the reader, never from
 *     its own copy, and the reader keeps the list of where each fact appears.
 *     The consistency table is generated from that list.
 *
 * Merchant-side only, read-time only. Nothing here writes to `pack_json`, and
 * nothing here is bank-facing (the letter, the PDF, the chronology and the
 * checklist hashes do not read it). No English: every sentence is an
 * `I18nToken` (CLAUDE.md rule 5); dates and money arrive pre-formatted from the
 * caller's locale through `AccountFormat`.
 *
 * Fails closed: an unknown return status is never a confirmed return; an
 * unknown refund state says nothing; "DisputeDesk filed nothing" is said only
 * when the filing record shows nothing filed by DisputeDesk; the bank's
 * reasoning is never claimed (the only reason statement is "no reason was
 * given"). `recorded_no_amount` never reads pending/started/failed/issued/
 * successful. No return text at all when no return is on record.
 */

import type { I18nToken } from "@/lib/i18n/token";
import { hasReturnOnRecord, type OrderSituation, type ReturnSituation } from "@/lib/disputes/orderSituation";
import type { RefundKind, RefundStatement } from "@/lib/disputes/refundStatement";
import type { DecidedResponder } from "@/lib/disputes/decidedResponse";

const NS = "disputes.account";
const tk = (key: string, params?: I18nToken["params"]): I18nToken => ({
  key: `${NS}.${key}`,
  ...(params ? { params } : {}),
});
/** Refund sentences live with the one refund contract (lib/disputes/refundStatement.ts). */
const rtk = (key: string, params?: I18nToken["params"]): I18nToken => ({
  key: `disputes.refundStatement.${key}`,
  ...(params ? { params } : {}),
});

export type FactKey =
  | "claim"
  | "ret"
  | "refund"
  | "match"
  | "filed"
  | "delivery"
  | "outcome"
  | "noReason"
  | "order"
  | "tracking"
  | "opened"
  | "due"
  | "pack";

export type AccountLifecycle = "won" | "lost" | "open";

export interface AccountFormat {
  /** Full date in the viewer's locale ("4 Nov 2026"). */
  date: (iso: string) => string;
  money: (amount: number, currency: string) => string;
}

export interface AccountInputs {
  reason: string | null;
  lifecycle: AccountLifecycle;
  /** Open disputes only: the presentation lifecycle, for the hero title. */
  openStage?: "response_needed" | "saved_to_shopify" | "under_review";
  /** Amount recovered / lost (decided) or in dispute (open). */
  amount: number;
  currency: string;
  openedAt: string | null;
  dueAt: string | null;
  closedAt: string | null;
  /** Decided only. Null = not read (the account then makes no filing claim). */
  responder: DecidedResponder | null;
  filedAt: string | null;
  sentAt: string | null;
  /** What Shopify records about the return, with the pack's `asOf`. */
  situation: (OrderSituation & { asOf: string | null }) | null;
  /** The one refund statement. */
  refund: RefundStatement | null;
  /** The carrier confirmed delivery (a delivery-confirmed proof is on record). */
  deliveryConfirmed: boolean;
  order: { total: number | null; currency: string | null; card: boolean } | null;
  /** The evidence pack. Null = not read. */
  pack: {
    built: boolean;
    /** When the pack's evidence was saved to Shopify, if it was. */
    savedAt: string | null;
    forwarded: boolean;
    /** Shipping tracking / delivery proof is among the pack's evidence. */
    hasTracking: boolean | null;
  } | null;
}

export interface DisputeAccount {
  lifecycle: AccountLifecycle;
  openStage: NonNullable<AccountInputs["openStage"]>;
  facts: Partial<Record<FactKey, I18nToken>>;
  /** The account: fact keys in the order the paragraph reads them. */
  sequence: FactKey[];
  /** Said true only when the filing record shows DisputeDesk filed nothing. */
  filedNothing: boolean;
  returns: ReturnSituation;
  refundKind: RefundKind | null;
  /** When the pack's order record was collected (ISO), or null. */
  asOf: string | null;
  /** Hero: the open-case chip / decided chip are resolved in the page model. */
  inputs: AccountInputs;
}

/* ── Sentence builders ── */

const CLAIM_KEYS = [
  "FRAUDULENT",
  "UNRECOGNIZED",
  "PRODUCT_NOT_RECEIVED",
  "PRODUCT_UNACCEPTABLE",
  "SUBSCRIPTION_CANCELLED",
  "DUPLICATE",
  "CREDIT_NOT_PROCESSED",
];

/** The customer's claim. Reuses the decided view's existing claim sentences
 *  (`summary.claim.*`), which already read as the design's `CNP_CLAIM`. */
function claimFact(reason: string | null): I18nToken {
  const key = (reason ?? "").toUpperCase();
  return { key: `disputes.decidedView.summary.claim.${CLAIM_KEYS.includes(key) ? key : "GENERAL"}` };
}

const RET_KEY: Partial<Record<ReturnSituation, string>> = {
  returned: "ret.returned",
  in_progress: "ret.inProgress",
  requested: "ret.requested",
  failed: "ret.failed",
};

function retFact(s: AccountInputs["situation"], fmt: AccountFormat): I18nToken | null {
  if (!s || !hasReturnOnRecord(s)) return null; // none/unknown: no return text at all
  const base = RET_KEY[s.returns];
  if (!base) return null;
  return s.returnOpenedAt
    ? tk(`${base}Dated`, { date: fmt.date(s.returnOpenedAt) })
    : tk(base);
}

function refundFact(i: AccountInputs, fmt: AccountFormat): I18nToken | null {
  const r = i.refund;
  if (!r || r.kind === "unknown") return null; // fail closed: say nothing
  if (r.kind === "none") {
    return rtk("account.none", { total: fmt.money(0, r.zeroCurrency ?? i.currency) });
  }
  if (r.kind === "some") {
    const n = Number.parseFloat(r.amount ?? "");
    const total = fmt.money(Number.isFinite(n) ? n : 0, r.currency ?? i.currency);
    return r.refundedAt
      ? rtk("account.someDated", { total, date: fmt.date(r.refundedAt) })
      : rtk("account.some", { total });
  }
  // recorded_no_amount
  const total = fmt.money(0, r.zeroCurrency ?? i.currency);
  const count = r.entryCount ?? 1;
  if (r.entryAt && count === 1) {
    const date = fmt.date(r.entryAt);
    const opened = i.openedAt;
    const before =
      opened !== null &&
      Date.parse(r.entryAt) < Date.parse(opened) &&
      fmt.date(opened) !== date;
    return rtk(before ? "account.entryBefore" : "account.entryDated", { date, total });
  }
  return rtk("account.entry", { count, total });
}

/** Records the claim can be compared with: the return sentence and the refund
 *  sentence, whichever the account actually carries. */
function matchFact(i: AccountInputs, hasRet: boolean, hasRefund: boolean): I18nToken | null {
  if (resolveFamily(i.reason) !== "CREDIT_NOT_PROCESSED") return null;
  const k = i.refund?.kind;
  // Matches only when there is something on record (a return, or a refund
  // entry) AND no confirmed refund amount. A confirmed amount contradicts the
  // claim; nothing on record cannot match it.
  const noConfirmedAmount = k === "none" || k === "recorded_no_amount";
  const somethingOnRecord = hasRet || k === "recorded_no_amount";
  if (!noConfirmedAmount || !somethingOnRecord) return null;
  return tk(hasRet && hasRefund ? "match.many" : "match.one");
}

function resolveFamily(reason: string | null): string {
  return (reason ?? "").toUpperCase();
}

function sameDay(a: string | null, b: string | null, fmt: AccountFormat): boolean {
  return a !== null && b !== null && fmt.date(a) === fmt.date(b);
}

function filedFact(i: AccountInputs, fmt: AccountFormat): { token: I18nToken | null; nothing: boolean } {
  switch (i.responder) {
    case "we":
      return {
        token: i.filedAt ? tk("filed.we", { date: fmt.date(i.filedAt) }) : tk("filed.weNoDate"),
        nothing: false,
      };
    case "none":
      return { token: tk("filed.none"), nothing: true };
    case "shopify":
      return {
        token: i.sentAt ? tk("filed.shopify", { date: fmt.date(i.sentAt) }) : tk("filed.shopifyNoDate"),
        nothing: true,
      };
    case "before_install":
    case "sent_before_install":
      return { token: tk("filed.beforeInstall"), nothing: true };
    default:
      return { token: null, nothing: false };
  }
}

function outcomeFact(i: AccountInputs, fmt: AccountFormat): I18nToken | null {
  if (i.lifecycle === "open" || !i.closedAt) return null;
  const won = i.lifecycle === "won";
  const date = fmt.date(i.closedAt);
  const same = sameDay(i.openedAt, i.closedAt, fmt);
  const hasAmount = Number.isFinite(i.amount) && i.amount > 0;
  const money = fmt.money(i.amount, i.currency);
  const variant = `${won ? "won" : "lost"}${same ? "SameDay" : ""}${hasAmount ? "" : "NoAmount"}`;
  return tk(`outcome.${variant}`, hasAmount ? { date, amount: money } : { date });
}

function packFact(i: AccountInputs, fmt: AccountFormat): I18nToken | null {
  const p = i.pack;
  if (!p) return null;
  if (p.forwarded) return tk("pack.forwarded");
  if (p.savedAt) return tk("pack.saved", { date: fmt.date(p.savedAt) });
  if (p.built) return tk("pack.built");
  return tk("pack.none");
}

/* ── The record ── */

export function buildDisputeAccount(i: AccountInputs, fmt: AccountFormat): DisputeAccount {
  const facts: Partial<Record<FactKey, I18nToken>> = {};
  const put = (k: FactKey, t: I18nToken | null) => {
    if (t) facts[k] = t;
  };

  put("claim", claimFact(i.reason));
  const ret = retFact(i.situation, fmt);
  put("ret", ret);
  const refund = refundFact(i, fmt);
  put("refund", refund);
  put("match", matchFact(i, ret !== null, refund !== null));

  let filedNothing = false;
  if (i.lifecycle !== "open") {
    const f = filedFact(i, fmt);
    put("filed", f.token);
    filedNothing = f.nothing;
    if (i.deliveryConfirmed) put("delivery", tk("delivery.confirmed"));
    put("outcome", outcomeFact(i, fmt));
    // The only reason statement. The issuer's reasoning is never exposed to us.
    if (facts.outcome) put("noReason", tk("noReason"));
    if (i.order && i.order.total !== null) {
      const total = fmt.money(i.order.total, i.order.currency ?? i.currency);
      put("order", i.order.card ? tk("order.card", { total }) : tk("order.total", { total }));
    }
    if (i.pack?.built && i.pack.hasTracking === false) put("tracking", tk("tracking.missing"));
  } else {
    if (i.openedAt) put("opened", tk("opened", { date: fmt.date(i.openedAt) }));
    if (i.dueAt) put("due", tk("due", { date: fmt.date(i.dueAt) }));
    put("pack", packFact(i, fmt));
  }

  const sequence: FactKey[] = (
    i.lifecycle === "open"
      ? ["claim", "ret", "refund", "match", "opened", "due", "pack"]
      : ["claim", "ret", "refund", "match", "filed", "delivery", "outcome", "noReason"]
  ).filter((k) => facts[k as FactKey]) as FactKey[];

  return {
    lifecycle: i.lifecycle,
    openStage: i.openStage ?? "response_needed",
    facts,
    sequence,
    filedNothing,
    returns: i.situation?.returns ?? "unknown",
    refundKind: i.refund?.kind ?? null,
    asOf: i.situation?.asOf ?? i.refund?.asOf ?? null,
    inputs: i,
  };
}

/* ── The design's use(key, where) ── */

export interface FactReader {
  /** The token for `key`, recording where it is used. Null when the record has no such fact. */
  use: (key: FactKey, where: string) => I18nToken | null;
  /** Where each fact is used, in first-use order. */
  uses: () => Array<{ key: FactKey; where: string[]; token: I18nToken }>;
}

export function createFactReader(account: DisputeAccount): FactReader {
  const where = new Map<FactKey, string[]>();
  return {
    use(key, at) {
      const t = account.facts[key];
      if (!t) return null;
      const list = where.get(key) ?? [];
      if (!list.includes(at)) list.push(at);
      where.set(key, list);
      return t;
    },
    uses() {
      return [...where.entries()].map(([key, w]) => ({ key, where: w, token: account.facts[key] as I18nToken }));
    },
  };
}
