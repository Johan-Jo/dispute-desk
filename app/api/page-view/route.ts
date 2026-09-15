import { NextRequest, NextResponse } from "next/server";
import { recordPageView } from "@/lib/shopify/recordPageView";
import { verifyImpersonation } from "@/lib/admin/impersonation";

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

  const imp = await verifyImpersonation(req);
  if (imp) {
    recordPageView({
      shopId: imp.shopId,
      actorType: "admin",
      actorId: imp.adminUserId ?? null,
      path,
    });
    return NextResponse.json({ ok: true });
  }

  // Merchant: middleware resolves the shop for /api/* and injects x-shop-id.
  const shopId = req.headers.get("x-shop-id");
  if (!shopId || shopId === "demo") {
    return NextResponse.json({ ok: false, reason: "no_shop" });
  }

  recordPageView({ shopId, actorType: "merchant", actorId: null, path });
  return NextResponse.json({ ok: true });
}
