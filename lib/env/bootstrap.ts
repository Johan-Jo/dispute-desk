/**
 * Server-startup bootstrap. Invokes runtime-identity validation once per
 * process. Idempotent — repeated imports are no-op after first execution.
 *
 * Entry points:
 *   - instrumentation.ts (Next.js 15 Node-runtime serverless functions)
 *   - middleware.ts side-effect import (edge runtime)
 *   - scripts/run-migration.mjs and scripts/db-push-prod.mjs (CLI)
 *
 * Reference: docs/plans/dev-prod-environment-split.plan.md §6.1b.
 */

import {
  validateRuntimeIdentity,
  RuntimeIdentityError,
  type RuntimeIdentityInput,
} from "./runtime-identity";

let didRun = false;
let lastError: Error | null = null;

/**
 * Run the runtime-identity check exactly once per process. Subsequent calls
 * are no-op. If the first call threw, every subsequent call re-throws the
 * same error (so a misconfigured process can't accidentally "recover").
 */
export function runEnvBootstrap(envOverride?: RuntimeIdentityInput): void {
  if (didRun) {
    if (lastError) throw lastError;
    return;
  }
  didRun = true;

  const env: RuntimeIdentityInput =
    envOverride ?? (process.env as RuntimeIdentityInput);

  try {
    validateRuntimeIdentity(env);
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err));
    // Surface to operator regardless of who imports this — runtime
    // misconfiguration is a deploy-time bug we want loud and immediate.
    console.error(lastError.message);
    throw lastError;
  }
}

// Side-effect import path: importing this module from middleware.ts runs
// the bootstrap automatically at edge boot. instrumentation.ts uses
// runEnvBootstrap() directly so the failure can be surfaced via Next's
// startup error pipeline.
//
// In test environments we skip the auto-run — vitest imports lib/env/* for
// unit testing and shouldn't trigger validation against the developer's
// real shell env.
if (
  typeof process !== "undefined" &&
  process.env.NODE_ENV !== "test" &&
  process.env.VITEST !== "true"
) {
  // Best-effort: catch and log but don't crash on side-effect import path.
  // The thrown error from runEnvBootstrap is already cached in `lastError`,
  // so explicit callers (instrumentation.ts) still see the failure.
  try {
    runEnvBootstrap();
  } catch {
    // already logged inside runEnvBootstrap
  }
}

export { RuntimeIdentityError };
