import { NextResponse } from "next/server";
import { hasAdminSession, getAdminSessionUser } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** PATCH /api/admin/team/[id] — toggle is_active (id = auth user id) */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const caller = await getAdminSessionUser();

  if (caller?.id === id) {
    return NextResponse.json({ error: "You cannot change your own active status" }, { status: 400 });
  }

  const { is_active } = await req.json();
  if (typeof is_active !== "boolean") {
    return NextResponse.json({ error: "is_active (boolean) is required" }, { status: 400 });
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from("internal_admin_grants")
    .update({ is_active })
    .eq("user_id", id)
    .select("user_id, email, is_active, last_login_at, created_at, created_by")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json({
    id: data.user_id,
    email: data.email,
    name: null,
    is_active: data.is_active,
    last_login_at: data.last_login_at,
    created_at: data.created_at,
    created_by: data.created_by,
  });
}

/** DELETE /api/admin/team/[id] — revoke admin (id = auth user id) */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const caller = await getAdminSessionUser();

  if (caller?.id === id) {
    return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
  }

  const db = getServiceClient();
  const { error } = await db.from("internal_admin_grants").delete().eq("user_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
