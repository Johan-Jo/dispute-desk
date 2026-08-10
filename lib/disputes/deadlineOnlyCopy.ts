/**
 * CP-A — what the merchant is told about `deadline_only`
 * (plan of record §4.1).
 *
 * ── THE PROBLEM THIS COPY EXISTS TO SOLVE ─────────────────────────────
 *
 * `deadline_only` silently converts *"we would file this now"* into *"we
 * will file this at the deadline"*. Nothing about the case looks different
 * on the surface: the package is built, validated and safe. The merchant
 * sees a prepared response sitting there and reasonably concludes it was
 * filed — or that something is broken.
 *
 * This is the same shape as the auto-pilot hold, which already needed a
 * merchant-copy reframe (2026-08-02): a state that waits on a CLOCK reads as
 * "please review" unless the copy says otherwise, and the merchant then
 * hunts for a button that does not exist.
 *
 * ── THE TWO STATES MUST BE DISTINGUISHABLE IN WORDS ───────────────────
 *
 *   deadline_only              → the DisputeDesk package is held for deadline
 *                                processing rather than added now.
 *   withheld_no_safe_argument  → DisputeDesk adds no defence package at all.
 *
 * Both look like "not filed yet" on a status badge, and the difference is
 * the entire product. One is a scheduled outcome; the other is an outcome
 * the merchant is entitled to know about before the deadline passes, because
 * they may still act on it. Rendering them with the same string, or letting
 * a caller pick a badge tone and infer the rest, is how a merchant discovers
 * on day 21 that nothing was ever going to be sent.
 *
 * ── NEITHER STATE BUYS SILENCE, AND NO STRING MAY SAY IT DOES ─────────
 *
 * The one claim this copy may never make is that the issuer hears nothing.
 * Shopify auto-compiles and files its own scrape of the order at the
 * deadline whether or not DisputeDesk adds a package, and there is no
 * accept/concede mutation that stops it. Every string below therefore says
 * which of the TWO actors does what: DisputeDesk adds (or does not add) a
 * defence package; Shopify's own deadline process runs either way with the
 * order details it already holds. The pre-existing "Don't defend" copy —
 * "Nothing will be submitted" — told merchants the opposite, and it is
 * corrected in the same change as these keys.
 *
 * ── THE LEVER ─────────────────────────────────────────────────────────
 *
 * Copy that describes a wait without naming what ends it is a status
 * message, not an instruction. Every token below names the merchant's actual
 * lever — confirming the flagged item(s) — and `itemCount` is a parameter,
 * not a sentence fragment, so each locale pluralises in its own grammar.
 *
 * No English here. `lib/**` emits `I18nToken`s; the leaf renderer resolves
 * them through `resolveToken` into the branded `Localized` type.
 */

import type { I18nToken } from "@/lib/i18n/token";

/**
 * How a prepared package relates to the deadline.
 *
 * A closed union rather than two booleans: `willFile && !willFile` is not a
 * state, and a boolean pair invites a renderer to invent a third meaning for
 * the combination nobody defined.
 */
export type DeadlineFilingState =
  /** Fileable now, on the ordinary trigger. Nothing is waiting. */
  | { kind: "normal" }
  /**
   * Safe and validated, but held for the deadline while `itemCount`
   * review-required item(s) remain unconfirmed. WILL be filed.
   */
  | { kind: "deadline_only"; itemCount: number }
  /**
   * No safe argument survives the exclusions, so DisputeDesk adds no defence
   * package. This is an honest product outcome, not an error — and
   * specifically not a reason to lower the bar and file something weaker.
   * It is also NOT silence: Shopify still files what it holds.
   */
  | { kind: "withheld_no_safe_argument" };

export interface DeadlineFilingCopy {
  /** Short state label. Never a verb the merchant must act on. */
  titleToken: I18nToken;
  /** One sentence: what happens, and when. */
  bodyToken: I18nToken;
  /** What the merchant can do about it. Null when there is nothing to do. */
  actionToken: I18nToken | null;
  /**
   * Whether this state ends with the DISPUTEDESK DEFENCE PACKAGE being filed.
   *
   * Deliberately not "whether evidence reaches the issuer" — that is always
   * true. Shopify files its own scrape at the deadline regardless, so the
   * only thing this flag can honestly describe is whose document goes.
   *
   * Carried explicitly so a surface never has to infer it from the tone of a
   * string — the inference that made the hold state read as "please review".
   */
  willFile: boolean;
}

/**
 * The copy for a filing state.
 *
 * Exhaustive over the union by construction: adding a fourth state is a
 * compile error here, which is the alarm that was missing when
 * `deadline_only` was added to the pipeline with no merchant copy at all.
 */
export function deadlineFilingCopy(state: DeadlineFilingState): DeadlineFilingCopy {
  switch (state.kind) {
    case "normal":
      return {
        titleToken: { key: "disputes.deadlineOnly.normal.title" },
        bodyToken: { key: "disputes.deadlineOnly.normal.body" },
        actionToken: null,
        willFile: true,
      };

    case "deadline_only":
      return {
        titleToken: { key: "disputes.deadlineOnly.held.title" },
        // `itemCount` reaches the catalog as a parameter so each locale
        // pluralises natively. English "1 item / 2 items" is not a rule the
        // other five share.
        bodyToken: {
          key: "disputes.deadlineOnly.held.body",
          params: { itemCount: state.itemCount },
        },
        // The lever, named. Without this the merchant is told to wait and
        // given nothing to do — which is how "held" gets read as "broken".
        actionToken: {
          key: "disputes.deadlineOnly.held.action",
          params: { itemCount: state.itemCount },
        },
        willFile: true,
      };

    case "withheld_no_safe_argument":
      return {
        titleToken: { key: "disputes.deadlineOnly.withheld.title" },
        bodyToken: { key: "disputes.deadlineOnly.withheld.body" },
        actionToken: { key: "disputes.deadlineOnly.withheld.action" },
        willFile: false,
      };
  }
}

/**
 * Resolve the filing state from the two canonical snapshots.
 *
 * Reads the PLAN, never the assessment: whether a package will be filed is
 * an argument-layer fact (`noSafeArgument`, `deadlineOnly`), and deriving it
 * from a strength band or a completeness score would be exactly the
 * cross-layer inference this pipeline exists to end. A weak-but-safe case
 * still files; a strong case whose only support was excluded does not.
 */
export function resolveDeadlineFilingState(plan: {
  deadlineOnly: boolean;
  noSafeArgument: unknown;
  reviewItemCount: number;
}): DeadlineFilingState {
  // Order matters: "we will not file" outranks "we will file late". A plan
  // can be both `deadlineOnly` and `noSafeArgument` — the review-required
  // exclusion is what removed the last supporting fact — and telling the
  // merchant it will be filed at the deadline would be false.
  if (plan.noSafeArgument !== null && plan.noSafeArgument !== undefined) {
    return { kind: "withheld_no_safe_argument" };
  }
  if (plan.deadlineOnly) {
    return { kind: "deadline_only", itemCount: plan.reviewItemCount };
  }
  return { kind: "normal" };
}
