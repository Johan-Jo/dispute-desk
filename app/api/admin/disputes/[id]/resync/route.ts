import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/admin/auth";
import { resyncDispute } from "@/lib/disputes/internal/resync";

export const runtime = "nodejs";

/** POST /api/admin/disputes/:id/resync — re-fetch one dispute from Shopify (respects override locks). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await getAdminSessionUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return resyncDispute(id, { role: "admin", email: admin.email });
}
