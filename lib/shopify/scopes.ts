/**
 * Scope reconciliation for the installed base.
 *
 * When the app adds a new OAuth scope, already-installed shops keep
 * their old grant — Shopify only re-prompts when an OAuth flow runs and
 * detects a mismatch. We therefore compare each shop's *granted* scopes
 * (stored on its offline session) against the *required* scopes (what
 * the app now requests via SHOPIFY_SCOPES) and, when any are missing,
 * surface a re-auth banner whose CTA runs OAuth again. The merchant
 * approves the new permissions in Shopify's consent screen — no
 * uninstall/reinstall needed.
 *
 * SHOPIFY_SCOPES is the single source of truth (it's the exact `scope=`
 * sent in the OAuth URL — see lib/shopify/auth.ts buildAuthUrl), and a
 * vitest drift guard keeps it in lockstep with shopify.app.*.toml.
 */

/** Parse a comma-separated scope string into a normalized, de-duped set
 *  of trimmed scope names (empties removed). */
export function parseScopes(scopes: string | null | undefined): string[] {
  if (!scopes) return [];
  return Array.from(
    new Set(
      scopes
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

/** The scopes the app currently requires, from SHOPIFY_SCOPES. */
export function getRequiredScopes(): string[] {
  return parseScopes(process.env.SHOPIFY_SCOPES);
}

/**
 * Does the granted set satisfy a single required scope?
 *
 * Shopify CONSOLIDATES read/write pairs: granting `write_X` implies
 * `read_X`, and Shopify returns only the `write_X` spelling in the
 * granted set — it never echoes the implied `read_X`. So a required
 * `read_X` is satisfied by a granted `read_X` OR a granted `write_X`.
 * (The reverse does NOT hold: `read_X` does not imply `write_X`.)
 *
 * Without this, requiring `read_shopify_payments_dispute_evidences`
 * while Shopify grants `write_shopify_payments_dispute_evidences` makes
 * the scope look permanently missing → the re-auth banner re-fires after
 * every approval → infinite approve loop (observed on prod 2026-06-15).
 */
function isScopeSatisfied(required: string, granted: Set<string>): boolean {
  if (granted.has(required)) return true;
  if (required.startsWith("read_")) {
    const writeEquivalent = "write_" + required.slice("read_".length);
    if (granted.has(writeEquivalent)) return true;
  }
  return false;
}

/**
 * Scopes the app requires but the granted set does not satisfy (honoring
 * Shopify's write-implies-read consolidation, see isScopeSatisfied).
 * Returns [] when the grant already covers everything required (or when
 * required scopes can't be resolved — fail open so we never nag on a
 * misconfigured env).
 */
export function findMissingScopes(
  grantedScopes: string | null | undefined,
  requiredScopes: string[] = getRequiredScopes(),
): string[] {
  if (!requiredScopes.length) return [];
  const granted = new Set(parseScopes(grantedScopes));
  return requiredScopes.filter((s) => !isScopeSatisfied(s, granted));
}
