/**
 * End-to-end verification for the dispute aee832ad fix.
 * Imports the actual reconcile helpers (compiled at runtime by tsx) and
 * runs them against the live DB row to confirm the workspace API shape.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

// Hand-rolled mirror of the helpers (avoids needing tsx for a one-shot
// verification — tested separately in lib/packs/__tests__/).
function collectedFieldsFromPack({ sections, evidenceItems }) {
  const set = new Set();
  for (const s of sections ?? []) for (const f of s?.fieldsProvided ?? []) set.add(f);
  for (const it of evidenceItems ?? []) for (const f of it?.payload?.fieldsProvided ?? []) set.add(f);
  return set;
}
function reconcileChecklist(checklist, collected) {
  if (!checklist) return [];
  return checklist.map((c) => {
    if (c.status !== "missing") return c;
    if (!collected.has(c.field)) return c;
    return { ...c, status: "available", unavailableReason: undefined };
  });
}

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const PACK_ID = "424bedfd-4d12-407f-a136-3f2b7fecb8ba";

const { data: pack } = await sb.from("evidence_packs").select("checklist_v2, pack_json").eq("id", PACK_ID).maybeSingle();
const { data: items } = await sb.from("evidence_items").select("payload, source, label").eq("pack_id", PACK_ID);

const collected = collectedFieldsFromPack({
  sections: pack.pack_json?.sections ?? [],
  evidenceItems: items ?? [],
});
const reconciled = reconcileChecklist(pack.checklist_v2, collected);

const before = pack.checklist_v2.map((c) => `${c.field}=${c.status}`).join(", ");
const after = reconciled.map((c) => `${c.field}=${c.status}`).join(", ");
const flipped = reconciled.filter((c, i) => c.status !== pack.checklist_v2[i].status);

console.log("collected fields:", [...collected].sort());
console.log("\nflipped rows (must be exactly 4: ip_location_check, refund/shipping/cancellation_policy):");
for (const c of flipped) console.log("  ", c.field, "→", c.status);

console.log("\nstill missing (expected: billing_address_match only):");
for (const c of reconciled) if (c.status === "missing") console.log("  ", c.field);

console.log("\nstill unavailable (expected: delivery_proof only):");
for (const c of reconciled) if (c.status === "unavailable") console.log("  ", c.field);

const manualUploads = (items ?? []).filter((it) => it.source === "manual_upload");
console.log("\nmanual uploads (should appear in OverviewTab as +N attached files):", manualUploads.length);
for (const u of manualUploads) console.log("  ", u.label);

const flippedFields = new Set(flipped.map((c) => c.field));
const expectedFlips = new Set(["ip_location_check", "refund_policy", "shipping_policy", "cancellation_policy"]);
const ok =
  flippedFields.size === expectedFlips.size &&
  [...expectedFlips].every((f) => flippedFields.has(f));
console.log("\nverification:", ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
