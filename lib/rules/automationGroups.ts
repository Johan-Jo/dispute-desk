/**
 * Automation groups — optional per-dispute-type overrides layered on top of
 * the store-wide switch.
 *
 * A group is nothing more than ONE `rules` row whose `match.reason` lists the
 * group's Shopify reason codes. That makes it structurally **tier-1** in
 * `pickAutomationAction`: it always beats the tier-2 catch-all (the store
 * switch) and can never outrank the tier-0 amount safeguard, because tiers are
 * evaluated in order and return immediately. No schema change, no migration.
 *
 * **Absence of a row means "inherit the store switch"** — not "review".
 *
 * Groups are deliberately PHASE-BLIND (`match.reason` only, no `match.phase`):
 * "Fraud → Auto" reads as "handle fraud this way", and inquiry-vs-chargeback is
 * an internal lifecycle concept this control doesn't expose. A merchant who
 * needs the finer cut writes a custom rule, which supports `match.phase` and
 * wins over a group at equal priority (`pickAutomationAction` ranks
 * phase-specific above phase-blind).
 */

import { SETUP_RULE_PREFIX } from "./storeAutomationNames";

export type AutomationGroupId =
  | "fraud"
  | "pnr"
  | "not_as_described"
  | "subscription"
  | "refund"
  | "duplicate";

export interface AutomationGroup {
  id: AutomationGroupId;
  /** Shopify reason codes this group routes. Written into `match.reason`. */
  reasons: string[];
  /** i18n key under the `rules` namespace. */
  labelKey: string;
  /**
   * Locked groups can never auto-submit: `evaluateAutoSubmitGuards` overrides
   * the setting unconditionally, so offering the control would be a lie. No
   * rule row is ever written for a locked group, `readStoreAutomation` never
   * surfaces one, and the API rejects attempts to set one.
   */
  locked: boolean;
  /** i18n key explaining WHY it is locked. Only set when locked. */
  lockedReasonKey?: string;
}

export const AUTOMATION_GROUPS: readonly AutomationGroup[] = [
  {
    id: "fraud",
    // UNRECOGNIZED is mandatory here: `resolveReasonFamily` maps it to the
    // fraud family, so it is SCORED with the fraud formula. It is also missing
    // from the custom-rule modal's reason list, so a merchant cannot cover it
    // themselves — leaving it out would silently strand every such dispute on
    // the catch-all.
    reasons: ["FRAUDULENT", "UNRECOGNIZED"],
    labelKey: "groupFraud",
    locked: false,
  },
  {
    id: "pnr",
    reasons: ["PRODUCT_NOT_RECEIVED"],
    labelKey: "groupPnr",
    locked: false,
  },
  {
    id: "not_as_described",
    // NOT the legacy `NOT_AS_DESCRIBED` alias — a synced dispute never carries
    // it (see ALIAS_TO_DISPUTE_TYPE in ./disputeTypes.ts).
    reasons: ["PRODUCT_UNACCEPTABLE"],
    labelKey: "groupNotAsDescribed",
    // `evaluateAutoSubmitGuards` parks product-family cases even when Strong.
    // Setting this group to auto would write a rule the engine ignores 100% of
    // the time. Pinned by a test that asserts the guard still behaves this way.
    locked: true,
    lockedReasonKey: "groupNotAsDescribedLocked",
  },
  {
    id: "subscription",
    // Double L — Shopify's enum spelling. See lib/rules/disputeReasons.ts.
    reasons: ["SUBSCRIPTION_CANCELLED"],
    labelKey: "groupSubscription",
    locked: false,
  },
  {
    id: "refund",
    reasons: ["CREDIT_NOT_PROCESSED"],
    labelKey: "groupRefund",
    locked: false,
  },
  {
    id: "duplicate",
    reasons: ["DUPLICATE"],
    labelKey: "groupDuplicate",
    locked: false,
  },
] as const;

/**
 * Priority 50 — between the tier-0 safeguard (5) and the fallback (100 000).
 *
 * This number matters LESS than it looks: `pickAutomationAction` checks tiers
 * before priority, so a group rule can never outrank the safeguard whatever
 * number it carries. 50 only breaks ties against other tier-1 (reason) rules,
 * i.e. merchant custom rules — which default to lower numbers and therefore
 * win, as they should.
 */
export const GROUP_RULE_PRIORITY = 50;

const GROUP_RULE_PREFIX = `${SETUP_RULE_PREFIX}group:`;

export function groupRuleName(id: AutomationGroupId): string {
  return `${GROUP_RULE_PREFIX}${id}`;
}

export function parseGroupRuleName(
  name: string | null | undefined,
): AutomationGroupId | null {
  if (!name || !name.startsWith(GROUP_RULE_PREFIX)) return null;
  const id = name.slice(GROUP_RULE_PREFIX.length) as AutomationGroupId;
  return AUTOMATION_GROUPS.some((g) => g.id === id) ? id : null;
}

export function findGroup(id: string): AutomationGroup | undefined {
  return AUTOMATION_GROUPS.find((g) => g.id === id);
}

/**
 * Every group row name, **locked ones included**.
 *
 * Writes never create a locked group's row, but the delete list must still
 * name it: a row written by an older build or by hand would otherwise survive
 * forever and route disputes through a control the UI doesn't show.
 */
export const ALL_GROUP_RULE_NAMES: readonly string[] = AUTOMATION_GROUPS.map(
  (g) => groupRuleName(g.id),
);

/** Per-group override. Absence from the map == inherit the store switch. */
export type GroupOverrides = Partial<Record<AutomationGroupId, "auto" | "review">>;
