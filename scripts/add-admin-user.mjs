/**
 * Grant internal admin access to an existing portal user (same Supabase Auth account).
 *
 * Usage:
 *   node scripts/add-admin-user.mjs <email>
 *
 * The person must already have signed up at /auth/sign-up (auth.users row).
 *
 * Requires: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
 * in .env / .env.local (same as the Next.js app).
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env") });

const emailArg = process.argv[2];
if (!emailArg) {
  console.error("Usage: node scripts/add-admin-user.mjs <email>");
  process.exit(1);
}

const email = emailArg.trim();

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env / .env.local");
  process.exit(1);
}

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: uid, error: rpcError } = await db.rpc("dd_admin_resolve_user_id_by_email", {
  p_email: email,
});

if (rpcError) {
  console.error("Lookup failed:", rpcError.message);
  process.exit(1);
}
if (!uid) {
  console.error(
    "No auth user for that email. They must create a DisputeDesk account at /auth/sign-up first.",
  );
  process.exit(1);
}

const { data: authData } = await db.auth.admin.getUserById(uid);
const resolvedEmail = authData.user?.email?.trim().toLowerCase() ?? email.toLowerCase();

const { error: upsertError } = await db.from("internal_admin_grants").upsert(
  {
    user_id: uid,
    email: resolvedEmail,
    is_active: true,
    created_by: "script:add-admin-user",
  },
  { onConflict: "user_id" },
);

if (upsertError) {
  console.error("Grant failed:", upsertError.message);
  process.exit(1);
}

console.error("Admin access granted for:", resolvedEmail);
console.log("ok");
