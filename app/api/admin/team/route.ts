import { NextResponse } from "next/server";
import { hasAdminSession, getAdminSessionUser } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** GET /api/admin/team — list all internal admins (Supabase-backed) */
export async function GET() {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceClient();
  const { data: rows, error } = await db
    .from("internal_admin_grants")
    .select("user_id, email, is_active, last_login_at, created_at, created_by")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const enriched = await Promise.all(
    (rows ?? []).map(async (row) => {
      const { data: authData, error: authErr } = await db.auth.admin.getUserById(row.user_id);
      if (authErr || !authData.user) {
        return {
          id: row.user_id,
          email: row.email,
          name: null as string | null,
          is_active: row.is_active,
          last_login_at: row.last_login_at,
          created_at: row.created_at,
          created_by: row.created_by,
        };
      }
      const u = authData.user;
      const meta = u.user_metadata as Record<string, unknown> | undefined;
      const name =
        (typeof meta?.full_name === "string" && meta.full_name) ||
        (typeof meta?.name === "string" && meta.name) ||
        null;
      return {
        id: row.user_id,
        email: u.email ?? row.email,
        name,
        is_active: row.is_active,
        last_login_at: row.last_login_at,
        created_at: row.created_at,
        created_by: row.created_by,
      };
    }),
  );

  return NextResponse.json(enriched);
}

/**
 * POST /api/admin/team — grant admin to an existing portal user (matched by email).
 * The person must already have signed up at /auth/sign-up (auth.users row).
 */
export async function POST(req: Request) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const caller = await getAdminSessionUser();
  const body = await req.json();
  const email = body?.email;

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const db = getServiceClient();
  const { data: uid, error: rpcError } = await db.rpc("dd_admin_resolve_user_id_by_email", {
    p_email: email.trim(),
  });

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }
  if (!uid) {
    return NextResponse.json(
      {
        error:
          "No DisputeDesk account exists for that email. The user must sign up at /auth/sign-up first, then you can grant admin access.",
      },
      { status: 404 },
    );
  }

  const { data: authData } = await db.auth.admin.getUserById(uid);
  const resolvedEmail =
    authData.user?.email?.trim().toLowerCase() ?? email.trim().toLowerCase();

  const { data, error } = await db
    .from("internal_admin_grants")
    .insert({
      user_id: uid,
      email: resolvedEmail,
      created_by: caller?.email ?? null,
    })
    .select("user_id, email, is_active, last_login_at, created_at, created_by")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "That user already has admin access" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      id: data.user_id,
      email: data.email,
      name: null,
      is_active: data.is_active,
      last_login_at: data.last_login_at,
      created_at: data.created_at,
      created_by: data.created_by,
    },
    { status: 201 },
  );
}
