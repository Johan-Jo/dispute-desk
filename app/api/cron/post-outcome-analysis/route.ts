import { NextRequest, NextResponse } from "next/server";
import { cronEnvGate } from "@/lib/cron/envGate";
import { runPendingAnalyses } from "@/lib/postOutcome/runPendingAnalyses";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Per run. A normal day decides a handful; the rest is backlog, drained daily. */
const LIMIT = 100;
/** Stop starting new cases with headroom left under maxDuration. */
const BUDGET_MS = 240_000;

/**
 * GET /api/cron/post-outcome-analysis
 *
 * Daily. Analyses every decided dispute that has a filed package and no
 * current analysis (or whose outcome changed since it was analysed), so the
 * `/admin/outcome-analysis` review queue keeps up with new outcomes. Writes
 * internal admin rows only: nothing merchant-facing, nothing that changes a
 * rule (plan §17 — a finding is a hypothesis until a human confirms it).
 * Selection rule: lib/postOutcome/runPendingAnalyses.ts.
 */
export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  try {
    const result = await runPendingAnalyses({
      limit: LIMIT,
      deadlineMs: Date.now() + BUDGET_MS,
    });
    if (result.failed.length > 0) {
      console.error("[post-outcome-analysis] failures", result.failed);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[post-outcome-analysis] run failed", message);
    return NextResponse.json({ error: "run_failed", message }, { status: 500 });
  }
}
