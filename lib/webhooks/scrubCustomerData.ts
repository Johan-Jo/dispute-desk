/**
 * Pure helper for `customers/redact` GDPR webhook.
 *
 * Recursively scrubs customer-identifiable fields (email + first/last
 * name + display name) from a JSONB blob (typically `pack_json` from
 * the evidence_packs table) when they match the redact target's
 * email or name.
 *
 * Conservative match rules:
 *   - Email matches: exact, case-insensitive (`a@b.com` === `A@B.COM`).
 *   - Name matches: exact whole-string, case-insensitive. Substring
 *     matches are deliberately NOT redacted to avoid false positives
 *     (a "John" in product description text is not the customer "John
 *     Smith"). Shopify's redact webhook always supplies the full name
 *     when it has one.
 *
 * Returns a NEW object — does not mutate the input.
 */

const SCRUBBABLE_KEYS = new Set([
  "email",
  "customerEmail",
  "customer_email",
  "billingEmail",
  "shippingEmail",
  "name",
  "customerName",
  "customer_name",
  "customerDisplayName",
  "customer_display_name",
  "fullName",
  "first_name",
  "last_name",
  "firstName",
  "lastName",
]);

const REDACTED_VALUE = "[redacted]";

export interface ScrubTarget {
  email: string | null;
  name: string | null;
}

/** True iff `candidate` matches the redact target's email or name
 *  (case-insensitive, whole-string). Empty inputs never match. */
function valueMatches(candidate: unknown, target: ScrubTarget): boolean {
  if (typeof candidate !== "string") return false;
  const c = candidate.trim().toLowerCase();
  if (c.length === 0) return false;
  if (target.email && c === target.email.trim().toLowerCase()) return true;
  if (target.name && c === target.name.trim().toLowerCase()) return true;
  return false;
}

/**
 * Walk `value` recursively. When a key is in `SCRUBBABLE_KEYS` AND
 * its string value matches the target, replace with `[redacted]`.
 * Other values are passed through unchanged.
 *
 * Arrays + nested objects are walked. Non-string scalars are returned
 * as-is. Cycles are not supported (Shopify pack_json is a tree, never
 * a graph).
 */
export function scrubCustomerData<T>(value: T, target: ScrubTarget): T {
  if (!target.email && !target.name) return value;
  return walk(value, target) as T;
}

function walk(value: unknown, target: ScrubTarget): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => walk(v, target));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (SCRUBBABLE_KEYS.has(key) && valueMatches(v, target)) {
        out[key] = REDACTED_VALUE;
      } else {
        out[key] = walk(v, target);
      }
    }
    return out;
  }
  return value;
}
