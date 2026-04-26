/**
 * Simulate exactly what the hook + caseStrength + strengthReason
 * produce for pack aee832ad after the last fix landed. Surfaces:
 *  - the hero pill value (should be 83%, not 0%)
 *  - the strengthReason copy (currently 'Key payment verification
 *    evidence is missing.' which contradicts the contributions)
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { calculateCaseStrength, computeContributions } from "../lib/argument/caseStrength.ts";

config({ path: ".env.local" });
const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const PACK_ID = "424bedfd-4d12-407f-a136-3f2b7fecb8ba";
const { data: pack } = await sb.from("evidence_packs").select("checklist_v2, pack_json").eq("id", PACK_ID).maybeSingle();
const { data: items } = await sb.from("evidence_items").select("payload, source").eq("pack_id", PACK_ID);

// reconcile (matches workspace API)
const collected = new Set();
for (const s of pack.pack_json?.sections ?? []) for (const f of s.fieldsProvided ?? []) collected.add(f);
for (const it of items ?? []) for (const f of (it.payload?.fieldsProvided ?? [])) collected.add(f);
const reconciled = (pack.checklist_v2 ?? []).map((c) => {
  if (c.status !== "missing") return c;
  if (!collected.has(c.field)) return c;
  return { ...c, status: "available" };
});

// build evidenceItemsByField (matches workspace API)
const map = {};
for (const it of items ?? []) for (const f of (it.payload?.fieldsProvided ?? [])) if (!(f in map)) map[f] = it;
for (const s of pack.pack_json?.sections ?? []) {
  for (const f of s.fieldsProvided ?? []) {
    if (f in map) continue;
    map[f] = { payload: { ...(s.data ?? {}), fieldsProvided: s.fieldsProvided } };
  }
}

const cs = calculateCaseStrength(null, reconciled, "FRAUDULENT", { kind: "byField", map });
const cn = computeContributions(reconciled, { kind: "byField", map });

console.log("caseStrength:");
console.log("  overall:", cs.overall, " (label: 'Hard to win')");
console.log("  score:", cs.score);
console.log("  coveragePercent:", cs.coveragePercent, " <-- HERO PILL");
console.log("  strongCount:", cs.strongCount);
console.log("  moderateCount:", cs.moderateCount);
console.log("  strengthReason:", JSON.stringify(cs.strengthReason));
console.log("");
console.log("contributions.strong:");
for (const c of cn.strong) console.log("  ", c.signalId, c.label);
console.log("contributions.moderate:");
for (const c of cn.moderate) console.log("  ", c.signalId, c.label);

console.log("");
console.log("CONTRADICTION:");
const strongAvs = cn.strong.find((c) => c.signalId === "payment_auth");
console.log("  contributions has payment_auth = strong:", Boolean(strongAvs));
console.log("  but strengthReason says payment verification is missing:", cs.strengthReason?.includes("payment verification evidence is missing"));
