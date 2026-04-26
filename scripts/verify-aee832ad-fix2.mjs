/**
 * End-to-end verification for the dispute aee832ad UI render fix:
 * - workspace API synthesizes evidenceItemsByField from pack_json.sections
 * - classifyEvidenceRow returns the right category for each row
 * - caseStrength sees real payloads now (avs_cvv_match → strong)
 *
 * Mirrors the logic without going through the actual API endpoint
 * (which requires a Shopify session).
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const PACK_ID = "424bedfd-4d12-407f-a136-3f2b7fecb8ba";

const { data: pack } = await sb
  .from("evidence_packs")
  .select("checklist_v2, pack_json")
  .eq("id", PACK_ID)
  .maybeSingle();
const { data: items } = await sb
  .from("evidence_items")
  .select("payload, source")
  .eq("pack_id", PACK_ID);

// 1. Reconcile checklist (from prior fix).
const collected = new Set();
for (const s of pack.pack_json?.sections ?? []) for (const f of s.fieldsProvided ?? []) collected.add(f);
for (const it of items ?? []) for (const f of (it.payload?.fieldsProvided ?? [])) collected.add(f);
const reconciled = (pack.checklist_v2 ?? []).map((c) => {
  if (c.status !== "missing") return c;
  if (!collected.has(c.field)) return c;
  return { ...c, status: "available" };
});

// 2. Build evidenceItemsByField with the new fallback.
const byField = {};
for (const it of items ?? []) {
  for (const f of it.payload?.fieldsProvided ?? []) {
    if (!(f in byField)) byField[f] = it;
  }
}
for (const s of pack.pack_json?.sections ?? []) {
  for (const f of s.fieldsProvided ?? []) {
    if (f in byField) continue;
    byField[f] = {
      payload: { ...(s.data ?? {}), fieldsProvided: s.fieldsProvided },
    };
  }
}

// 3. Mirror of classifyEvidenceRow + categorizer (kept brief).
const SUPPORTING = new Set([
  "order_confirmation","activity_log","customer_communication","customer_account_info",
  "refund_policy","shipping_policy","cancellation_policy","supporting_documents",
  "product_description","duplicate_explanation",
]);
const AVS_OK = new Set(["Y","A","W","X","D","M"]);
const CVV_OK = new Set(["M"]);
function categorize(field, p) {
  if (!p) p = {};
  if (field === "avs_cvv_match") {
    const a = String(p.avsResultCode ?? "").toUpperCase();
    const c = String(p.cvvResultCode ?? "").toUpperCase();
    if (!a && !c) return "supporting";
    const ok = (AVS_OK.has(a) ? 1 : 0) + (CVV_OK.has(c) ? 1 : 0);
    return ok === 2 ? "strong" : ok === 1 ? "moderate" : "invalid";
  }
  if (field === "delivery_proof" || field === "shipping_tracking") {
    if (typeof p.proofType !== "string" || !p.proofType) return "supporting";
    if (p.proofType === "signature_confirmed") return "strong";
    if (p.proofType === "delivered_confirmed") return "moderate";
    if (p.proofType === "delivered_unverified") return "supporting";
    return "invalid";
  }
  if (field === "ip_location_check") {
    if (typeof p.bankEligible !== "boolean" && !p.locationMatch && !p.ipinfo) return "supporting";
    if (p.bankEligible === false) return "supporting";
    const priv = p.ipinfo?.privacy;
    if (priv?.vpn || priv?.proxy || priv?.hosting) return "supporting";
    if (p.locationMatch === "match" || p.locationMatch === "country_match") return "moderate";
    return "supporting";
  }
  if (field === "billing_address_match") {
    if (typeof p.match !== "boolean") return "supporting";
    return p.match ? "strong" : "invalid";
  }
  return "supporting";
}
function classify(field, status, payload) {
  if (status === "missing") return { category: null, status: "missing" };
  if (status === "unavailable") return { category: null, status: "not_applicable" };
  const sk = status === "waived" ? "waived" : "collected";
  if (SUPPORTING.has(field)) return { category: "supporting", status: sk };
  return { category: categorize(field, payload), status: sk };
}

console.log("Per-row classification (Overview Evidence collected panel):\n");
console.log("field                       status        →  category    badge");
console.log("--------------------------- ------------- -- ----------- ----------");
for (const c of reconciled) {
  const payload = byField[c.field]?.payload ?? null;
  const r = classify(c.field, c.status, payload);
  const cat = r.category ?? "-";
  const badge = cat === "invalid" ? "Invalid" : cat === "strong" ? "Strong" : cat === "moderate" ? "Moderate" : cat === "supporting" ? "Supporting" : "(none)";
  console.log(`${c.field.padEnd(28)}${c.status.padEnd(13)}  ->  ${cat.padEnd(10)} ${badge}`);
}

// caseStrength simulation
let strong = 0, moderate = 0;
const seen = new Set();
const RANK = { strong: 3, moderate: 2, supporting: 1, invalid: 0 };
const SIGNAL = {
  avs_cvv_match: "payment_auth", tds_authentication: "payment_auth",
  billing_address_match: "billing_match",
  delivery_proof: "delivery", shipping_tracking: "delivery",
  ip_location_check: "ip_location",
};
for (const c of reconciled) {
  if (c.status !== "available" && c.status !== "waived") continue;
  if (SUPPORTING.has(c.field)) continue;
  const p = byField[c.field]?.payload ?? null;
  const cat = categorize(c.field, p);
  if (cat !== "strong" && cat !== "moderate") continue;
  const sig = SIGNAL[c.field] ?? c.field;
  const prev = seen.get?.(sig);
  if (!prev || RANK[cat] > RANK[prev]) { seen.set?.(sig, cat); }
  // simple Map alternative
}
const m = new Map();
for (const c of reconciled) {
  if (c.status !== "available" && c.status !== "waived") continue;
  if (SUPPORTING.has(c.field)) continue;
  const p = byField[c.field]?.payload ?? null;
  const cat = categorize(c.field, p);
  if (cat !== "strong" && cat !== "moderate") continue;
  const sig = SIGNAL[c.field] ?? c.field;
  const prev = m.get(sig);
  if (!prev || RANK[cat] > RANK[prev]) m.set(sig, cat);
}
for (const v of m.values()) { if (v === "strong") strong++; else if (v === "moderate") moderate++; }

const score = strong * 3 + moderate * 2;
let overall;
if (strong >= 2) overall = "strong";
else if (strong === 1 && moderate >= 1) overall = "moderate";
else overall = "weak";

const presentCount = reconciled.filter((c) => c.status === "available" || c.status === "waived").length;
const registered = reconciled.length;
const coveragePercent = Math.round((presentCount / registered) * 100);

console.log("\ncaseStrength after fix:");
console.log("  strongCount =", strong);
console.log("  moderateCount =", moderate);
console.log("  score =", score);
console.log("  overall =", overall, "(was 'weak' / 'Hard to win')");
console.log("  coveragePercent =", coveragePercent + "% (hero now shows this — was 0%)");

const invalidPills = reconciled.filter((c) => {
  const p = byField[c.field]?.payload ?? null;
  return classify(c.field, c.status, p).category === "invalid";
});
console.log("\nInvalid pills (must be 0 for this pack):", invalidPills.length);
if (invalidPills.length > 0) for (const c of invalidPills) console.log("  --> ", c.field);
process.exit(invalidPills.length === 0 && coveragePercent > 50 ? 0 : 1);
