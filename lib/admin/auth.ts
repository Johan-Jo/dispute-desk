import { getServiceClient } from "@/lib/supabase/server";
import { createPortalClient } from "@/lib/supabase/portal";

// ─── Types ────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  created_by: string | null;
}

// ─── Session (Supabase Auth + internal_admin_grants) ───────────────────────

/**
 * True when the request has a Supabase session for a user who holds an active
 * internal admin grant (same account as the marketing/portal sign-in).
 */
export async function hasAdminSession(): Promise<boolean> {
  const supabase = await createPortalClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const db = getServiceClient();
  const { data } = await db
    .from("internal_admin_grants")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  return data != null;
}

/**
 * Returns the current admin grant + auth profile, or null.
 */
export async function getAdminSessionUser(): Promise<AdminUser | null> {
  const supabase = await createPortalClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const db = getServiceClient();
  const { data: grant } = await db
    .from("internal_admin_grants")
    .select("user_id, email, is_active, last_login_at, created_at, created_by")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!grant) return null;

  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const name =
    (typeof meta?.full_name === "string" && meta.full_name) ||
    (typeof meta?.name === "string" && meta.name) ||
    null;

  return {
    id: user.id,
    email: user.email ?? grant.email,
    name,
    is_active: grant.is_active,
    last_login_at: grant.last_login_at,
    created_at: grant.created_at,
    created_by: grant.created_by,
  };
}
