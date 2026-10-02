/**
 * Kill switch for the two insight digests: the monthly Chargeback Exposure
 * email and the onboarding analysis email.
 *
 * Suspended 2026-10-02. Both emails computed their own figures, separately
 * from the Insights page they link to, and the 1 October send told merchants
 * a 90-day "0.90% chargeback rate" while the page said 5.31% and the
 * calendar-month rate was 0.15% (blume-box). Until both surfaces read one
 * record (docs/plans/insights-single-source.plan.md, PR4), no insight digest
 * may leave.
 *
 * A code constant, not an env var: there is nothing to flip in Vercel, and
 * PR4 re-enables it in the same change that fixes the numbers.
 */
export function insightsDigestsEnabled(): boolean {
  return false;
}
