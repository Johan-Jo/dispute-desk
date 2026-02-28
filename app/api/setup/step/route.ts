import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { STEP_IDS } from "@/lib/setup/constants";
import { logSetupEvent } from "@/lib/setup/events";
import type { StepId, StepState } from "@/lib/setup/types";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const shopId =
    body.shop_id ?? req.headers.get("x-shop-id");
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
    await sb
      .from("shop_setup")
      .update({ steps: stepsMap, current_step: stepId, updated_at: new Date().toISOString() })
      .eq("shop_id", shopId);
  } else {
    await sb.from("shop_setup").insert({
      shop_id: shopId,
      steps: stepsMap,
      current_step: stepId,
    });
  }

  await logSetupEvent(shopId, "step_completed", { stepId, payload });

  return NextResponse.json({ ok: true, stepId, status: "done" });
}
