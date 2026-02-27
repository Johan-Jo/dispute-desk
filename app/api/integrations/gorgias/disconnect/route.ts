import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { logSetupEvent } from "@/lib/setup/events";

export async function POST(req: NextRequest) {
  const shopId = req.headers.get("x-shop-id");
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();

  const { data: integration } = await sb
    .from("integrations")
    .select("id")
    .eq("shop_id", shopId)
    .eq("type", "gorgias")
    .single();

  if (!integration) {
    return NextResponse.json(
      { error: "Gorgias integration not found" },
      { status: 404 }
    );
  }

  // Delete secret first (FK cascade would also handle this)
  await sb
    .from("integration_secrets")
    .delete()
    .eq("integration_id", integration.id);

  // Delete integration row
  await sb.from("integrations").delete().eq("id", integration.id);

  await logSetupEvent(shopId, "integration_disconnected", { type: "gorgias" });

  return NextResponse.json({ ok: true });
}
