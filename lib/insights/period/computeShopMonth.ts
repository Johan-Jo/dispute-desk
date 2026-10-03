/**
 * Everything the month record holds for one shop and one calendar month:
 * the card-programme block, the operational metrics (incl. disputes by
 * payment method), and the evaluated checkpoints. `evaluateCheckpoints` runs
 * HERE and nowhere else — the page and the emails render the stored result,
 * so they can never grade the same month differently.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { evaluateCheckpoints } from "@/lib/insights/checkpoints";
import type { Checkpoint } from "@/lib/insights/checkpoints.types";
import {
  computeProgrammeBlock,
  programmeCheckpointInput,
  type ProgrammeBlock,
} from "./computeProgrammeBlock";
import { computeOperationalMetrics, type OperationalMetrics } from "./computeOperationalMetrics";
import { addMonths } from "./months";

export interface ShopMonth {
  programme: ProgrammeBlock;
  operational: OperationalMetrics;
  /** Server-ordered, full list; the page shows the first 5, the email 3. */
  checkpoints: Checkpoint[];
}

const pctUnits = (share: number | null): number | null => (share === null ? null : share * 100);

export function checkpointsFor(
  programme: ProgrammeBlock,
  operational: OperationalMetrics,
  priorMedianFulfillmentHours: number | null,
): Checkpoint[] {
  return evaluateCheckpoints(
    {
      programme: programmeCheckpointInput({
        status: "ok",
        periodState: "final",
        finalOn: "",
        ...programme,
      }),
      fraudDisputeRatePct: null,
      fulfilledHighRiskPct: pctUnits(operational.highRiskFulfilledShare),
      threeDsAuthRatePct: pctUnits(operational.threeDsShare),
      signedForRatePct: pctUnits(operational.signedForShare),
      shopifyProtectCoveragePct: pctUnits(operational.protectShareByValue),
      medianFulfillmentHoursCurrent: operational.medianFulfillmentHours,
      medianFulfillmentHoursPrior: priorMedianFulfillmentHours,
    },
    20,
  );
}

export async function computeShopMonth(
  sb: SupabaseClient,
  shopId: string,
  month: string,
  opts: { priorMedianFulfillmentHours?: number | null } = {},
): Promise<ShopMonth> {
  const programme = await computeProgrammeBlock(sb, shopId, month);
  const operational = await computeOperationalMetrics(sb, shopId, month);
  let prior = opts.priorMedianFulfillmentHours;
  if (prior === undefined) {
    // The fulfilment-baseline checkpoint compares with last month's stored
    // median, from the record — never a second computation of it.
    const { data, error } = await sb
      .from("ratio_snapshots")
      .select("operational_metrics")
      .eq("shop_id", shopId)
      .eq("period_month", addMonths(month, -1))
      .maybeSingle();
    if (error) throw new Error(`computeShopMonth: prior month: ${error.message}`);
    const om = (data?.operational_metrics ?? null) as { medianFulfillmentHours?: number | null } | null;
    prior = om?.medianFulfillmentHours ?? null;
  }
  return {
    programme,
    operational,
    checkpoints: checkpointsFor(programme, operational, prior),
  };
}
