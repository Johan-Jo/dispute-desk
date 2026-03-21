import { NextRequest, NextResponse } from "next/server";
import { agentLogRuntime } from "@/lib/debug/agentLogRuntime";

/**
 * Same-origin client debug sink for embedded Shopify (HTTPS). No localhost / mixed content.
 * Enable with DD_DEBUG_AGENT_LOG=1 on the deployment.
 */
export async function POST(req: NextRequest) {
  if (process.env.DD_DEBUG_AGENT_LOG !== "1") {
    return new NextResponse(null, { status: 204 });
  }
  try {
    const body = (await req.json()) as Record<string, unknown>;
    agentLogRuntime({
      hypothesisId: body.hypothesisId,
      location: body.location ?? "client",
      message: body.message ?? "client_event",
      source: "browser",
      data: body.data ?? body,
    });
  } catch {
    /* ignore malformed body */
  }
  return new NextResponse(null, { status: 204 });
}
