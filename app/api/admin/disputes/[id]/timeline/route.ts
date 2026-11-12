import { NextRequest } from "next/server";
import { loadDisputeTimeline } from "@/lib/disputes/internal/timeline";

export const runtime = "nodejs";

/**
 * GET /api/admin/disputes/:id/timeline
 *
 * Admin-panel timeline (internal events included). Gated by the /api/admin/*
 * middleware: Supabase session + internal_admin_grants + passkey cookie. The
 * merchant route /api/disputes/:id/timeline needs a Bearer role token the admin
 * pages never send, so it answered 401 and the page showed an empty timeline.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return loadDisputeTimeline(req, id, true);
}
