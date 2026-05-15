/**
 * Debug helper: try the same evidence_packs update buildPack does at
 * line 589, with error logging, to see what's silently failing.
 *
 * Usage:
 *   node scripts/debug-pack-update.mjs <pack-id>
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const packId = process.argv[2];
if (!packId) {
  console.error("Usage: node scripts/debug-pack-update.mjs <pack-id>");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const packJson = {
  version: 1,
  generatedAt: new Date().toISOString(),
  disputeReason: "FRAUDULENT",
  sections: [],
  completeness: { score: 0, checklist: [], blockers: [], recommended_actions: [] },
  device_location: null,
  coverage: { state: "not_covered" },
  case_strength: { overall: "weak", strongCount: 0, moderateCount: 0, supportingCount: 0 },
  fatal_loss: { triggered: false, reason: null, message: null },
  risk_weakness: {
    triggered: true,
    reason: "high_risk_fulfilled",
    message: "Shopify flagged this order as high-risk.",
    diagnostics: { riskLevel: "HIGH", recommendation: "INVESTIGATE", fulfillmentCount: 1 },
  },
};

const result = await sb
  .from("evidence_packs")
  .update({
    status: "failed",
    pack_json: packJson,
    completeness_score: 0,
    checklist: null,
    blockers: null,
    recommended_actions: null,
    checklist_v2: null,
    submission_readiness: null,
    failure_code: "order_fetch_failed",
    failure_reason: "Test from debug script",
    updated_at: new Date().toISOString(),
  })
  .eq("id", packId)
  .select("id, status, pack_json");

console.log("Update result:");
console.log(JSON.stringify(result, null, 2));
