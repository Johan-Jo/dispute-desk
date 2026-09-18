/**
 * The guidance fields a `defence_prompt_modules` row may override, in one
 * place.
 *
 * WHY THIS EXISTS. The same five-key list was written out three times — in
 * `admin-queries.detectPromptModuleDrift`, in
 * `scripts/reconcile-defence-prompt-modules.mts`, and implicitly in
 * `registry.resolveReasonCodeModule`'s override application. Three copies of
 * one list is three chances for a sixth field to be added to
 * `ReasonCodeGuidance`, wired into the override path, and left out of drift
 * detection — which would make that field drift *invisibly*, because the thing
 * that reports drift would not be looking at it.
 *
 * That is not hypothetical. On 2026-09-02 all seven modules were found drifted
 * in prod, `visa_10_4_fraud` by prompt body across five commits and seven
 * weeks, and a change shipped the previous day had no effect at all because the
 * stale DB row outranked it. Drift detection existed the whole time; nothing
 * consumed it, and nothing guaranteed it covered the same fields the resolver
 * actually reads.
 *
 * If you add an overridable field to `ReasonCodeGuidance`, add it here. The
 * test in `__tests__/promptModuleOverrideCoverage.test.ts` fails if the
 * resolver reads a field this list does not name.
 */

/** Guidance fields carried in `defence_prompt_modules.guidance_json`. */
export const PROMPT_MODULE_GUIDANCE_KEYS = [
  "prioritize",
  "avoid",
  "mustNotClaim",
  "criticalCategories",
  "allowedFactCategories",
] as const;

export type PromptModuleGuidanceKey =
  (typeof PROMPT_MODULE_GUIDANCE_KEYS)[number];

/**
 * Everything a DB row can override, including the two fields that live
 * outside `guidance_json`. `version` is excluded deliberately: it identifies
 * the row rather than steering generation, so it is not a drift signal.
 */
export const PROMPT_MODULE_OVERRIDABLE_FIELDS = [
  "promptBody",
  ...PROMPT_MODULE_GUIDANCE_KEYS,
] as const;
