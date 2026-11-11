/**
 * The dispute page's status block: ONE function that turns what the record
 * already knows into the action-first text at the top of the page.
 *
 * Spec: docs/plans/dispute-status-copy.plan.md section 10 (maintainer
 * direction, 2026-11-10). A headline that is the one thing to do (or starts
 * with "Nothing to do."), a sub-line, and labelled parts - What happened, What
 * we need from you, What happens next, Done so far. A part with nothing true
 * to say is OMITTED, never padded.
 *
 * PURE and TOKEN-ONLY (CLAUDE.md rule 5): no English, no DB, no I/O. It reads
 * no pack, audit row, status string or date to DECIDE anything the owners
 * already decided - the caller passes the owners' answers (`asks` from the
 * merchant-asks registry, `lifecycle` from `resolveLifecycle`, `build` from
 * `resolveBuildAttempt`, `save` from `resolveSaveAttempt`) and the facts the
 * record already built (`claim`, `caseFact`, `citedList`). The component only
 * renders.
 *
 * TRUTH RULE. Every "what happens next" sentence below is backed by a code
 * path (listed in the PR that introduced this file) and is worded the way
 * `deadlineOnlyCopy.ts` words it: scheduled, never promised; Shopify's own
 * process is named without a date; nobody is told that silence is a result.
 */

import type { I18nKeyParam, I18nToken } from "@/lib/i18n/token";
import type { Ask, AskId } from "@/lib/disputes/merchantAsks";
import type { OperationalLifecycle } from "./types";
import type { BuildAttemptState } from "./resolveBuildAttempt";
import type { SaveAttemptState } from "./resolveSaveAttempt";

const NS = "disputes.record.status";
const s = (key: string, params?: I18nToken["params"]): I18nToken => ({
  key: `${NS}.${key}`,
  ...(params ? { params } : {}),
});
const nest = (key: string): I18nKeyParam => ({ type: "i18n-key", key: `${NS}.${key}` });

/* ── Output ── */

export type StatusState =
  | "ask"
  | "approval"
  | "scheduled"
  | "conceded"
  | "filing"
  | "filed"
  | "sent_by_shopify"
  | "unconfirmed"
  | "save_failed"
  | "build_failed"
  | "build_paused"
  | "nothing_to_argue"
  | "covered"
  | "plan_limit"
  | "preparing"
  | "attention"
  | "won"
  | "lost"
  | "closed";

/** What a button in the block does. The component maps each id to behaviour; this module only names it. */
export type StatusActionId =
  | "ask:return_request"
  | "ask:bank_claim"
  | "decide:approved"
  | "decide:conceded"
  | "tab:evidence"
  | "ack"
  | "plans";

export interface StatusAction {
  id: StatusActionId;
  label: I18nToken;
  /** A short note beside the button ("Takes under a minute"). */
  meta?: I18nToken;
}

export type StatusPartKind = "happened" | "need" | "can" | "optional" | "next" | "done";

export interface StatusPart {
  kind: StatusPartKind;
  label: I18nToken;
  lines: I18nToken[];
  actions: StatusAction[];
}

export interface StatusCopy {
  state: StatusState;
  headline: I18nToken;
  /** The header chip: one short label per state, from the same state as the headline. */
  chip: I18nToken;
  subline: I18nToken;
  parts: StatusPart[];
}

/* ── Input ── */

