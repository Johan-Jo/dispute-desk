/**
 * Dimensions 7–9 — AUTOMATION, INTEGRATION, DEADLINE.
 *
 * Spec: docs/plans/label-fact-divergence.plan.md §3.5.
 *
 * Three small resolvers sharing one rule: a claim about what the system WILL
 * do, or about what a merchant CAN reach, must name the fact that makes it
 * true. Each produced a merchant-visible falsehood in prod:
 *
 *   - "DisputeDesk reassesses the case automatically before the response
 *     deadline — nothing is needed from you", rendered while
 *     shop_settings.auto_build_enabled was false and every pipeline run for
 *     that shop exited at `skipped_auto_build_off`.
 *   - The Gorgias communication card, rendered for shops that have no
 *     integrations row at all (only one prod shop has Gorgias connected).
 *   - "This is taking longer than expected. It may be waiting behind other
 *     work", rendered while the shop had zero other queued or running jobs.
 */

/* ── Automation ─────────────────────────────────────────────────────── */

export type AutomationPromise =
  | { kind: "unknown" }
  /** Auto-build is off, or a blocker stands. NO recovery promise may render. */
  | { kind: "will_not_run"; blockers: readonly string[] }
  /** Enabled and unblocked — but see the note below on what this licenses. */
  | { kind: "may_run" };

export interface ResolveAutomationInput {
  /** Did the settings read succeed? */
  readOk: boolean;
  /** `shop_settings.auto_build_enabled`. Null when unread. */
  autoBuildEnabled: boolean | null;
  /** Blockers from the existing automation decision owner (quota, billing,
   *  coverage, fatal-loss …). Empty array = none observed. */
  blockers: readonly string[];
}

/**
 * Plan §3.5: "Enabled alone is not a promise that work will execute."
 *
 * So the affirmative case is `may_run`, never `scheduled`. Copy built on
 * this must describe the SETTING ("auto-build is on for this shop") and must
 * not guarantee recovery for a specific case — which is exactly the promise
 * that failed on Mein Maison, where auto-build being on still left 24 open
 * disputes untouched because nothing sweeps a backlog.
 */
export function resolveAutomationPromise(input: ResolveAutomationInput): AutomationPromise {
  if (!input.readOk || input.autoBuildEnabled === null) return { kind: "unknown" };
  if (!input.autoBuildEnabled) return { kind: "will_not_run", blockers: ["auto_build_off"] };
  if (input.blockers.length > 0) return { kind: "will_not_run", blockers: input.blockers };
  return { kind: "may_run" };
}

/** Only `may_run` may license "we will look at this again" copy. */
export function mayPromiseAutomaticWork(p: AutomationPromise): boolean {
  return p.kind === "may_run";
}

/* ── Integration availability ───────────────────────────────────────── */

export type IntegrationAvailability =
  | "unknown"
  | "never_connected"
  | "connected"
  | "reconnect_required"
  | "disconnected_with_history";

export interface ResolveIntegrationInput {
  readOk: boolean;
  /** `integrations.status` for the provider, or null when no row exists. */
  status: string | null;
  /** Does stored evidence from this provider exist for the case? */
  hasHistoricalEvidence: boolean;
}

/**
 * Plan §3.5: distinguish never-connected from reconnect-required, and
 * "do not hide everything whenever status is not connected" — a shop that
 * disconnected still has historical evidence worth showing.
 */
export function resolveIntegrationAvailability(
  input: ResolveIntegrationInput,
): IntegrationAvailability {
  if (!input.readOk) return "unknown";
  if (input.status === null) {
    // No row at all. Historical evidence without a row is contradictory —
    // report unknown rather than inventing either explanation.
    return input.hasHistoricalEvidence ? "unknown" : "never_connected";
  }
  if (input.status === "connected") return "connected";
  if (input.status === "reconnect_required" || input.status === "invalid_credentials") {
    return "reconnect_required";
  }
  return input.hasHistoricalEvidence ? "disconnected_with_history" : "never_connected";
}

/** The live review card renders only when the integration can serve it. */
export function mayRenderLiveIntegrationCard(a: IntegrationAvailability): boolean {
  return a === "connected";
}

/** Never-connected shops get nothing; every other non-connected state keeps
 *  its own guidance rather than being silently hidden. */
export function mayRenderIntegrationGuidance(a: IntegrationAvailability): boolean {
  return a === "reconnect_required" || a === "disconnected_with_history";
}

/* ── Processing delay ───────────────────────────────────────────────── */

export type DelayCause = "unknown" | "elapsed_only" | "queue_backlog";

export interface ResolveDelayInput {
  /** Did the queue read succeed? */
  queueReadOk: boolean;
  /** Other queued/running jobs for this shop, EXCLUDING this case's own. */
  otherActiveJobCount: number | null;
  elapsedMs: number;
  thresholdMs: number;
}

/**
 * Plan §3.5: "state elapsed time unless actual job/queue observations
 * establish a cause."
 *
 * `queue_backlog` requires a successful read AND a positive count. Anything
 * else is `elapsed_only` — it is taking a while, and we do not say why.
 */
export function resolveDelayCause(input: ResolveDelayInput): DelayCause {
  if (input.elapsedMs < input.thresholdMs) return "unknown";
  if (!input.queueReadOk || input.otherActiveJobCount === null) return "elapsed_only";
  return input.otherActiveJobCount > 0 ? "queue_backlog" : "elapsed_only";
}

/* ── Deadline ───────────────────────────────────────────────────────── */

export interface DeadlineFacts {
  /** Absolute instant, for the exact date/time display. */
  dueAtIso: string | null;
  msRemaining: number | null;
  passed: boolean | null;
}

/**
 * Plan §3.5: resolve deadline facts ONCE from `due_at` and an injected `now`,
 * so the calendar label and the countdown are derived from the same instant.
 * They may legitimately use different units — the requirement is a single
 * source, not identical wording.
 *
 * `now` is injected rather than read from the clock so a deadline crossing a
 * timezone or day boundary is testable.
 */
export function resolveDeadlineFacts(dueAtIso: string | null, now: Date): DeadlineFacts {
  if (!dueAtIso) return { dueAtIso: null, msRemaining: null, passed: null };
  const due = Date.parse(dueAtIso);
  if (Number.isNaN(due)) return { dueAtIso: null, msRemaining: null, passed: null };
  const ms = due - now.getTime();
  return { dueAtIso, msRemaining: ms, passed: ms < 0 };
}

/* ── Claim constructors ─────────────────────────────────────────────── */

/**
 * The delay note's copy, chosen by observed cause — plan §4.
 *
 * Lives here rather than at the render site because this is a CLAIM: the
 * `queue_backlog` variant asserts a fact about the job queue, and the
 * ownership invariant must be able to prove no surface constructs it without
 * having observed one. A component with no queue observation resolves
 * `elapsed_only` and can only say how long it has been.
 */
export function delayNoteKey(cause: DelayCause): "status.queuedNote" | "status.takingLongerNote" {
  return cause === "queue_backlog" ? "status.queuedNote" : "status.takingLongerNote";
}
