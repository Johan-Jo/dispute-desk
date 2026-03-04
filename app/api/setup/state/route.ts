import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  SETUP_STEPS,
  STEP_IDS,
  TOTAL_STEPS,
  getNextActionableStep,
} from "@/lib/setup/constants";
import type { StepId, StepState, SetupStateResponse } from "@/lib/setup/types";

export async function GET(req: NextRequest) {
  const url =
    "nextUrl" in req && req.nextUrl
      ? req.nextUrl
      : new URL(req.url);
  const shopId =
    url.searchParams.get("shop_id") ??
    req.headers.get("x-shop-id") ??
    req.cookies?.get?.("dd_active_shop")?.value ??
    req.cookies?.get?.("active_shop_id")?.value;
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();
  let { data: row } = await sb
    .from("shop_setup")
    .select("*")
    .eq("shop_id", shopId)
    .single();

  if (!row) {
    const { data: inserted } = await sb
      .from("shop_setup")
      .insert({ shop_id: shopId, steps: {}, current_step: null })
      .select("*")
      .single();
    row = inserted;
  }

  const defaultState: StepState = { status: "todo" };
  const stepsMap = (row?.steps ?? {}) as Partial<Record<StepId, StepState>>;

  const fullSteps = {} as Record<StepId, StepState>;
  let doneCount = 0;
  for (const id of STEP_IDS) {
    fullSteps[id] = stepsMap[id] ?? { ...defaultState };
    if (fullSteps[id].status === "done") doneCount++;
  }

  const nextStepId = getNextActionableStep(fullSteps);

  const response: SetupStateResponse = {
    steps: fullSteps,
    progress: { doneCount, total: TOTAL_STEPS },
    nextStepId,
    allDone: doneCount === TOTAL_STEPS,
  };

  return NextResponse.json(response);
}
