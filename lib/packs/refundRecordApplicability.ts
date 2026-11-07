/**
 * Can the `refund_record` fact exist for this order, as far as the record shows?
 * READ-TIME answer (plan single-source-architecture-audit §3.1, F-1b).
 *
 * The collector (`orderSource.ts`) adds `refund_record` to a section's
 * `fieldsProvided` only when the order's refunded total is above zero. On
 * credit-not-processed (and fraudulent) disputes the template row is `critical`;
 * with no refund on record it can never be satisfied, so every merchant page
 * counted a row that cannot exist. FRAUDULENT already gets this at build time
 * through `required_if_refunded`, but only when the order has no refund ENTRY at
 * all: a zero-amount entry still reads `missing` there.
 *
 *   - reason outside {CREDIT_NOT_PROCESSED, FRAUDULENT}  -> applicable (unchanged)
 *   - refunded total unknown (never recorded / unparseable) -> applicable (fail open)
 *   - refunded total above zero                          -> applicable
 *   - refunded total known and not above zero            -> inapplicable (`no_refund_on_record`)
 *
 * Reasons are codes, never English (CLAUDE.md rule 5). Used ONLY by the
 * read-time assembler and the decided loader; build time does not set it, so
 * stored `checklist_v2`, `completeness_score` and the auto-save gate are
 * untouched.
 */

import type { Applicability } from "@/lib/automation/completeness";

/** Dispute reasons whose template carries a critical `refund_record` row. */
export const REFUND_RECORD_PRECONDITION_REASONS: ReadonlySet<string> = new Set([
  "CREDIT_NOT_PROCESSED",
  "FRAUDULENT",
]);

export function refundRecordApplicability(input: {
  disputeReason: string | null | undefined;
  totalRefunded: number | string | null | undefined;
}): Applicability {
  if (!REFUND_RECORD_PRECONDITION_REASONS.has(input.disputeReason ?? "")) return { applicable: true };
  const raw = input.totalRefunded;
  const total =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number.parseFloat(raw)
        : Number.NaN;
  if (!Number.isFinite(total)) return { applicable: true };
  return total > 0 ? { applicable: true } : { applicable: false, reason: "no_refund_on_record" };
}
