/**
 * Which copy key the dispute-detail hero shows — as a pure function.
 *
 * WHY THIS IS NOT INLINE IN THE COMPONENT (2026-09-03). The hero's precedence
 * lived inside `OverviewTab.tsx`, a client component with no render test in the
 * repo (`disputeDetailCopy.test.ts` asserts the STRINGS, never which one is
 * chosen). So `resolveAttention` could be fixed, verified in isolation, and
 * reported as fixed while the page went on rendering the old headline — which
 * is exactly what happened on #99413: the resolver said `blocking` /
 * `auto_build_off`, and the page said "Building your evidence pack… no action
 * needed from you", because the hero only ever handled `approval_gate`.
 *
 * A pure function is the part worth pinning: the component now calls this and
 * so does the test, so a passing test means the PAGE picks that key, not merely
 * that the key exists.
 */

import type { DisputePresentation } from "./types";

/** Blocking causes the hero states directly. `approval_gate` is excluded on
 *  purpose: it has a dedicated block offering the approve/hold controls, which
 *  is more useful than a headline naming the state. */
const HERO_STATED_BLOCKING = new Set([
  "missing_required_evidence",
  "quota_exceeded",
  "feature_blocked",
  "subscription_expired",
  "payment_failed",
  "auto_build_off",
]);

const TERMINAL = new Set(["won", "lost", "closed"]);

export interface HeroCopyInput {
  lifecycle: string;
  attention: DisputePresentation["attention"] | null;
  blockingReason: DisputePresentation["blockingReason"] | null;
}

/**
 * The copy keys the hero renders, relative to the `disputes.overview`
 * namespace, or null to fall through to the lifecycle headline.
 *
 * A blocking cause OUTRANKS the lifecycle headline: "Building evidence" is not
 * false when the build is halted so much as unreachable, and describing halted
 * work as progress is how a merchant runs out their deadline believing nothing
 * is needed from them. Terminal cases keep their headline — nothing is blocked
 * once the case is decided.
 */
export function heroBlockingCopy(
  input: HeroCopyInput,
): { titleKey: string; subtitleKey: string } | null {
  if (input.attention !== "blocking") return null;
  if (input.blockingReason == null) return null;
  if (TERMINAL.has(input.lifecycle)) return null;
  if (!HERO_STATED_BLOCKING.has(input.blockingReason)) return null;
  return {
    titleKey: `attentionBlocking.${input.blockingReason}`,
    subtitleKey: `attentionBlockingSub.${input.blockingReason}`,
  };
}
