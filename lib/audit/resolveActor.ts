import { verifyImpersonation } from "@/lib/admin/impersonation";
import type { AuditActorType } from "./logEvent";

/**
 * Resolve WHO is behind a request-scoped write to `audit_events`.
 *
 * WHY THIS EXISTS. A merchant clicking a button and an operator using
 * SuperAdmin "View as merchant" arrive at these routes identically -- same
 * embedded request shape, same shop context. The impersonation cookie is the
 * ONLY thing that distinguishes them, and it carries `adminUserId` explicitly
 * for this purpose.
 *
 * Before 2026-09-15 exactly one route resolved it
 * (app/api/automation/settings/route.ts, added after a merchant's
 * `auto_build_enabled` was found false with no way to tell whether the
 * merchant or one of us turned it off). The other 37 write sites hardcoded
 * `actorType: "merchant"`, so every operator action was recorded as the
 * merchant's own. This helper exists so that fix is applied once rather than
 * re-derived per route -- and so route #39 cannot quietly reintroduce the bug.
 *
 * `actorId` is null for a merchant: the Shopify staff id is not available on
 * the `/api/*` path (middleware forwards `x-shop-id`, not the session token's
 * `sub`). That is a known gap, not an oversight -- `actorType` already answers
 * "was this us or them?", which is the question the audit trail failed.
 */
export async function resolveAuditActor(req?: {
  cookies?: { get(name: string): { value: string } | undefined };
}): Promise<{ actorType: AuditActorType; actorId: string | null }> {
  // Degrade to `merchant` rather than throwing when there is no cookie jar to
  // read. An audit write must never be the reason a merchant's action fails,
  // and some callers (tests, and any non-NextRequest invocation) legitimately
  // have no cookies. Losing the admin/merchant distinction on such a call is
  // strictly better than a 500 on the action itself.
  if (!req?.cookies?.get) return { actorType: "merchant", actorId: null };

  try {
    const imp = await verifyImpersonation(
      req as { cookies: { get(name: string): { value: string } | undefined } },
    );
    return imp
      ? { actorType: "admin", actorId: imp.adminUserId ?? null }
      : { actorType: "merchant", actorId: null };
  } catch {
    return { actorType: "merchant", actorId: null };
  }
}
