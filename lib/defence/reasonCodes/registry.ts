/**
 * Reason-code module registry. Maps network reason codes (Visa "10.4",
 * MC "4837", etc.) to a `ReasonCodeGuidance` module.
 *
 * Override precedence: DB row from `defence_prompt_modules` beats the
 * file default. Unknown reason codes fall through to `generic_fallback`.
 */

import type {
  ReasonCodeFamilyKey,
  ReasonCodeGuidance,
  ReasonCodeModuleKey,
} from "../types";
import { visa_10_4_fraud } from "./visa_10_4_fraud";
import { inr_product_not_received } from "./inr_product_not_received";
import { product_unacceptable } from "./product_unacceptable";
import { credit_not_processed } from "./credit_not_processed";
import { duplicate_processing } from "./duplicate_processing";
import { canceled_recurring } from "./canceled_recurring";
import { generic_fallback } from "./generic_fallback";
import {
  familyForModule,
  resolveReasonCodeFamily,
} from "./familyRegistry";

const MODULES: Record<ReasonCodeModuleKey, ReasonCodeGuidance> = {
  visa_10_4_fraud,
  inr_product_not_received,
  product_unacceptable,
  credit_not_processed,
  duplicate_processing,
  canceled_recurring,
  generic_fallback,
};

/** Reverse index: network reason code → module key. Built once. */
const CODE_TO_KEY: ReadonlyMap<string, ReasonCodeModuleKey> = (() => {
  const m = new Map<string, ReasonCodeModuleKey>();
  for (const [key, mod] of Object.entries(MODULES) as Array<
    [ReasonCodeModuleKey, ReasonCodeGuidance]
  >) {
    for (const code of mod.reasonCodeKeys) {
      m.set(code, key);
    }
  }
  return m;
})();

/** Optional override fields from a DB row. Unset fields fall through. */
export interface ReasonCodeModuleOverride {
  promptBody?: string;
  guidanceJson?: Partial<
    Pick<
      ReasonCodeGuidance,
      "prioritize" | "avoid" | "mustNotClaim" | "criticalCategories" | "allowedFactCategories"
    >
  >;
  model?: string;
  version?: number;
}

export function resolveReasonCodeModule(
  networkReasonCode: string | null | undefined,
  dbOverride?: ReasonCodeModuleOverride | null,
): ReasonCodeGuidance {
  const key = networkReasonCode ? CODE_TO_KEY.get(networkReasonCode) : undefined;
  const base = key ? MODULES[key] : MODULES.generic_fallback;

  if (!dbOverride) return base;

  return {
    ...base,
    promptBody: dbOverride.promptBody ?? base.promptBody,
    prioritize: dbOverride.guidanceJson?.prioritize ?? base.prioritize,
    avoid: dbOverride.guidanceJson?.avoid ?? base.avoid,
    mustNotClaim: dbOverride.guidanceJson?.mustNotClaim ?? base.mustNotClaim,
    criticalCategories:
      dbOverride.guidanceJson?.criticalCategories ?? base.criticalCategories,
    allowedFactCategories:
      dbOverride.guidanceJson?.allowedFactCategories ?? base.allowedFactCategories,
    version: dbOverride.version ?? base.version,
  };
}

/** All file-default modules; used by the seed script. */
export const ALL_REASON_CODE_MODULES: ReasonCodeGuidance[] = [
  visa_10_4_fraud,
  inr_product_not_received,
  product_unacceptable,
  credit_not_processed,
  duplicate_processing,
  canceled_recurring,
  generic_fallback,
];

/** Layer-1 helper: family key for a given module key. Thin wrapper over
 *  familyRegistry's familyForModule — exposed here so callers that
 *  already import from the module registry don't need to learn two
 *  import paths. */
export function familyKeyForModule(
  moduleKey: ReasonCodeModuleKey,
): ReasonCodeFamilyKey {
  return familyForModule(moduleKey).key;
}

// Re-export the family-level resolver so the public surface of this
// module covers both layers.
export { resolveReasonCodeFamily };
