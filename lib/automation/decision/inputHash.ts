/**
 * The decision's input hash.
 *
 * THE ONE RULE. Only result-bearing inputs go in, and the serialisation is
 * canonical (keys sorted, no ambient values). Two consequences, both load-
 * bearing and both pinned by test:
 *
 *   - Evaluating the same case at two different clock times produces the same
 *     hash. Nothing derived from `Date.now()` may reach this function.
 *   - Changing the ABSOLUTE evidence due date changes the hash, because a
 *     different deadline is a different case. What may never enter is a
 *     RELATIVE time state — "3 days left", "window open" — which is exactly how
 *     a hash starts drifting on its own.
 *
 * The hash is opaque (`InputHash`): never parsed, never ordered by, never
 * compared part-wise. `evaluateFreshness` is the only consumer.
 */

// Bare `crypto`, not `node:crypto`, and it matters. `lib/rules/storeAutomation.ts`
// is imported by the embedded Rules page ("use client"), and it reaches this
// module through `reconcileParkedAutoDisputes`. Webpack refuses a `node:`-prefixed
// builtin anywhere in a client graph and only shims the bare specifier — the
// same reason `lib/evidence/model/derive.ts` imports it this way.
import { createHash } from "crypto";
import type { InputHash } from "@/lib/pipeline/contracts";

/**
 * Canonical JSON: object keys sorted at every depth, arrays left in order
 * (array order is meaningful), `undefined` dropped so an absent key and an
 * explicitly-undefined key hash identically.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value === undefined ? null : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src).sort()) {
    if (src[key] === undefined) continue;
    out[key] = canonicalize(src[key]);
  }
  return out;
}

/** SHA-256 over the canonical form. Stable across processes and machines. */
export function hashDecisionInputs(inputs: unknown): InputHash {
  return createHash("sha256").update(canonicalJson(inputs)).digest("hex");
}
