import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { resyncDispute } from "@/lib/disputes/internal/resync";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/disputes/:id/resync
 *
 * Re-fetches a single dispute from Shopify and updates the local row.
 * Respects override locks: overridden fields are not overwritten.
 *
 * Auth: admin or support role via Supabase JWT.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: disputeId } = await params;
  const sb = getServiceClient();

  // Verify admin/support role
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: { user } } = await sb.auth.getUser(authHeader.slice(7));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = (user.app_metadata as Record<string, unknown> | undefined)?.role;
  if (role !== "admin" && role !== "support") {
    return NextResponse.json({ error: "Admin or support role required" }, { status: 403 });
  }

  return resyncDispute(disputeId, { role: String(role), email: user.email ?? null });
}