export interface StatusCopyInput {
  status: "open" | "won" | "lost" | "closed";
  /** The record stage (`lib/disputes/workspacePayload/recordStage.ts`). */
  stage:
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
  phase: "inquiry" | "chargeback";
  /** Pre-formatted disputed amount (`RecordFormat.money`), and whether it is a real amount. */
  amount: string;
  hasAmount: boolean;
  /** Pre-formatted Shopify deadline; null when there is none. */
  dueDay: string | null;
  /** The deadline falls on today (UTC), from `utcDaysUntil`. */
  deadlineToday: boolean;
  /** Pre-formatted decision date (decided disputes). */
  decidedDay: string | null;
  /** `presentation.lifecycle`; null when the payload predates it. */
  lifecycle: OperationalLifecycle | null;
  /** `resolveSaveAttempt` over the pack status and submission state. */
  save: SaveAttemptState;
  submissionState: string | null;
  automationMode: "auto" | "review" | null;
  decision: "approved" | "conceded" | "in_review" | null;
  /** `resolveBuildAttempt` over the latest defence package row; null = no package read. */
  build: { state: BuildAttemptState; cause: string | null; packageWritten: boolean } | null;
  /** `presentation.blockingReason`. */
  blockingReason: string | null;
  fatalReason: "refund_issued" | "inr_no_fulfillment" | string | null;
  /** The merchant asks registry, in rank order. */
  asks: ReadonlyArray<Ask>;
  /** The cardholder acknowledgement fits this case (not a returned / never-delivered parcel). */
  ackFits: boolean;
  /** A carrier returned the parcel to the merchant (the returned-to-sender gate fired). */
  returnedToSender: boolean;
  /** An order refund / return is on the record (names the true reason nothing is argued). */
  recordSituation: "return" | "refund" | null;
  claim: I18nToken;
  /** The ONE fact that decides the case, when there is one (record tokens). */
  caseFact: I18nToken | null;
  /** The named evidence the package relies on ("the payment check and delivery"), when known. */
  citedList: I18nKeyParam | null;
  /** Pre-formatted dates of stored facts; null = no stored fact, the sentence is dropped. */
  dates: { saveAttempt: string | null; buildAttempt: string | null; filed: string | null; queued: string | null };
  /** Decided only. */
  responder: "we" | "shopify" | "none" | "before_install" | "sent_before_install" | null;
  decided: { outcome: I18nToken | null; filedElsewhere: I18nToken | null };
  /** Existing record tokens used verbatim by the generic states. */
  stateToken: I18nToken | null;
  attentionToken: I18nToken | null;
  hasPackage: boolean;
  /** The pack carries a "saved to Shopify" stamp while `submission_state` says "not_saved": Shopify never confirmed it. */
  unconfirmedStamp: boolean;
}

/* ── Building blocks ── */

const LABEL: Record<StatusPartKind, I18nToken> = {
  happened: s("label.happened"),
  need: s("label.need"),
  can: s("label.can"),
  optional: s("label.optional"),
  next: s("label.next"),
  done: s("label.done"),
};

function part(kind: StatusPartKind, lines: Array<I18nToken | null>, actions: StatusAction[] = []): StatusPart | null {
  const kept = lines.filter((l): l is I18nToken => l !== null);
  if (kept.length === 0 && actions.length === 0) return null;
  return { kind, label: LABEL[kind], lines: kept, actions };
}

function subline(i: StatusCopyInput): I18nToken {
  const phase = nest(i.phase === "inquiry" ? "phase.inquiry" : "phase.chargeback");
  if (i.status !== "open" && i.decidedDay) return s("subline.decided", { phase, amount: i.amount, date: i.decidedDay });
  if (i.status === "open" && i.dueDay) {
    return s(i.deadlineToday ? "subline.openToday" : "subline.open", { phase, amount: i.amount, date: i.dueDay });
  }
  return s("subline.plain", { phase, amount: i.amount });
}

const ASK_STATES: Partial<Record<AskId, { headline: string; need: string; action: StatusAction; next: string[] }>> = {
  return_request: {
    headline: "askReturn",
    need: "need.return",
    action: { id: "ask:return_request", label: s("action.answer") },
    next: ["next.returnAnswer"],
  },
  bank_claim: {
    headline: "askBank",
    need: "need.bank",
    action: { id: "ask:bank_claim", label: { key: "disputes.bankClaim.title" } },
    next: ["next.bankAnswer", "next.bankNone"],
  },
};

const DONE_NOT_FILED_BUILT = "done.drafted";
const DONE_NOT_FILED_EVIDENCE = "done.evidence";

/* ── The composer ── */

