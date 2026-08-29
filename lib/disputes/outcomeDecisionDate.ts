/**
 * The date shown beside a terminal outcome is the issuer/network decision
 * timestamp. Evidence submission is a different event and must never be used
 * as a fallback for "decided on" copy.
 */
export function resolveOutcomeDecisionDate(input: {
  closedAt: string | null | undefined;
  submittedAt: string | null | undefined;
}): string | null {
  return input.closedAt ?? null;
}
