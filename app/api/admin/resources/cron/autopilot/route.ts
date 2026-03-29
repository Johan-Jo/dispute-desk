import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { executeAutopilotTick } from "@/lib/resources/cron/autopilotTick";

export const dynamic = "force-dynamic";
/** One multi-locale article can take minutes (6× OpenAI + optional retries); Pro plan allows up to 300s. */
export const maxDuration = 300;

const DEFAULT_MANUAL_LIMIT = 1;
const MAX_MANUAL_LIMIT = 50;

function parseManualArticleLimit(req: NextRequest): number {
  const raw = req.nextUrl.searchParams.get("limit");
  if (raw === null || raw === "") return DEFAULT_MANUAL_LIMIT;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MANUAL_LIMIT;
  return Math.min(n, MAX_MANUAL_LIMIT);
}

/**
 * Manual trigger — bypasses daily rate limit. Default is **one** article per request so the
 * handler stays within platform timeouts (each article = many parallel/successive OpenAI calls).
 * Optional query: `?limit=N` (1–50) to process more in one request (may still timeout on large N).
 * Cron variant never sets bypassRateLimit.
 */
export async function POST(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const overrideCount = parseManualArticleLimit(req);
    const result = await executeAutopilotTick({ bypassRateLimit: true, overrideCount });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Autopilot tick failed" },
      { status: 500 }
    );
  }
}
