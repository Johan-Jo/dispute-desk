import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  STEP_IDS,
  WIZARD_STEP_IDS,
  TOTAL_WIZARD_STEPS,
  getNextWizardStep,
  LEGACY_STEP_ID_MAP,
} from "@/lib/setup/constants";
import type { StepId, StepState, SetupStateResponse } from "@/lib/setup/types";

/** Migrate legacy step keys to new step ids when reading shop_setup.steps */
function migrateStepsMap(raw: Record<string, unknown> | null): Partial<Record<StepId, StepState>> {
  const steps = (raw ?? {}) as Record<string, StepState>;
  const out: Partial<Record<StepId, StepState>> = {};
  for (const [key, state] of Object.entries(steps)) {
    const newId = LEGACY_STEP_ID_MAP[key] ?? (STEP_IDS.includes(key as StepId) ? (key as StepId) : null);
    if (newId && state && typeof state === "object" && "status" in state) {
      out[newId] = state;
    }
  }
  return out;
}

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
  const stepsMap = migrateStepsMap(row?.steps as Record<string, unknown> | null);

  const fullSteps = {} as Record<StepId, StepState>;
  for (const id of STEP_IDS) {
    fullSteps[id] = stepsMap[id] ?? { ...defaultState };
  }

  const nextStepId = getNextWizardStep(fullSteps);

  // Progress and allDone based on wizard steps only (excludes auto-steps like permissions/open_in_admin)
  let wizardDoneCount = 0;
  for (const id of WIZARD_STEP_IDS) {
    if (fullSteps[id]?.status === "done" || fullSteps[id]?.status === "skipped") {
      wizardDoneCount++;
    }
  }

  const response: SetupStateResponse = {
    steps: fullSteps,
    progress: { doneCount: wizardDoneCount, total: TOTAL_WIZARD_STEPS },
    nextStepId,
    allDone: wizardDoneCount === TOTAL_WIZARD_STEPS,
  };

  return NextResponse.json(response);
}
