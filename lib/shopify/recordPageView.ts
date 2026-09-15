/**
 * Records embedded-app page views into `shop_page_views`.
 *
 * WHY THIS EXISTS. `audit_events` records actions, and the dominant merchant
 * behaviour is not acting — it is looking. Mein Maison logged in at 06:53 UTC
 * on 2026-09-15, browsed, and left; asked what they did, the database could
 * answer only with automation rows and our own script runs. Viewing left no
 * trace anywhere durable. (Vercel runtime logs do capture it, but they expire
 * in about a day and cannot be queried per shop.)
 *
 * BOTH ACTORS ARE RECORDED. Merchant sessions and admin View-as-merchant
 * sessions both land here, labelled. Logging only merchants would make the
 * table lie by omission: "no rows for this page" would read as "the merchant
 * never opened it" when it could equally mean "we opened it and did not record
 * it". Indistinguishable absence is precisely the defect the actor-attribution
 * work (migration 20260915120000) was opened to fix.
 *
 * Called from a page render, so — like `recordLastLogin`, whose shape this
 * follows — it must never block the merchant's page load and never throw into
 * the render. The caller does not await it.
 *
 * NO THROTTLE, deliberately. `recordLastLogin` throttles to once per 5 minutes
 * because it only needs the most recent login; here every view IS the signal,
 * and collapsing repeats would discard the navigation sequence this exists to
 * capture. Measured volume is tens of rows a day platform-wide, so the write
 * cost is immaterial; a 90-day retention sweep keeps it that way as the
 * customer base grows.
 */

import { getServiceClient } from "@/lib/supabase/server";

export type PageViewActor = "merchant" | "admin";

/**
 * Two reporters (server layout + client beacon) can describe one navigation.
 * Anything inside this window for the same shop+path+actor is treated as the
 * same view rather than a second one.
 */
const DEDUP_WINDOW_MS = 5000;

/** UUID anywhere in the path — how a dispute id appears in /app/disputes/<id>. */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Collapse concrete ids into the Next.js route pattern so aggregate queries
 * group sanely instead of producing one bucket per dispute.
 *
 * Demo-mode paths (`/app/disputes/dp-2403`) normalise too: they are not real
 * disputes, and leaving them concrete would scatter fixture traffic across the
 * route breakdown — which is exactly how an earlier volume estimate in this
 * feature's own plan came to count demo fixtures as merchant page views.
 */
export function normaliseRoute(path: string): string {
  return path
    .split("?")[0]
    .replace(UUID_RE, "[id]")
    .replace(/\/dp-[\w-]+/i, "/[id]");
}

/** The dispute id in the path, when there is one. */
export function extractDisputeId(path: string): string | null {
  const m = path.match(UUID_RE);
  return m ? m[0].toLowerCase() : null;
}

/**
 * Fire-and-forget. Resolves the shop by domain (the caller has the verified
 * `shopDomain` from the session token, not an internal id) and inserts one row.
 */
export function recordPageView(params: {
  shopDomain?: string | null;
  shopId?: string | null;
  actorType: PageViewActor;
  actorId?: string | null;
  path: string;
}): void {
  void recordPageViewAsync(params).catch((err) => {
    console.warn(
      "[recordPageView] failed",
      err instanceof Error ? err.message : err,
    );
  });
}

async function recordPageViewAsync({
  shopDomain,
  shopId,
  actorType,
  actorId,
  path,
}: {
  shopDomain?: string | null;
  shopId?: string | null;
  actorType: PageViewActor;
  actorId?: string | null;
  path: string;
}): Promise<void> {
  if (!path) return;

  const db = getServiceClient();
  const cleanPath = path.split("?")[0];

  // Impersonation gives us the internal id directly (middleware injects
  // `x-shop-id`); the merchant path gives a domain from the session token.
  let resolvedShopId = shopId ?? null;
  if (!resolvedShopId) {
    if (!shopDomain) return;
    const { data } = await db
      .from("shops")
      .select("id")
      .eq("shop_domain", shopDomain)
      .maybeSingle();
    if (!data) return;
    resolvedShopId = data.id;
  }

  // Dedup. The server layout and the client beacon both fire for a navigation
  // that reaches the server, so the same (shop, path) can arrive twice within
  // milliseconds. Suppress a repeat inside a short window: a page genuinely
  // revisited seconds later is indistinguishable from a double-report, and
  // over-counting a view is still a false record.
  const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
  const { data: recent } = await db
    .from("shop_page_views")
    .select("id")
    .eq("shop_id", resolvedShopId)
    .eq("path", cleanPath)
    .eq("actor_type", actorType)
    .gte("viewed_at", since)
    .limit(1);
  if (recent && recent.length > 0) return;

  await db.from("shop_page_views").insert({
    shop_id: resolvedShopId,
    actor_type: actorType,
    actor_id: actorId ?? null,
    path: cleanPath,
    route: normaliseRoute(path),
    dispute_id: extractDisputeId(path),
  });
}
