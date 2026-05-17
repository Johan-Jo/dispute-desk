/**
 * Reason-code FAMILY registry. Layer 1, above the module registry.
 *
 * Families group modules into cross-cutting evidence-strategy clusters.
 * The reason code → family mapping is built from each family's
 * declared modules' reasonCodeKeys plus the family's own unmodeledCodes
 * list — a single code never belongs to two families.
 *
 * Phase 1: one family per module (1:1), overlays empty. Strategies
 * (Phase 3+) live below families.
 */

import { unauthorized_fraud } from "./families/unauthorized_fraud";
import { item_not_received } from "./families/item_not_received";
import { product_not_as_described } from "./families/product_not_as_described";
import { credit_not_processed_family } from "./families/credit_not_processed";
import { duplicate_processing_family } from "./families/duplicate_processing";
import { cancelled_recurring } from "./families/cancelled_recurring";
import { processing_error } from "./families/processing_error";
import { authorization_error } from "./families/authorization_error";
import { fallback_family } from "./families/fallback";

import type {
  ReasonCodeFamily,
  ReasonCodeFamilyKey,
  ReasonCodeGuidance,
  ReasonCodeModuleKey,
} from "../types";

const FAMILIES: Record<ReasonCodeFamilyKey, ReasonCodeFamily> = {
  unauthorized_fraud,
  item_not_received,
  product_not_as_described,
  credit_not_processed: credit_not_processed_family,
  duplicate_processing: duplicate_processing_family,
  cancelled_recurring,
  processing_error,
  authorization_error,
  fallback: fallback_family,
};

/** All file-default families. Order matters for snapshot tests but not
 *  for resolution — resolution uses the CODE_TO_FAMILY index below. */
export const ALL_REASON_CODE_FAMILIES: ReasonCodeFamily[] = [
  unauthorized_fraud,
  item_not_received,
  product_not_as_described,
  credit_not_processed_family,
  duplicate_processing_family,
  cancelled_recurring,
  processing_error,
  authorization_error,
  fallback_family,
];

/** Reverse index: network reason code → family key. Built once at
 *  module load. Codes claimed by a family's modules' reasonCodeKeys
 *  take precedence over unmodeledCodes; collisions across families
 *  throw at load time to fail loud rather than silently route. */
const CODE_TO_FAMILY: ReadonlyMap<string, ReasonCodeFamilyKey> = (() => {
  const map = new Map<string, ReasonCodeFamilyKey>();
  // Walk modules first so explicit module ownership beats unmodeledCodes.
  // We import the module registry lazily here to avoid a circular dep
  // (registry.ts also wants to import familyRegistry for module→family
  // lookup).
  for (const family of ALL_REASON_CODE_FAMILIES) {
    for (const code of family.unmodeledCodes) {
      if (map.has(code) && map.get(code) !== family.key) {
        throw new Error(
          `Reason code ${code} is claimed by both ${map.get(code)} (unmodeled) and ${family.key} (unmodeled). Disambiguate before continuing.`,
        );
      }
      map.set(code, family.key);
    }
  }
  return map;
})();

/** Module key → family key lookup. Used by registry.ts via
 *  familyKeyForModule. Built from family.moduleKeys. */
const MODULE_TO_FAMILY: ReadonlyMap<ReasonCodeModuleKey, ReasonCodeFamilyKey> = (() => {
  const map = new Map<ReasonCodeModuleKey, ReasonCodeFamilyKey>();
  for (const family of ALL_REASON_CODE_FAMILIES) {
    for (const moduleKey of family.moduleKeys) {
      if (map.has(moduleKey) && map.get(moduleKey) !== family.key) {
        throw new Error(
          `Module ${moduleKey} is claimed by both ${map.get(moduleKey)} and ${family.key}. Each module belongs to exactly one family.`,
        );
      }
      map.set(moduleKey, family.key);
    }
  }
  return map;
})();

/** Resolve a reason code to its family. Falls back to the `fallback`
 *  family for unknown / null / undefined. Never returns null. */
export function resolveReasonCodeFamily(
  networkReasonCode: string | null | undefined,
): ReasonCodeFamily {
  if (!networkReasonCode) return FAMILIES.fallback;
  // CODE_TO_FAMILY only carries unmodeledCodes. For modeled codes, the
  // module registry's CODE_TO_KEY lookup → MODULES[key].key → family
  // path is used at the call site (resolveReasonCodeModule + familyKeyForModule).
  // Here we don't have access to the module registry without a circular
  // dep, so callers that have a module resolved should use
  // familyForModule(module.key) below; callers without a resolved
  // module fall through to unmodeled lookup.
  const familyKey = CODE_TO_FAMILY.get(networkReasonCode);
  if (familyKey) return FAMILIES[familyKey];
  return FAMILIES.fallback;
}

/** Resolve a family by its key. Used by tests and admin tooling. */
export function getFamily(key: ReasonCodeFamilyKey): ReasonCodeFamily {
  return FAMILIES[key];
}

/** Resolve a module key to its family. Layer-1 entry point for code
 *  that already has the module resolved. */
export function familyForModule(
  moduleKey: ReasonCodeModuleKey,
): ReasonCodeFamily {
  const familyKey = MODULE_TO_FAMILY.get(moduleKey);
  if (!familyKey) {
    // Every module must belong to a family — failing here means a new
    // module was added without family wiring. Fail loud.
    throw new Error(`Module ${moduleKey} is not declared in any family's moduleKeys.`);
  }
  return FAMILIES[familyKey];
}

/** Resolve a family from either a reason code or an already-resolved
 *  module. Prefers the module's family (since the module routing rule
 *  is the authoritative path) and falls back to the code-only lookup
 *  when only a code is available. */
export function familyForCodeOrModule(
  networkReasonCode: string | null | undefined,
  resolvedModule: ReasonCodeGuidance | null,
): ReasonCodeFamily {
  if (resolvedModule) return familyForModule(resolvedModule.key);
  return resolveReasonCodeFamily(networkReasonCode);
}
