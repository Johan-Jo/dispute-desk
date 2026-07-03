// One-off cleanup: null out `due_at` values that are epoch-artifacts.
//
// A historical dispute import (cay-collective, 2026-07-02) wrote `due_at` as
// Unix epoch (1969-12-31 / 1970-01-01, epoch ≈ -86400) for closed disputes that
// have no evidence deadline, instead of NULL — surfacing as a bogus "Dec 30"
// deadline in the UI. A legitimate Shopify evidence deadline is always modern;
// anything before 2000 is a coercion artifact.
//
// Usage (dry run is the default — prints what WOULD change):
//   node scripts/fix-epoch-due-at.mjs
// Apply:
//   node scripts/fix-epoch-due-at.mjs --apply
//
// Targets whatever Supabase project SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in
// .env.local point at — verify that's the intended env before --apply.

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const APPLY = process.argv.includes("--apply");
const CUTOFF = "2000-01-01T00:00:00Z";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const projectRef = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? "(unknown)";
console.error(`[fix-epoch-due-at] Target project: ${projectRef}  mode: ${APPLY ? "APPLY" : "DRY RUN"}`);

// Find rows whose due_at is an epoch-artifact (before the cutoff).
const { data: bad, error } = await sb
  .from("disputes")
  .select("id, shop_id, order_name, due_at, normalized_status")
  .lt("due_at", CUTOFF);

if (error) {
  console.error("Query failed:", error.message);
  process.exit(1);
}

console.error(`[fix-epoch-due-at] Rows with epoch-artifact due_at: ${bad?.length ?? 0}`);
for (const r of bad ?? []) {
  console.error(`  ${r.order_name ?? r.id}  due_at=${r.due_at}  status=${r.normalized_status}`);
}

if (!APPLY) {
  console.error("[fix-epoch-due-at] Dry run — no changes written. Re-run with --apply to null these.");
  process.exit(0);
}

if ((bad?.length ?? 0) === 0) {
  console.error("[fix-epoch-due-at] Nothing to fix.");
  process.exit(0);
}

const { error: updErr, count } = await sb
  .from("disputes")
  .update({ due_at: null }, { count: "exact" })
  .lt("due_at", CUTOFF);

if (updErr) {
  console.error("Update failed:", updErr.message);
  process.exit(1);
}

console.error(`[fix-epoch-due-at] Nulled due_at on ${count ?? "?"} rows.`);
console.log("ok");
