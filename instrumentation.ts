/**
 * Next.js 15 instrumentation hook. Runs once per server process at startup
 * (both Node-runtime serverless functions and the edge middleware runtime
 * trigger this, although only the Node runtime exposes the secrets the
 * runtime-identity check needs).
 *
 * We funnel through lib/env/bootstrap.ts so the same idempotent check runs
 * from every server entry point (instrumentation, middleware side-effect
 * import, and CLI scripts).
 *
 * Reference: docs/plans/dev-prod-environment-split.plan.md §6.1b.
 */

export async function register() {
  // Only validate in the Node runtime — edge boots its own import path
  // via middleware.ts. The bootstrap module is idempotent so duplicate
  // invocations are no-op, but we'd rather not pull the secret-shape
  // check into the edge runtime where SUPABASE_SERVICE_ROLE_KEY etc.
  // aren't available anyway.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/env/bootstrap");
  }
}
