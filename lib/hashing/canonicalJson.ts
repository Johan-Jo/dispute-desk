/**
 * Deterministic JSON canonicalisation for content hashing.
 *
 * Extracted from `lib/defence/computeEvidenceHash.ts` (2026-08-30) so that
 * post-outcome analysis snapshots hash through the same routine rather than a
 * second, subtly-different copy. Two hashers that disagree about whether `1`
 * and `"1"` are the same value produce hashes that silently stop matching
 * across a refactor, and nothing fails loudly when they do.
 *
 * The one policy the two callers genuinely differ on is which keys to drop:
 *
 *   - `computeEvidenceHash` drops volatile timestamps, because a fact whose
 *     `updated_at` moved is still the same fact and must not trigger a rebuild.
 *   - A post-outcome source snapshot drops NOTHING. Its timestamps ARE the
 *     evidence — "approved before submission" versus "arrived after" is the
 *     distinction the whole analysis turns on (plan §5). Dropping `created_at`
 *     there would erase the difference between an omission and a late arrival.
 *
 * So the drop set is a parameter, not a constant. Everything else — recursive
 * key sorting, number-to-string normalisation, null/undefined elision — is
 * shared and must stay shared.
 */

import { createHash } from "node:crypto";

/** Timestamp keys that mean "when we touched the row", not "what the row says". */
export const VOLATILE_TIMESTAMP_KEYS = new Set([
  "created_at",
  "createdAt",
  "updated_at",
  "updatedAt",
  "uploaded_at",
  "uploadedAt",
  "generated_at",
  "generatedAt",
]);

/** Drop nothing — for snapshots, where timestamps are load-bearing evidence. */
export const DROP_NOTHING: ReadonlySet<string> = new Set<string>();

export interface CanonicaliseOptions {
  /** Object keys elided at every depth before hashing. Default: drop nothing. */
  dropKeys?: ReadonlySet<string>;
}

/**
 * Recursively normalise a value into a stable, comparable shape:
 *   - object keys sorted, so insertion order cannot move the hash
 *   - numbers stringified, so `1` and `"1"` agree
 *   - null / undefined elided (a key's absence and its null are the same)
 *   - keys in `dropKeys` removed at every depth
 *
 * Functions, symbols and bigints normalise to null — they should never appear
 * in hashable record data, and silently producing null beats throwing inside a
 * hash routine that callers treat as total.
 *
 * A `Date` is NOT special-cased: it falls through to the object branch and
 * canonicalises to `{}`, exactly as it did before this module was extracted.
 * That is deliberate — special-casing it here would move every existing
 * `evidence_hash` that ever saw one and mark live packages stale. Callers pass
 * ISO strings (which is what Supabase returns anyway); pre-serialise Dates.
 */
export function canonicalise(
  value: unknown,
  options: CanonicaliseOptions = {},
): unknown {
  const dropKeys = options.dropKeys ?? DROP_NOTHING;
  return canonicaliseInner(value, dropKeys);
}

function canonicaliseInner(value: unknown, dropKeys: ReadonlySet<string>): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => canonicaliseInner(v, dropKeys));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>)
      .filter((k) => !dropKeys.has(k))
      .sort();
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v === null || v === undefined) continue;
      out[k] = canonicaliseInner(v, dropKeys);
    }
    return out;
  }
  // function / symbol / bigint — should never appear in hashable data.
  return null;
}

/** Canonical JSON string. Stable across key order, numeric type, and null form. */
export function canonicalJson(
  value: unknown,
  options: CanonicaliseOptions = {},
): string {
  return JSON.stringify(canonicalise(value, options));
}

/** SHA-256 over the canonical JSON, lowercase hex. */
export function sha256Canonical(
  value: unknown,
  options: CanonicaliseOptions = {},
): string {
  return createHash("sha256").update(canonicalJson(value, options)).digest("hex");
}
