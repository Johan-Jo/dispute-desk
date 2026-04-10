import { NextRequest, NextResponse } from "next/server";
import { listReasonMappings } from "@/lib/db/reasonMappings";
import type { DisputePhase } from "@/lib/rules/disputeReasons";

/**
 * GET /api/reason-mappings?phase=inquiry
 *
 * Returns reason-to-template mappings for the embedded app.
 * Optional ?phase filter (inquiry|chargeback).
 */
export async function GET(req: NextRequest) {
  const phase = req.nextUrl.searchParams.get("phase") as DisputePhase | null;
  const mappings = await listReasonMappings(phase ?? undefined);

  return NextResponse.json({
    mappings: mappings.map((m) => ({
      reason_code: m.reason_code,
      dispute_phase: m.dispute_phase,
      template_id: m.template_id,
      template_name: m.template_name,
      family: m.family,
      is_active: m.is_active,
    })),
  });
}
