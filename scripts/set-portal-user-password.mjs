/**
 * Set a Supabase Auth user password by email (service role).
 * Usage: node scripts/set-portal-user-password.mjs <email> <new-password>
 * Requires: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY in .env.local
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error("Usage: node scripts/set-portal-user-password.mjs <email> <new-password>");
  process.exit(1);
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local)");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let found = null;
for (let page = 1; page <= 100 && !found; page++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (data.users.length < 200) break;
}

if (!found) {
  console.error(`No user found with email: ${email}`);
  process.exit(1);
}

const { error: updErr } = await supabase.auth.admin.updateUserById(found.id, {
  password,
});

if (updErr) {
  console.error(updErr.message);
  process.exit(1);
}

console.log(`Password updated for ${email} (user id ${found.id})`);
