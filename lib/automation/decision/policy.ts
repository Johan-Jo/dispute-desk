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
 * P-7: blume-box activates at completeness threshold 60. The shop-level
 * `auto_save_min_score` still overrides this; 60 is the value used when a shop
 * carries none, and the value the contract fixtures are calibrated against.
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
