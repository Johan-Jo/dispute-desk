import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/admin/auth";

export const runtime = "nodejs";

/** GET /api/admin/team/me — lightweight current admin user info for the layout shell */
export async function GET() {
  const user = await getAdminSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    email: user.email,
    name: user.name,
  });
}
