import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { ingestLoop } from "@/lib/signal-radar/ingest-loop";
import { getEnabledAdapters } from "@/lib/signal-radar/sources";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Body is currently ignored — every refresh runs the full default-adapter
  // set (Shopify Community + Reddit). Kept as POST for forward-compat.
  try {
    await req.json();
  } catch {
    // empty body is fine
  }

  try {
    const result = await ingestLoop(await getEnabledAdapters());
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "ingest failed";
    console.error("[signal-radar] manual refresh error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
