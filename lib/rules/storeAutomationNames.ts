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
