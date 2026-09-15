import { NextRequest, NextResponse } from "next/server";
import { recordPageView } from "@/lib/shopify/recordPageView";
import { verifyImpersonation } from "@/lib/admin/impersonation";
import { resolveAuditActor } from "@/lib/audit/resolveActor";

export const runtime = "nodejs";

/**
 * POST /api/page-view   { path: string }
 *
 * Client-side companion to the server-layout recorder.
 *
 * WHY BOTH. The embedded app navigates client-side: `/app/disputes/[id]` is a
 * `"use client"` page reached by a router transition from the list. The server
 * layout DOES re-run for those transitions when the request reaches the server
 * — verified by driving RSC navigations directly — but a real browser inside
 * the Shopify iframe can serve a transition from the router cache without any
 * server round-trip at all, and then nothing records. That is the case that
 * kept producing zero rows for dispute detail pages on 2026-09-15 while every
 * scripted variant recorded correctly.
 *
 * This endpoint is driven by `PageViewBeacon`, so a view is captured whether or
 * not the navigation touched the server.
 *
 * Shop identity comes from the SAME headers middleware already injects — never
 * from the request body. A client-supplied shop id would let any caller write
 * rows against another shop.
 */
export async function POST(req: NextRequest) {
  let body: { path?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const path = typeof body.path === "string" ? body.path : "";
  // Only embedded app paths. Anything else is either a mistake or an attempt
  // to write junk rows.
  if (!path.startsWith("/app")) {
    return NextResponse.json({ error: "bad_path" }, { status: 400 });
  }

  // Same actor resolution as every other request-scoped write -- an admin
  // under View-as-merchant must not be recorded as the merchant. See
  // lib/audit/resolveActor.ts and the invariant in
  // tests/unit/auditActorAttribution.test.ts, which caught this route
  // hardcoding "merchant" on its first version.
  const actor = await resolveAuditActor(req);

  // Impersonation carries the shop on its own cookie; a merchant request gets
  // one injected by middleware. Never from the request body -- a
  // client-supplied shop id would let any caller write rows against another
  // shop.
  const imp = await verifyImpersonation(req);
  const shopId = imp?.shopId ?? req.headers.get("x-shop-id");
  if (!shopId || shopId === "demo") {
    return NextResponse.json({ ok: false, reason: "no_shop" });
  }

  recordPageView({
    shopId,
    actorType: actor.actorType === "admin" ? "admin" : "merchant",
    actorId: actor.actorId,
    path,
  });
  return NextResponse.json({ ok: true });
}
