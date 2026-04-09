import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { STEP_IDS } from "@/lib/setup/constants";
import { logSetupEvent } from "@/lib/setup/events";
import type { StepId, StepState } from "@/lib/setup/types";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const shopId =
    body.shop_id ??
    req.headers.get("x-shop-id") ??
    req.cookies?.get?.("dd_active_shop")?.value ??
    req.cookies?.get?.("active_shop_id")?.value;
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const stepId = body.stepId as StepId;
  const payload = body.payload ?? {};

  if (!stepId || !STEP_IDS.includes(stepId)) {
    return NextResponse.json({ error: "Invalid stepId" }, { status: 400 });
  }

  const sb = getServiceClient();

  const { data: existing } = await sb
    .from("shop_setup")
    .select("steps")
    .eq("shop_id", shopId)
    .single();

  const stepsMap = (existing?.steps ?? {}) as Record<string, StepState>;

  stepsMap[stepId] = {
    status: "done",
    payload,
    completed_at: new Date().toISOString(),
    skipped_reason: null,
  };

  if (existing) {
    const { error: updateErr } = await sb
      .from("shop_setup")
      .update({ steps: stepsMap, current_step: stepId, updated_at: new Date().toISOString() })
      .eq("shop_id", shopId);
    if (updateErr) {
      console.error("[setup/step] update failed:", updateErr.message);
      return NextResponse.json({ error: "Failed to save step", detail: updateErr.message }, { status: 500 });
    }
  } else {
    const { error: insertErr } = await sb.from("shop_setup").insert({
      shop_id: shopId,
      steps: stepsMap,
      current_step: stepId,
    });
    if (insertErr) {
      console.error("[setup/step] insert failed:", insertErr.message);
      return NextResponse.json({ error: "Failed to save step", detail: insertErr.message }, { status: 500 });
    }
  }

  await logSetupEvent(shopId, "step_completed", { stepId, payload });

  return NextResponse.json({ ok: true, stepId, status: "done" });
}
