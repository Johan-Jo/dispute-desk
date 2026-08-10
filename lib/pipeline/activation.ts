/**
 * The canonical pipeline's activation switch. ONE owner, default OFF.
 *
 * ── WHY A SWITCH AT ALL ───────────────────────────────────────────────
 *
 * PR 2 wires the canonical argument plan, package projection, deterministic
 * document validation and `selectFileablePackage` into the REAL production
 * entry points — the defence build, the pack pipeline, the held-state
 * resolver, the reconcile pass and the deadline cron. Load-bearing, not a
 * parallel implementation waiting to be adopted: with the switch on, the
 * complete canonical route runs and there is no legacy fallback inside it.
 *
 * That is exactly why it must not take effect on merge. The plan of record
 * (§9.2) delivers PR 2 **dark**: production keeps its current ladders while
 * the canonical route is reviewed and replayed, and only PR 3 flips this
 * constant and deletes the legacy paths. Merging a fully wired canonical
 * route with no switch would make the merge itself the cutover — with the
 * pre-activation rebuild (§9.3) not yet run, so every open case would be
 * `snapshot_absent` and therefore non-fileable on the first cron tick.
 *
 * ── WHAT "OFF" GUARANTEES ─────────────────────────────────────────────
 *
 * Byte-for-byte the ladders that shipped at the kickoff baseline. Each
 * gated site keeps its legacy implementation in a `*.legacy.ts` module,
 * moved verbatim rather than re-expressed, and dispatches to it at the top
 * of the function. "Behaviour-preserving because the mapping is faithful"
 * is an argument; "the same code runs" is a fact, and only the second one
 * survives a reviewer who does not trust the mapping.
 *
 * PR 3 deletes those modules and this file's `false` branch together.
 *
 * ── WHY AN ENV VAR AND NOT A DB SETTING ───────────────────────────────
 *
 * A per-shop flag would make the dark period a partial rollout, and a
 * partial rollout of a route whose whole point is that ONE decision is read
 * everywhere reintroduces the divergence this pipeline exists to end. The
 * switch is fleet-wide and deployment-scoped on purpose.
 *
 * Reading `process.env` per call rather than at module load is deliberate:
 * a captured boolean would freeze whatever the value was when the first
 * import happened, which in vitest is whichever suite ran first.
 */

/**
 * The env var. Exactly `"on"` enables; anything else — unset, empty,
 * `"true"`, `"1"`, a typo — is off.
 *
 * Deliberately not truthy-coerced. `CANONICAL_PIPELINE=0` reading as ON,
 * because `"0"` is a non-empty string, is the class of bug that turns a
 * dark deploy into a live one.
 */
export const CANONICAL_PIPELINE_ENV = "CANONICAL_PIPELINE";

/** The one value that activates. */
export const CANONICAL_PIPELINE_ON = "on";

/**
 * Is the canonical route live?
 *
 * Every gated call site asks this and nothing else. A second predicate —
 * "…unless the shop is on the pilot list", "…or when a plan already exists"
 * — is how a switch stops being a switch.
 */
export function canonicalPipelineEnabled(): boolean {
  return process.env[CANONICAL_PIPELINE_ENV] === CANONICAL_PIPELINE_ON;
}

/**
 * Run `fn` with the canonical route on, then restore the previous value.
 *
 * For tests only, and exported from `lib/` rather than a test helper so the
 * production predicate and the test's way of flipping it cannot drift.
 * Restores the ORIGINAL value (including "was unset") rather than deleting,
 * so a suite that runs with the switch already on is not silently turned
 * off by a nested call.
 */
export async function withCanonicalPipeline<T>(fn: () => Promise<T> | T): Promise<T> {
  const previous = process.env[CANONICAL_PIPELINE_ENV];
  process.env[CANONICAL_PIPELINE_ENV] = CANONICAL_PIPELINE_ON;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[CANONICAL_PIPELINE_ENV];
    else process.env[CANONICAL_PIPELINE_ENV] = previous;
  }
}

/** The mirror image, for the legacy-preservation half of every gated test. */
export async function withLegacyPipeline<T>(fn: () => Promise<T> | T): Promise<T> {
  const previous = process.env[CANONICAL_PIPELINE_ENV];
  delete process.env[CANONICAL_PIPELINE_ENV];
  try {
    return await fn();
  } finally {
    if (previous !== undefined) process.env[CANONICAL_PIPELINE_ENV] = previous;
  }
}
