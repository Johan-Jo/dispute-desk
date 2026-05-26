/**
 * Cron entrypoint gate.
 *
 * Returns null when the request is authorized to do cron work, otherwise
 * returns the Response the route should short-circuit with:
 *
 *   - CRON_ENABLED !== "true"        → 204 No Content (env-disabled)
 *   - CRON_SECRET unset or mismatched → 401 Unauthorized
 *
 * Every route under app/api/cron/* and app/api/jobs/worker MUST call this
 * before doing any work. A vitest case enforces that requirement by
 * enumerating cron route files and refusing to pass if any does not import
 * + call cronEnvGate.
 *
 * Auth shapes accepted (superset of every existing route's pre-gate auth):
 *   - Authorization: Bearer <CRON_SECRET>
 *   - x-cron-secret: <CRON_SECRET>
 *   - ?secret=<CRON_SECRET>   (query string)
 *
 * Reference: docs/plans/dev-prod-environment-split.plan.md §6.2 + §6.2a.
 */

function unauthorized(reason: string): Response {
  return new Response(JSON.stringify({ error: "Unauthorized", reason }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

export function cronEnvGate(req: Request): Response | null {
  if (process.env.CRON_ENABLED !== "true") {
    // 204 (no content) so Vercel cron treats the invocation as a no-op
    // rather than a failure. Use this in dev where CRON_ENABLED=false.
    return new Response(null, { status: 204 });
  }

  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return unauthorized("CRON_SECRET not configured");
  }

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const xCron = req.headers.get("x-cron-secret") ?? "";
  let querySecret = "";
  try {
    querySecret = new URL(req.url).searchParams.get("secret") ?? "";
  } catch {
    // Tolerate malformed URLs — fall through to the secret mismatch path.
  }

  if (bearer === expected || xCron === expected || querySecret === expected) {
    return null;
  }

  return unauthorized("invalid secret");
}
