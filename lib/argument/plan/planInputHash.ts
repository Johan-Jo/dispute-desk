/**
 * The plan's `inputHash` — the ONLY staleness signal for `CaseArgumentPlan`.
 *
 * CONTRACT (freshness.ts): changing any input that can change the RESULT must
 * change this hash; a timestamp is not a staleness signal. So the hash covers
 * exactly the derivation's inputs — candidates, the allow-list, the prioritise
 * list, the always-admissible set, and the review items — and nothing else.
 *
 * WHY NOT `computeEvidenceHash`. That hash is over `EvidenceFact[]`, whose ids
 * are POSITIONAL (`f${index}`) and which it then sorts on, so it is unstable
 * under any change to iteration order and is the direct cause of R4: a record-id
 * migration changes every hash once, fleet-wide. This hash sorts on the
 * source-derived `recordId`, so re-running the derivation over the same evidence
 * in a different order produces the same value.
 *
 * R4 CONSEQUENCE, STATED RATHER THAN HIDDEN. Introducing this hash stales every
 * package built before it, because no such package carries one. The kickoff
 * decision handles that by scope — current open, unsubmitted cases are rebuilt
 * before wave two, legacy packages are not grandfathered. There is deliberately
 * no escape hatch here.
 */

import { createHash } from "node:crypto";
import type { MerchantReviewItem } from "@/lib/pipeline/contracts";
import type { PlanCandidate } from "./candidates";

export interface PlanInputHashParts {
  reasonModuleId: string;
  allowedFactCategories: readonly string[];
  criticalCategories: readonly string[];
  alwaysAdmissibleCategories?: readonly string[];
  candidates: readonly PlanCandidate[];
  reviewItems?: readonly MerchantReviewItem[];
}

/** Sorted so ordering of a set-like input never moves the hash. */
function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function computePlanInputHash(parts: PlanInputHashParts): string {
  const canonical = {
    reasonModuleId: parts.reasonModuleId,
    allowed: sortedUnique(parts.allowedFactCategories),
    critical: sortedUnique(parts.criticalCategories),
    alwaysAdmissible: sortedUnique(parts.alwaysAdmissibleCategories ?? []),
    // Sorted on the SOURCE-DERIVED record id, never on iteration position.
    candidates: [...parts.candidates]
      .map((c) => ({
        recordId: c.recordId,
        fieldKey: c.fieldKey,
        factCategory: c.factCategory,
        validity: c.validity,
        citation: c.citation,
      }))
      .sort((a, b) => a.recordId.localeCompare(b.recordId)),
    // `blocksNormalFiling` is carried: it changes `deadlineOnly`, which changes
    // which trigger may file. `reasonToken` is carried because it is the copy
    // the merchant was shown, and a changed reason is a changed answer.
    reviewItems: [...(parts.reviewItems ?? [])]
      .map((r) => ({
        recordId: r.recordId,
        fieldKey: r.fieldKey,
        reasonToken: r.reasonToken,
        blocksNormalFiling: r.blocksNormalFiling,
      }))
      .sort((a, b) => a.recordId.localeCompare(b.recordId)),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
