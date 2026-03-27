import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { syncDisputes } from "@/lib/disputes/syncDisputes";

/**
 * POST /api/disputes/sync
 * Body: { shop_id }
 *
 * Runs a full dispute sync for the given shop (synchronous, not job-based).
 * For async/background sync, enqueue a sync_disputes job instead.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const shopId =
    (body && typeof body === "object" && "shop_id" in body
      ? (body as { shop_id?: string }).shop_id
      : undefined) ?? req.headers.get("x-shop-id");

  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  try {
    const result = await syncDisputes(shopId, {
      triggerAutomation: true,
      correlationId: `manual-sync-${Date.now()}`,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("No offline session for shop ")) {
      const idFromMessage = message.replace(/^No offline session for shop /, "").trim();
      const { data: shop } = await getServiceClient()
        .from("shops")
        .select("shop_domain")
        .eq("id", idFromMessage)
        .single();
      return NextResponse.json(
        {
          error: message,
          code: "NO_OFFLINE_SESSION",
          shop_domain: shop?.shop_domain ?? null,
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