/**
 * Refunding is only on the table while the dispute is an INQUIRY: no money has moved, and a full refund
 * closes it. Once it is a chargeback the amount is already debited and Shopify blocks refunds, so this
 * advice must never appear there. It applies when the carrier returned the parcel and the order is not
 * already refunded in full. States where a response is already filed, or the dispute is decided, never
 * carry it.
 */
const REFUND_ADVICE_STATES: ReadonlySet<StatusState> = new Set<StatusState>([
  "ask", "approval", "scheduled", "conceded", "nothing_to_argue", "attention", "build_failed", "build_paused", "preparing",
]);

export function shouldAdviseRefund(i: Pick<StatusCopyInput, "status" | "phase" | "returnedToSender" | "fatalReason">): boolean {
  return i.status === "open" && i.phase === "inquiry" && i.returnedToSender && i.fatalReason !== "refund_issued";
}

export function composeStatusCopy(i: StatusCopyInput): StatusCopy {
  const sub = subline(i);
  const adviseRefund = shouldAdviseRefund(i);
  const make = (state: StatusState, headline: I18nToken, parts: Array<StatusPart | null>): StatusCopy => {
    const kept = parts.filter((p): p is StatusPart => p !== null);
    if (adviseRefund && REFUND_ADVICE_STATES.has(state)) {
      const at = kept.findIndex((p) => p.kind !== "happened");
      const advice = part("can", [s("can.refundInquiry")]);
      if (advice) kept.splice(at < 0 ? kept.length : at, 0, advice);
    }
    return { state, headline, chip: s(`chip.${state}`), subline: sub, parts: kept };
  };
  const happened = (...extra: Array<I18nToken | null>) => part("happened", [i.claim, ...extra]);
  const happenedWithFact = () => happened(i.caseFact);
  const doneLine = () =>
    part("done", [i.build?.packageWritten || (i.build === null && i.hasPackage) ? s(DONE_NOT_FILED_BUILT) : s(DONE_NOT_FILED_EVIDENCE)]);
  const relies = (key: string): I18nToken | null => (i.citedList ? s(key, { list: i.citedList }) : null);

  /* K - decided */
  if (i.status !== "open") {
    const filedLine: I18nToken | null =
      i.responder === "we"
        ? i.dates.filed
          ? s("happened.filedWe", { date: i.dates.filed })
          : null
        : i.decided.filedElsewhere;
    const reliedLine = i.responder === "we" ? relies("happened.relied") : null;
    const happenedPart = part("happened", [i.claim, i.decided.outcome, filedLine, reliedLine]);
    if (i.status === "closed") {
      return make("closed", { key: "disputes.record.headline.closed" }, [happenedPart]);
    }
    const state = i.status;
    const headline = i.hasAmount
      ? s(`headline.${state}`, { amount: i.amount })
      : s(`headline.${state}NoAmount`);
    return make(state, headline, [happenedPart]);
  }

  /* I - covered by Shopify Protect */
  if (i.stage === "covered") {
    return make("covered", s("headline.covered"), [happened(), part("next", [s("next.covered")])]);
  }

  /* E - filed (ours) / sent through Shopify (not ours) */
  const ours =
    i.submissionState === "saved_to_shopify" ||
    i.submissionState === "submitted_confirmed" ||
    (i.submissionState === null && (i.lifecycle === "saved_to_shopify" || i.lifecycle === "under_review"));
  const shopifyOwn =
    i.submissionState === "responded_via_shopify" ||
    i.submissionState === "under_review_unattributed" ||
    (!ours && i.lifecycle === "under_review");
  if (ours || shopifyOwn) {
    const passed = i.lifecycle === "under_review" || i.submissionState === "submitted_confirmed";
    const next = part("next", [
      s(passed ? "next.passed" : "next.passes"),
      s(i.phase === "inquiry" ? "next.inquiry" : "next.chargeback"),
      s("next.email"),
    ]);
    if (ours) {
      return make("filed", s("headline.filed"), [
        happened(
          i.dates.filed ? s("happened.filed", { date: i.dates.filed }) : s("happened.filedNoDate"),
          relies("happened.relies"),
        ),
        next,
      ]);
    }
    return make("sent_by_shopify", s("headline.sentByShopify"), [
      happened(s("happened.sentByShopify")),
      next,
    ]);
  }

  /* D - being filed */
  if (i.lifecycle === "save_queued" || i.save === "queued" || i.save === "running") {
    return make("filing", s("headline.filing"), [happened(), part("next", [s("next.filing")]), doneLine()]);
  }

  const buildState = i.build?.state ?? null;
  const packageWritten = i.build?.packageWritten ?? i.hasPackage;
  const deadlineTail = (key: string): I18nToken | null => (i.dueDay ? s(key, { date: i.dueDay }) : null);
  /** The deadline cron files an unapproved review-mode dispute never; it emails only when it ran and refused. */
  const cronRuns = i.automationMode !== "review" || i.decision === "approved";

  /* J - plan limit reached, no response prepared */
  if (i.blockingReason === "quota_exceeded" && !packageWritten) {
    return make("plan_limit", s("headline.planLimit"), [
      happened(s("happened.planLimit")),
      part("need", [s("need.plan")], [{ id: "plans", label: s("action.plans") }]),
      part("next", [deadlineTail("next.planLimit") ?? s("next.planLimitNoDate")]),
    ]);
  }

  /* A / B - the merchant owes an answer. The first offered, pending, REQUIRED ask in registry order. */
  for (const ask of i.asks) {
    if (!(ask.offered && ask.pending && ask.priority === "required")) continue;
    const today = i.deadlineToday;
    if (ask.id === "review_decision") {
      // "The response is ready" is only true when a response was written.
      if (!packageWritten) continue;
      return make("approval", s("headline.approval"), [
        happenedWithFact(),
        part(
          "need",
          [s("need.review")],
          [
            { id: "decide:approved", label: s("action.approve") },
            { id: "decide:conceded", label: s("action.concede") },
          ],
        ),
        part("next", [deadlineTail("next.reviewApprove"), s("next.reviewNone")]),
        doneLine(),
      ]);
    }
    const spec = ASK_STATES[ask.id];
    if (!spec) continue;
    return make("ask", s(today ? `headline.${spec.headline}Today` : `headline.${spec.headline}`), [
      happenedWithFact(),
      part("need", [s(spec.need)], [spec.action]),
      part("next", spec.next.map((k) => s(k))),
      doneLine(),
    ]);
  }

  /* F - the filing failed */
  if (i.lifecycle === "save_failed" || i.save === "failed") {
    return make("save_failed", s("headline.saveFailed"), [
      happened(i.dates.saveAttempt ? s("happened.saveFailed", { date: i.dates.saveAttempt }) : s("happened.saveFailedNoDate")),
      part("need", [s("need.nothing")]),
      part("next", [cronRuns ? deadlineTail("next.saveRetry") : null]),
      doneLine(),
    ]);
  }

  /* Stamped saved, never confirmed by Shopify (the pre-Track-S enqueue-time stamp) */
  // The stamp alone no longer makes the stage "saved" (recordStage): a stamp with submission_state "not_saved" is read here.
  if (((i.stage === "saved" || i.stage === "under_review") && !ours) || i.unconfirmedStamp) {
    return make("unconfirmed", s("headline.unconfirmed"), [
      happened(i.dates.queued ? s("happened.unconfirmed", { date: i.dates.queued }) : s("happened.unconfirmedNoDate")),
      part("need", [s("need.nothing")]),
      part("next", [deadlineTail("next.unconfirmed")]),
    ]);
  }

  /* G - the response could not be written */
  if (i.stage === "failed" || buildState === "failed" || buildState === "capped") {
    const paused = buildState === "capped";
    return make(paused ? "build_paused" : "build_failed", s(paused ? "headline.buildPaused" : "headline.buildFailed"), [
      happened(
        paused
          ? s("happened.buildPaused")
          : i.dates.buildAttempt
            ? s("happened.buildFailed", { date: i.dates.buildAttempt })
            : s("happened.buildFailedNoDate"),
      ),
      part("need", [s("need.nothing")]),
      part(
        "next",
        paused
          ? [s("next.buildPaused")]
          : [deadlineTail("next.rebuild"), s(cronRuns ? "next.buildNoFile" : "next.buildNoFileQuiet")],
      ),
    ]);
  }

  /* H - nothing to argue */
  if (i.stage === "fatal" || buildState === "declined" || buildState === "not_required") {
    const fatal = i.stage === "fatal";
    const why: I18nToken =
      fatal && i.fatalReason === "refund_issued"
        ? s("happened.refundCovers")
        : fatal
          ? s("happened.notFulfilled")
          : i.returnedToSender
            ? s("fact.returnedToSender")
            : i.recordSituation === "return"
              ? { key: "disputes.record.item.return.returned" }
              : i.recordSituation === "refund"
                ? { key: "disputes.record.item.return.refundSome" }
                : s("happened.noFacts");
    const refundOnly = fatal && i.fatalReason === "refund_issued";
    return make("nothing_to_argue", s("headline.nothingToArgue"), [
      happened(why),
      // A returned parcel can never have a delivery confirmation: "proof we cannot see" would point at nothing.
      refundOnly || i.returnedToSender
        ? null
        : part("can", [s("can.evidence")], [{ id: "tab:evidence", label: s("action.evidence") }]),
      // One coherent sentence: the deadline-rebuild cron (06:00 UTC, every open unfiled dispute due in the window)
      // re-checks the record; if it still yields no response, nothing is filed and Shopify sends its own.
      part("next", [
        !refundOnly && i.dueDay ? s("next.recheck", { date: i.dueDay }) : s("next.shopifySends"),
        fatal ? s("next.expectLoss") : null,
      ]),
      part("done", [s(DONE_NOT_FILED_EVIDENCE)]),
    ]);
  }

  /* The merchant chose not to add a response */
  if (i.decision === "conceded") {
    return make("conceded", s("headline.conceded"), [
      happenedWithFact(),
      part("next", [s("next.shopifySends")]),
    ]);
  }

  /* Preparing */
  if (i.stage === "no_pack" || i.stage === "building") {
    return make("preparing", s("headline.preparing"), [happened(), part("next", [i.stateToken])]);
  }

  /* C - scheduled for the deadline (held, auto-pilot, or approved in review mode) */
  const scheduledOk =
    i.stage === "prepared" ||
    i.stage === "held" ||
    ((i.stage === "prepared_review" || i.stage === "needs_attention") && i.decision === "approved");
  if (scheduledOk && i.blockingReason === null) {
    const optional: StatusAction[] = [];
    const live = i.asks.filter((a) => a.offered && a.pending && a.priority === "optional");
    if (live.some((a) => a.id === "missing_evidence")) optional.push({ id: "tab:evidence", label: s("action.evidence") });
    else if (i.ackFits && live.some((a) => a.id === "cardholder_ack")) optional.push({ id: "ack", label: s("action.ack") });
    const optionalLine = optional[0]?.id === "ack" ? s("optional.ack") : optional.length > 0 ? { key: "disputes.record.action.evidence" } : null;
    return make("scheduled", i.dueDay ? s("headline.scheduled", { date: i.dueDay }) : s("headline.scheduledNoDate"), [
      happenedWithFact(),
      part("next", [i.dueDay ? s("next.scheduled", { date: i.dueDay }) : s("next.scheduledNoDate")]),
      optionalLine ? part("optional", [optionalLine], optional) : null,
      doneLine(),
    ]);
  }

  /* Anything else that needs the merchant, or that we cannot name: the record's own attention sentence. */
  return make("attention", { key: "disputes.record.headline.needs_attention" }, [
    happenedWithFact(),
    part("need", [i.attentionToken]),
  ]);
}
