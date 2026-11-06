/**
 * Read-time guard for the stored "improve your case by adding X" hint.
 *
 * `pack_json.case_assessment.strength.improvementHintI18n` is written at build
 * and names a SIGNAL, not a field. For the refund signal the only fields are
 * `refund_record` and `no_return_initiated`, neither of which a merchant can
 * supply (`NEVER_MERCHANT_UPLOADABLE`). Packs built before PR 1 still carry
 * that hint; stored output is deliberately left untouched (caseStrength keeps
 * the build-time rule), so the display layer drops it instead.
 */

import type { I18nToken } from "@/lib/i18n/token";
import { CANONICAL_EVIDENCE } from "@/lib/argument/canonicalEvidence";
import { NEVER_MERCHANT_UPLOADABLE } from "@/lib/disputes/presentation/concreteContribution";

/** Label keys of signals whose every registered field is non-uploadable. */
function unsuppliableSignalLabelKeys(): Set<string> {
  const bySignal = new Map<string, { labelKey: string; allNever: boolean }>();
  for (const [field, spec] of Object.entries(CANONICAL_EVIDENCE)) {
    const cur = bySignal.get(spec.signalId) ?? { labelKey: spec.labelKey, allNever: true };
    cur.allNever = cur.allNever && NEVER_MERCHANT_UPLOADABLE.has(field);
    bySignal.set(spec.signalId, cur);
  }
  return new Set([...bySignal.values()].filter((s) => s.allNever).map((s) => s.labelKey));
}

const UNSUPPLIABLE = unsuppliableSignalLabelKeys();

/** True when the hint asks the merchant to add something only Shopify holds. */
export function hintAsksForUnsuppliableSignal(hint: I18nToken | null | undefined): boolean {
  const label = (hint?.params as { label?: { key?: string } } | undefined)?.label;
  return typeof label?.key === "string" && UNSUPPLIABLE.has(label.key);
}
