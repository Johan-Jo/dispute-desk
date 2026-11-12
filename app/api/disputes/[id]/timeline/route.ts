import { NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { loadDisputeTimeline } from "@/lib/disputes/internal/timeline";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/disputes/:id/timeline
 *
 * Returns the dispute event timeline and status summary.
 *
 * Visibility:
 * - Merchant requests (default): only `merchant_and_internal` events.
 * - Admin/support: requires a verified Supabase auth session with
 *   `role = 'admin'` or `role = 'support'` in app_metadata. Only then
 *   are `internal_only` events included.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: disputeId } = await params;
  const sb = getServiceClient();

  // Determine visibility filter — internal events require verified admin/support role
  let includeInternal = false;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const { data: { user } } = await sb.auth.getUser(token);
    const role = (user?.app_metadata as Record<string, unknown> | undefined)?.role;
    if (role === "admin" || role === "support") {
      includeInternal = true;
    }
  }

  return loadDisputeTimeline(req, disputeId, includeInternal);
}
