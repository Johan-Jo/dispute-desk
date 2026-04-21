// Backfill: repair evidence_packs rows whose status was accidentally
// downgraded from "saved_to_shopify*" to "ready" (or similar) by a
// rebuild of an already-submitted pack. The authoritative signal is
// saved_to_shopify_at — if it's set, the pack really is submitted.
//
// We restore status to "saved_to_shopify_unverified" (the safe
// default — never claims verification we didn't perform).

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const SAVED_STATUSES = [
  "saved_to_shopify",
  "saved_to_shopify_unverified",
  "saved_to_shopify_verified",
];

const { data: candidates, error } = await sb
  .from("evidence_packs")
  .select("id, dispute_id, status, saved_to_shopify_at, updated_at")
  .not("saved_to_shopify_at", "is", null);

if (error) {
  console.error("Query failed:", error);
  process.exit(1);
}

const needsFix = (candidates ?? []).filter(
  (p) => !SAVED_STATUSES.includes(p.status),
);

console.log(
  `Found ${needsFix.length} pack(s) with saved_to_shopify_at set but status != saved_to_shopify*`,
);

for (const p of needsFix) {
  console.log(
    `  repairing pack=${p.id} dispute=${p.dispute_id} status=${p.status} saved_at=${p.saved_to_shopify_at}`,
  );
  const { error: upErr } = await sb
    .from("evidence_packs")
    .update({
      status: "saved_to_shopify_unverified",
      updated_at: new Date().toISOString(),
    })
    .eq("id", p.id);
  if (upErr) {
    console.error(`    FAILED:`, upErr);
  } else {
    console.log(`    ok`);
  }
}

console.log("Done.");
