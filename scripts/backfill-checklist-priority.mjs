/**
 * Backfill checklist_v2 priority to match reason-specific templates.
 *
 * Reason: DB-backed pack templates previously derived priority from
 * requirement_mode alone, making shipping_tracking / delivery_proof
 * read as "Critical gap" on FRAUDULENT disputes where they are only
 * supporting evidence. The presentation fix (completeness.ts) now
 * prefers REASON_TEMPLATES_V2 priority; this script aligns historical
 * rows so the UI stops showing false Critical gaps on existing packs.
 *
 * Usage:
 *   node scripts/backfill-checklist-priority.mjs            # dry-run
 *   node scripts/backfill-checklist-priority.mjs --apply    # write
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const APPLY = process.argv.includes("--apply");

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Mirror of REASON_TEMPLATES_V2 in lib/automation/completeness.ts —
// only the per-reason priority map is needed here.
const REASON_PRIORITY = {
  PRODUCT_NOT_RECEIVED: {
    order_confirmation: "critical",
    shipping_tracking: "critical",
    delivery_proof: "critical",
    shipping_policy: "recommended",
    customer_communication: "recommended",
    supporting_documents: "optional",
  },
  FRAUDULENT: {
    order_confirmation: "critical",
    billing_address_match: "critical",
    avs_cvv_match: "critical",
    activity_log: "critical",
    ip_location_check: "recommended",
    shipping_tracking: "recommended",
    delivery_proof: "recommended",
    customer_communication: "recommended",
    supporting_documents: "optional",
  },
  PRODUCT_UNACCEPTABLE: {
    order_confirmation: "critical",
    product_description: "critical",
    refund_policy: "critical",
    customer_communication: "recommended",
    shipping_tracking: "optional",
    supporting_documents: "optional",
  },
  DUPLICATE: {
    order_confirmation: "critical",
    duplicate_explanation: "critical",
    supporting_documents: "optional",
  },
  SUBSCRIPTION_CANCELED: {
    order_confirmation: "critical",
    cancellation_policy: "critical",
    customer_communication: "recommended",
    supporting_documents: "optional",
  },
  GENERAL: {
    order_confirmation: "critical",
    shipping_tracking: "recommended",
    customer_communication: "recommended",
    refund_policy: "optional",
    supporting_documents: "optional",
  },
};

function normalizeReason(raw) {
  if (!raw) return "GENERAL";
  const key = String(raw).toUpperCase().replace(/\s+/g, "_");
  return REASON_PRIORITY[key] ? key : "GENERAL";
}

// Pull every pack that has a non-empty checklist_v2 + the dispute's reason.
const { data: packs, error } = await sb
  .from("evidence_packs")
  .select("id, dispute_id, checklist_v2, disputes!inner(reason)")
  .not("checklist_v2", "is", null);

if (error) {
  console.error("query failed:", error);
  process.exit(1);
}

let inspected = 0;
let changedPacks = 0;
let changedRows = 0;
const sampleChanges = [];

for (const pack of packs ?? []) {
  if (!Array.isArray(pack.checklist_v2)) continue;
  inspected++;
  const reasonKey = normalizeReason(pack.disputes?.reason);
  const priorityMap = REASON_PRIORITY[reasonKey];
  if (!priorityMap) continue;

  let changed = false;
  const next = pack.checklist_v2.map((item) => {
    const expected = priorityMap[item.field];
    if (!expected) return item;
    if (item.priority === expected) return item;
    changed = true;
    if (sampleChanges.length < 8) {
      sampleChanges.push({
        pack: pack.id.slice(0, 8),
        reason: reasonKey,
        field: item.field,
        from: item.priority,
        to: expected,
      });
    }
    changedRows++;
    return { ...item, priority: expected };
  });

  if (!changed) continue;
  changedPacks++;

  if (APPLY) {
    const { error: upErr } = await sb
      .from("evidence_packs")
      .update({ checklist_v2: next, updated_at: new Date().toISOString() })
      .eq("id", pack.id);
    if (upErr) console.error(`  failed ${pack.id}: ${upErr.message}`);
  }
}

console.log(`inspected:     ${inspected} packs`);
console.log(`would change:  ${changedPacks} packs (${changedRows} rows)`);
if (sampleChanges.length > 0) {
  console.log("sample:");
  for (const s of sampleChanges) {
    console.log(`  ${s.pack}  ${s.reason.padEnd(22)}  ${s.field.padEnd(28)}  ${s.from} → ${s.to}`);
  }
}
console.log(APPLY ? "✓ applied" : "(dry-run — rerun with --apply to write)");
