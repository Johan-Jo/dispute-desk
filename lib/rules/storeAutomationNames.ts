/**
 * The setup-owned `rules.name` vocabulary.
 *
 * Split out of `storeAutomation.ts` so `automationGroups.ts` can build group
 * names from the same prefix without importing the read/write module (which
 * imports the group model in turn — a cycle). Names only; no behaviour.
 *
 * `storeAutomation.ts` re-exports these, so existing imports keep working.
 */

export const SETUP_RULE_PREFIX = "__dd_setup__:";
export const FALLBACK_RULE_NAME = `${SETUP_RULE_PREFIX}fallback:default`;
export const SAFEGUARD_RULE_NAME = `${SETUP_RULE_PREFIX}safeguard:high_value`;

/**
 * The name the embedded Automation page used to write its safeguard under.
 * Read + delete only — never written again.
 */
export const LEGACY_SAFEGUARD_RULE_NAME = "__dd_safeguard__:high_value";

/**
 * True for any rule the setup/automation surfaces own — and therefore any rule
 * a merchant must never see in a "custom rules" list, let alone edit or delete.
 *
 * Lives HERE, in the names-only module, rather than in `storeAutomation.ts`,
 * because both rules pages are client components and `storeAutomation.ts`
 * imports the Supabase **server** client. That is why the embedded page carried
 * its own copy of this predicate and the portal page carried none at all — so
 * `__dd_setup__:fallback:default`, the store-wide switch itself, rendered in
 * the portal as an unnamed, editable, deletable rule.
 */
export function isSetupOwnedRuleName(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.startsWith(SETUP_RULE_PREFIX) || name === LEGACY_SAFEGUARD_RULE_NAME;
}
