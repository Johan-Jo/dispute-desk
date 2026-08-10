/**
 * The automation policy — every knob the canonical decision reads, versioned.
 *
 * WHY A VERSION. `SnapshotFreshness.policyVersion` invalidates a stored
 * decision when the rules move even though the inputs did not. Without it a
 * threshold change would leave every persisted decision claiming to be current
 * while encoding the previous policy. Bump `AUTOMATION_POLICY_VERSION` whenever
 * a change to this file, or to `deriveCaseAutomationDecision`, can change an
 * action or a reason code for unchanged inputs.
 *
 * WHAT IS DELIBERATELY NOT HERE. No clock, no window, no "days remaining". The
 * policy is time-invariant for the same reason the decision is: see the
 * invariant in `lib/pipeline/contracts/automationDecision.ts`.
 */

/** Bump on any change that can move an action or reason code. */
export const AUTOMATION_POLICY_VERSION = 1;

/** Bumped when the SHAPE of the decision snapshot changes. */
export const AUTOMATION_DECISION_VERSION = 1;

/**
 * The threshold used when a shop carries no `auto_save_min_score` at all, and
 * the value the contract fixtures are written against.
 *
 * ── THIS IS NOT P-7 ───────────────────────────────────────────────────
 *
 * It said so until the CP-A integration, and the claim was wrong in both
 * directions: it applied 60 to EVERY shop with an absent setting, none of which
 * was calibrated, and it gave blume-box their own `auto_save_min_score` rather
 * than 60 whenever the setting was present — the opposite of the activation.
 * Worse, it paired that 60 with the persisted legacy score, which is the one
 * pairing `resolveEffectiveCompleteness` exists to make unrepresentable.
 *
 * P-7 has exactly one owner: `lib/evidence/model/completenessActivation.ts`.
 * Executors resolve the pair there and hand it to `decideForPack` as
 * `completeness`, which replaces this default. A second copy of the rule here
 * would be a second answer, and the two would disagree on precisely the packs
 * the rollout is about.
 */
export const DEFAULT_COMPLETENESS_THRESHOLD = 60;

export interface AutomationPolicy {
  /** Must equal `AUTOMATION_POLICY_VERSION` for a snapshot to be current. */
  version: number;
  /** Shop setting `auto_save_enabled`. */
  autoSaveEnabled: boolean;
  /** Shop setting `auto_save_min_score`, or `DEFAULT_COMPLETENESS_THRESHOLD`. */
  completenessThreshold: number;
  /** Shop setting `enforce_no_blockers`. */
  enforceNoBlockers: boolean;
}

export function automationPolicyFromSettings(settings: {
  auto_save_enabled: boolean;
  auto_save_min_score: number | null | undefined;
  enforce_no_blockers: boolean;
}): AutomationPolicy {
  const raw = settings.auto_save_min_score;
  return {
    version: AUTOMATION_POLICY_VERSION,
    autoSaveEnabled: settings.auto_save_enabled,
    completenessThreshold:
      typeof raw === "number" && Number.isFinite(raw)
        ? raw
        : DEFAULT_COMPLETENESS_THRESHOLD,
    enforceNoBlockers: settings.enforce_no_blockers,
  };
}
