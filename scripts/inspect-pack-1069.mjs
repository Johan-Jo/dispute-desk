import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const DISPUTE_ID = "39960467-4310-4943-a540-320050d9a4d6";

const { data: dispute } = await sb
  .from("disputes")
  .select("id, shop_id, dispute_evidence_gid, reason, amount, currency_code, customer_email, customer_display_name")
  .eq("id", DISPUTE_ID)
  .single();
console.log("── dispute ──");
console.log(dispute);

const { data: packs } = await sb
  .from("evidence_packs")
  .select("id, status, completeness_score, saved_to_shopify_at, updated_at, pack_json")
  .eq("dispute_id", DISPUTE_ID)
  .order("created_at", { ascending: false })
  .limit(3);

console.log("\n── packs ──");
for (const p of packs ?? []) {
  const packJson = p.pack_json ?? {};
  const sections = packJson.sections ?? [];
  const deviceLoc = packJson.device_location ?? null;
  const ipSection = sections.find((s) =>
    (s.fieldsProvided ?? []).includes("device_location_consistency") ||
    (s.fieldsProvided ?? []).includes("customer_ip"),
  );
  console.log({
    id: p.id,
    status: p.status,
    completeness_score: p.completeness_score,
    saved_to_shopify_at: p.saved_to_shopify_at,
    updated_at: p.updated_at,
    sections_count: sections.length,
    device_location_summary: deviceLoc,
    ip_section: ipSection ? {
      label: ipSection.label,
      fieldsProvided: ipSection.fieldsProvided,
      keys: Object.keys(ipSection.data ?? {}),
    } : null,
  });
}

const { data: jobs } = await sb
  .from("jobs")
  .select("id, job_type, status, attempts, last_error, created_at, updated_at")
  .eq("entity_id", packs?.[0]?.id ?? "")
  .order("created_at", { ascending: false })
  .limit(5);
console.log("\n── recent jobs for this pack ──");
console.log(JSON.stringify(jobs, null, 2));
