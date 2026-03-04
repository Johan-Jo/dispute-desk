import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { STEP_IDS } from "@/lib/setup/constants";
import { logSetupEvent } from "@/lib/setup/events";
import type { StepId, StepState, SkippedReason } from "@/lib/setup/types";

const VALID_REASONS: SkippedReason[] = ["do_later", "not_relevant", "need_help"];

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
  const reason = body.reason as SkippedReason;

  if (!stepId || !STEP_IDS.includes(stepId)) {
    return NextResponse.json({ error: "Invalid stepId" }, { status: 400 });
  }

  if (!reason || !VALID_REASONS.includes(reason)) {
    return NextResponse.json(
      { error: "reason required: do_later | not_relevant | need_help" },
      { status: 400 }
    );
  }

  const sb = getServiceClient();

  const { data: existing } = await sb
    .from("shop_setup")
    .select("steps")
    .eq("shop_id", shopId)
    .single();

  const stepsMap = (existing?.steps ?? {}) as Record<string, StepState>;

  stepsMap[stepId] = {
    status: "skipped",
    skipped_reason: reason,
    payload: stepsMap[stepId]?.payload,
  };

  if (existing) {
    await sb
      .from("shop_setup")
      .update({ steps: stepsMap, updated_at: new Date().toISOString() })
      .eq("shop_id", shopId);
  } else {
    await sb.from("shop_setup").insert({
      shop_id: shopId,
      steps: stepsMap,
    });
  }

  await logSetupEvent(shopId, "step_skipped", { stepId, reason });

  return NextResponse.json({ ok: true, stepId, status: "skipped" });
}
