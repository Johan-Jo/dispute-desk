import { NextResponse } from "next/server";
import { logAdminAction } from "@/lib/admin/auditAction";
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

  const body = await req.json().catch(() => null);
  const is_active = body && typeof body === "object" ? (body as { is_active?: unknown }).is_active : undefined;
  if (typeof is_active !== "boolean") {
    return NextResponse.json({ error: "is_active (boolean) is required" }, { status: 400 });
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from("internal_admin_grants")
    .update({ is_active })
    .eq("user_id", id)
    .select("user_id, email, is_active, last_login_at, created_at, created_by")
    .maybeSingle(); // .single() turned "no such user" into a 500; the 404 below was unreachable

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (caller) {
    await logAdminAction({
      actor: { id: caller.id, email: caller.email },
      eventType: is_active ? "team.reactivated" : "team.deactivated",
      payload: { target_user_id: id, target_email: data.email },
    });
  }

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
  const { data: removed, error } = await db
    .from("internal_admin_grants")
    .delete()
    .eq("user_id", id)
    .select("email");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!removed || removed.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (caller) {
    await logAdminAction({
      actor: { id: caller.id, email: caller.email },
      eventType: "team.revoked",
      payload: { target_user_id: id, target_email: removed[0].email },
    });
  }
  return new NextResponse(null, { status: 204 });
}
