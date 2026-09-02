/**
 * Build EXACTLY ONE evidence pack for a single dispute.
 *
 * Mirrors the manual build path in `app/api/disputes/[id]/packs/route.ts`
 * (quota check → refuse if an active pack exists → insert evidence_packs →
 * enqueue build_pack → audit event). That route needs an embedded Shopify
 * session, which a script cannot present, so the same two inserts are made
 * directly with the service-role key. Nothing else is replicated and no other
 * dispute is touched.
 *
 * Deliberately single-shot. It takes one dispute id, refuses if a pack already
 * exists, and has no batch mode — a canary that can accidentally become a bulk
 * run is not a canary.
 *
 * Usage:
 *   node scripts/build-one-pack.mjs <dispute-id> [--env-file .env.production.local]
 *                                                [--template <uuid>] [--apply]
 *
 * Without --apply it prints the plan and exits without writing.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

const argv = process.argv.slice(2);
const disputeId = argv.find((a) => !a.startsWith("--"));
const apply = argv.includes("--apply");
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const envFile = flag("--env-file") ?? ".env.production.local";
const templateId = flag("--template");

if (!disputeId) {
  console.error("Usage: node scripts/build-one-pack.mjs <dispute-id> [--apply]");
  process.exit(1);
}

config({ path: join(process.cwd(), envFile) });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(`Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in ${envFile}`);
  process.exit(1);
}

// Same discipline as scripts/guard-db-target.mjs: say which database this is,
// out loud, before writing anything.
const PROJECT_REFS = {
  aokhplydttxtebvbeuzc: "PROD",
  vrpkgudqmpyunekrkpnc: "dev",
};
const ref = new URL(url).hostname.split(".")[0];
const envName = PROJECT_REFS[ref] ?? "UNKNOWN";
console.log(`env-file : ${envFile}`);
console.log(`database : ${ref} (${envName})`);
if (envName === "UNKNOWN") {
  console.error("Refusing: unrecognised Supabase project ref.");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: dispute, error: dErr } = await sb
    .from("disputes")
    .select("id, shop_id, reason, phase, status, amount, order_gid, initiated_at")
    .eq("id", disputeId)
    .single();
  if (dErr || !dispute) {
    console.error("Dispute not found:", dErr?.message);
    process.exit(1);
  }

  const { data: shop } = await sb
    .from("shops")
    .select("shop_domain")
    .eq("id", dispute.shop_id)
    .single();

  console.log(`shop     : ${shop?.shop_domain ?? dispute.shop_id}`);
  console.log(
    `dispute  : ${dispute.reason} / ${dispute.phase} / ${dispute.status} ` +
      `— ${dispute.amount} — arrived ${dispute.initiated_at}`,
  );

  // Quota, read the same table checkPackQuota reads.
  const { data: bal } = await sb
    .from("pack_balance")
    .select("remaining_packs, total_credits, total_used")
    .eq("shop_id", dispute.shop_id)
    .maybeSingle();
  console.log(
    `credits  : ${bal?.remaining_packs ?? "?"} remaining ` +
      `(${bal?.total_used ?? "?"} used of ${bal?.total_credits ?? "?"})`,
  );
  if (bal && bal.remaining_packs <= 0) {
    console.error("Refusing: no pack credits remaining.");
    process.exit(1);
  }

  // The route returns the existing pack rather than building a second one.
  // Here that is a hard refusal: a silent no-op would look like a build.
  const { data: existing } = await sb
    .from("evidence_packs")
    .select("id, status, created_at")
    .eq("dispute_id", disputeId)
    .not("status", "in", '("failed","archived")')
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    console.error(
      `Refusing: active pack ${existing.id} already exists ` +
        `(status ${existing.status}, created ${existing.created_at}).`,
    );
    process.exit(1);
  }

  console.log(`template : ${templateId ?? "<none — buildPack resolves>"}`);

  if (!apply) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to build.");
    return;
  }

  const { data: pack, error: packErr } = await sb
    .from("evidence_packs")
    .insert({
      shop_id: dispute.shop_id,
      dispute_id: disputeId,
      status: "queued",
      created_by: "manual",
      ...(templateId ? { pack_template_id: templateId } : {}),
    })
    .select("id")
    .single();
  if (packErr || !pack) {
    console.error("Failed to create pack:", packErr?.message);
    process.exit(1);
  }

  const { data: job, error: jobErr } = await sb
    .from("jobs")
    .insert({
      shop_id: dispute.shop_id,
      job_type: "build_pack",
      entity_id: pack.id,
    })
    .select("id")
    .single();
  if (jobErr || !job) {
    console.error("Pack created but job enqueue FAILED:", jobErr?.message);
    console.error(`Orphan pack: ${pack.id} — archive it before retrying.`);
    process.exit(1);
  }

  await sb.from("audit_events").insert({
    shop_id: dispute.shop_id,
    dispute_id: disputeId,
    pack_id: pack.id,
    actor_type: "merchant",
    event_type: "job_queued",
    event_payload: {
      jobId: job.id,
      trigger: templateId ? "manual_template" : "manual_generate",
      template_id: templateId ?? null,
      note: "single-pack canary via scripts/build-one-pack.mjs",
    },
  });

  console.log(`\nBUILT  pack=${pack.id}  job=${job.id}`);
  console.log("The deployed worker picks this up; poll evidence_packs.status.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
