import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { cronEnvGate } from "@/lib/cron/envGate";
import { sendAdminEmail } from "@/lib/email/adminEmail";
import { COUNSEL_COST_BUDGET_USD, quantile, runCostUsd } from "@/lib/defence/counsel/cost";
import type { CounselStageUsage } from "@/lib/defence/counsel/run";

export const runtime = "nodejs";

const PAGE = 1000;

/**
 * GET /api/cron/counsel-cost-monitor
 *
 * Daily. Yesterday's counsel v2 letter cost per package (median, p90) from
 * defence_package_runs.stage_tokens, and an admin email when the median is
 * over the budget (COUNSEL_COST_BUDGET_USD, the template writer's cost).
 *
 * Why it exists: the first production counsel runs cost ~$0.45 each and
 * nothing measured it (docs/plans/counsel-v2-cost-refactor.plan.md §6).
 * Reused letters (no model call) are counted as $0 packages — they are the
 * point of the reuse path. Pre-refactor rows have no stage_tokens and are
 * skipped.
 */
export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const sb = getServiceClient();
  const rows: Array<{ package_id: string | null; stage_tokens: CounselStageUsage[] | null }> = [];
  // PostgREST caps an un-ranged select at 1000 rows: page through the day.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("defence_package_runs")
      .select("package_id, stage_tokens")
      .eq("daily_bucket", day)
      .overlaps("strategy_keys", ["counsel_v2", "counsel_v2_reused"])
      .not("stage_tokens", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: "query_failed", message: error.message }, { status: 500 });
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < PAGE) break;
  }

  const perPackage = new Map<string, { cost: number; calls: number }>();
  for (const r of rows) {
    const key = r.package_id ?? "unknown";
    const prev = perPackage.get(key) ?? { cost: 0, calls: 0 };
    const stages = r.stage_tokens ?? [];
    perPackage.set(key, { cost: prev.cost + runCostUsd(stages), calls: prev.calls + stages.length });
  }
  const costs = [...perPackage.values()].map((p) => p.cost);
  const median = quantile(costs, 0.5);
  const p90 = quantile(costs, 0.9);
  const total = costs.reduce((a, b) => a + b, 0);
  const overBudget = costs.length > 0 && median > COUNSEL_COST_BUDGET_USD;

  if (overBudget) {
    const fmt = (n: number) => `$${n.toFixed(4)}`;
    const subject = `Counsel letter cost over budget on ${day}: median ${fmt(median)} per package`;
    const text =
      `Counsel v2 letters on ${day}: ${costs.length} package(s), total ${fmt(total)}.\n` +
      `Median ${fmt(median)}, p90 ${fmt(p90)} per package; budget ${fmt(COUNSEL_COST_BUDGET_USD)}.\n\n` +
      "To stop the spend without a deploy: set DEFENCE_COUNSEL_V2=off in the production Vercel env.\n" +
      "Breakdown: scripts/sql/counsel-cost-daily.sql.";
    const html = `<pre style="font-family:Menlo,Consolas,monospace;font-size:13px">${text}</pre>`;
    await sendAdminEmail({ subject, html, text, logTag: "counsel-cost-monitor" });
  }

  return NextResponse.json({ day, packages: costs.length, totalUsd: total, medianUsd: median, p90Usd: p90, overBudget });
}
