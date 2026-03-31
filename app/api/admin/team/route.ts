import { NextResponse } from "next/server";
import { hasAdminSession, getAdminSessionUser, hashPassword } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** GET /api/admin/team — list all admin users (no password_hash) */
export async function GET() {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from("admin_users")
    .select("id, email, name, is_active, last_login_at, created_at, created_by")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/** POST /api/admin/team — create a new admin user */
export async function POST(req: Request) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const caller = await getAdminSessionUser();
  const { email, password, name } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  const db = getServiceClient();

  const { data, error } = await db
    .from("admin_users")
    .insert({
      email: email.trim().toLowerCase(),
      password_hash: passwordHash,
      name: name?.trim() || null,
      created_by: caller?.email ?? null,
    })
    .select("id, email, name, is_active, last_login_at, created_at, created_by")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "An admin with that email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
