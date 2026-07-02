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

/**
 * Shopify dispute-reason enum → module key. Used as a fallback routing
 * key ONLY when there is no network reason code (BNPL/local methods like
 * Klarna/Affirm, which have no Visa/Mastercard code). Card disputes keep
 * routing on the network code. Reuses the existing per-reason modules so
 * a Klarna "item not received" gets the same delivery-proof guidance a
 * card 13.1 would, minus the card-network framing (added by the payment
 * overlay). Only the reasons we actually see for BNPL are mapped; the
 * rest fall through to generic_fallback.
 */
const SHOPIFY_REASON_TO_MODULE: ReadonlyMap<string, ReasonCodeModuleKey> =
  new Map([
    ["PRODUCT_NOT_RECEIVED", "inr_product_not_received"],
    ["CREDIT_NOT_PROCESSED", "credit_not_processed"],
    ["PRODUCT_UNACCEPTABLE", "product_unacceptable"],
    ["SUBSCRIPTION_CANCELED", "canceled_recurring"],
    ["DUPLICATE", "duplicate_processing"],
  ]);

/**
 * Context-aware module resolution. Prefers the network reason code (card
 * path, unchanged). When there is no network code AND a Shopify reason
 * enum is available (the BNPL/local case), routes on the Shopify enum so
 * Klarna/Affirm disputes reuse the right reason module instead of
 * collapsing to generic_fallback. Falls through to generic_fallback when
 * neither yields a match.
 */
export function resolveReasonCodeModuleForContext(
  networkReasonCode: string | null | undefined,
  shopifyReason: string | null | undefined,
  dbOverride?: ReasonCodeModuleOverride | null,
): ReasonCodeGuidance {
  if (!networkReasonCode && shopifyReason) {
    const key = SHOPIFY_REASON_TO_MODULE.get(shopifyReason.toUpperCase());
    if (key) {
      const base = MODULES[key];
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
          dbOverride.guidanceJson?.allowedFactCategories ??
          base.allowedFactCategories,
        version: dbOverride.version ?? base.version,
      };
    }
  }
  return resolveReasonCodeModule(networkReasonCode, dbOverride);
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
