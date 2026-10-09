/**
 * What a build that produced no letter records about itself.
 *
 * `failure_code` says the kind of outcome and existing readers branch on it,
 * so its values do not change here. `outcome_detail` says which exit it was
 * (five different skips share `no_bank_eligible_facts`) and what the gate
 * saw; `failure_signature` is the grouping key the failure-classes SQL and
 * the alerts count by. A letter has no signature; its `outcome_detail` holds
 * what the writer argued from.
 *
 * docs/plans/defence-package-failure-classes.plan.md, Phase 0a.
 */

/** Which exit skipped the build. */
export type SkipExit =
  /** Enqueue: Shopify Protect covers the dispute (`enqueue.ts`). */
  | "covered_shopify"
  /** The job's classifier found the pack ineligible. */
  | "classifier_ineligible"
  /** Fatal-loss gate: structurally unwinnable. */
  | "fatal_loss"
  /** The argument plan holds no safe argument after its exclusions. */
  | "no_safe_argument"
  /** Only the store's own records (policies, the order) survived. */
  | "record_context_only"
  /** Scoping the facts to the bank's claim left nothing that answers it. */
  | "claim_scoped_empty";

export const SKIP_REASON: Record<SkipExit, string> = {
  covered_shopify: "Coverage gate: Shopify Protect is underwriting this dispute.",
  classifier_ineligible: "No bank-eligible approved facts after classification.",
  fatal_loss: "The case is structurally unwinnable (fatal-loss gate); no document is built.",
  no_safe_argument: "The argument plan holds no safe argument after its exclusions.",
  record_context_only: "Only the store's own records (policies, the order) are citable; they are context, not an argument.",
  claim_scoped_empty: "After scoping the facts to the bank's claim, nothing is left that answers it.",
};

/** Approved facts by category: what the gate had in front of it. */
export function factCountsByCategory(facts: ReadonlyArray<{ category: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of facts) out[f.category] = (out[f.category] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** The kind of model or transport error behind an `llm_error`. */
export function llmErrorClass(reason: string): "json_parse" | "api_4xx" | "api_5xx" | "timeout" | "other" {
  if (/\bJSON\b|Unexpected token|Expected '.*' or/i.test(reason)) return "json_parse";
  const api = reason.match(/\bAPI error (\d)\d\d\b/i);
  if (api) return api[1] === "4" ? "api_4xx" : "api_5xx";
  if (/\b(?:timed? ?out|timeout|ETIMEDOUT|aborted)\b/i.test(reason)) return "timeout";
  return "other";
}

/**
 * The grouping key for a non-letter outcome. Parts are joined with " · ";
 * absent parts are dropped, so the key only ever narrows as more is known.
 */
export function failureSignature(args: {
  code: string;
  moduleKey?: string | null;
  brief?: string | null;
  paymentFamily?: string | null;
  /** A skip's exit, an llm_error's class, or a validator's first rule. */
  detail?: string | null;
  /** Counsel check rule ids (order does not matter). */
  rules?: readonly string[];
}): string {
  const rules = [...new Set(args.rules ?? [])].sort().join(",");
  return [args.code, args.moduleKey, args.brief, args.paymentFamily, args.detail, rules || null]
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .join(" · ");
}
