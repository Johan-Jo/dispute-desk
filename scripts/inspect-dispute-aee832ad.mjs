/**
 * Diagnostic for dispute aee832ad-62d4-44dc-aa3e-fa7e3cafca93 +
 * Shopify dispute_evidences id 104951644734.
 *
 * Reports the full state of: dispute row, latest pack, rebuttal_drafts,
 * evidence_items (manual uploads), save_to_shopify jobs, audit_events,
 * and a live Shopify read of the disputeEvidence text fields.
 *
 * Comparison case: dispute 39960467-4310-4943-a540-320050d9a4d6.
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const NEW_DISPUTE_ID = "aee832ad-62d4-44dc-aa3e-fa7e3cafca93";
const OLD_DISPUTE_ID = "39960467-4310-4943-a540-320050d9a4d6";
const EXPECTED_EVIDENCE_ID = "104951644734";

function deserialize(raw) {
  const [ver, iv, tag, ct] = raw.split(":");
  return {
    keyVersion: parseInt(ver.slice(1), 10),
    iv: Buffer.from(iv, "hex"),
    tag: Buffer.from(tag, "hex"),
    ciphertext: Buffer.from(ct, "hex"),
  };
}
function decrypt(payload) {
  const envName = `TOKEN_ENCRYPTION_KEY_V${payload.keyVersion}`;
  let hex = process.env[envName];
  if (!hex && payload.keyVersion === 1) hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error(`missing ${envName}`);
  const key = Buffer.from(hex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, payload.iv);
  decipher.setAuthTag(payload.tag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString("utf8");
}

function preview(s, n = 200) {
  if (!s) return "<empty>";
  const flat = String(s).replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}

async function inspectDispute(disputeId, label) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${label}: ${disputeId}`);
  console.log("=".repeat(70));

  const { data: dispute } = await sb
    .from("disputes")
    .select(
      "id, shop_id, order_name, dispute_gid, dispute_evidence_gid, reason, status, customer_email, customer_display_name, submission_state, evidence_saved_to_shopify_at, amount, currency_code",
    )
    .eq("id", disputeId)
    .maybeSingle();

  if (!dispute) {
    console.log("dispute row NOT FOUND");
    return null;
  }
  console.log("\n── dispute ──");
  console.log(JSON.stringify(dispute, null, 2));

  const { data: packs } = await sb
    .from("evidence_packs")
    .select(
      "id, status, completeness_score, submission_readiness, saved_to_shopify_at, created_at, updated_at, pdf_path, pack_json",
    )
    .eq("dispute_id", disputeId)
    .order("created_at", { ascending: false });

  if (!packs?.length) {
    console.log("\n── packs ──");
    console.log("NO packs for this dispute");
    return { dispute, pack: null };
  }
  const pack = packs[0];
  console.log(`\n── packs (${packs.length} total, showing latest) ──`);
  for (const p of packs) {
    console.log(
      `  id=${p.id} status=${p.status} score=${p.completeness_score} readiness=${p.submission_readiness} saved_at=${p.saved_to_shopify_at} created=${p.created_at}`,
    );
  }

  const sections = pack.pack_json?.sections ?? [];
  console.log(`\n── latest pack sections (${sections.length}) ──`);
  for (const s of sections) {
    console.log(`  - type=${s.type} label=${s.label} source=${s.source ?? "?"}`);
  }

  const { data: rebuttal } = await sb
    .from("rebuttal_drafts")
    .select("locale, sections, source, created_at, updated_at")
    .eq("pack_id", pack.id);

  console.log(`\n── rebuttal_drafts (${rebuttal?.length ?? 0}) ──`);
  for (const r of rebuttal ?? []) {
    const secs = Array.isArray(r.sections) ? r.sections : [];
    const totalLen = secs.reduce(
      (acc, s) => acc + (typeof s?.text === "string" ? s.text.length : 0),
      0,
    );
    const joined = secs
      .map((s) => (typeof s?.text === "string" ? s.text : ""))
      .join("\n\n")
      .trim();
    console.log(
      `  locale=${r.locale} source=${r.source} sections=${secs.length} total_text_len=${totalLen}`,
    );
    console.log(`    preview: ${preview(joined)}`);
  }

  const { data: items } = await sb
    .from("evidence_items")
    .select("id, label, source, payload, created_at")
    .eq("pack_id", pack.id);

  console.log(`\n── evidence_items (${items?.length ?? 0}) ──`);
  for (const it of items ?? []) {
    const meta = it.payload ?? {};
    console.log(
      `  id=${it.id} source=${it.source} label=${JSON.stringify(it.label)} checklistField=${meta.checklistField ?? "<none>"} fileName=${meta.fileName ?? "<none>"}`,
    );
  }

  const { data: jobs } = await sb
    .from("jobs")
    .select(
      "id, job_type, status, attempts, last_error, created_at, claimed_at, completed_at, entity_id",
    )
    .eq("entity_id", pack.id)
    .eq("job_type", "save_to_shopify")
    .order("created_at", { ascending: false });

  console.log(`\n── save_to_shopify jobs (${jobs?.length ?? 0}) ──`);
  for (const j of jobs ?? []) {
    console.log(
      `  id=${j.id} status=${j.status} attempts=${j.attempts} created=${j.created_at} claimed=${j.claimed_at} completed=${j.completed_at}`,
    );
    if (j.last_error) console.log(`    last_error: ${preview(j.last_error, 400)}`);
  }

  const { data: audits } = await sb
    .from("audit_events")
    .select("id, event_type, actor_type, event_payload, created_at")
    .eq("pack_id", pack.id)
    .order("created_at", { ascending: true });

  console.log(`\n── audit_events for pack (${audits?.length ?? 0}) ──`);
  for (const a of audits ?? []) {
    console.log(
      `  ${a.created_at} ${a.actor_type}/${a.event_type}  ${preview(JSON.stringify(a.event_payload), 320)}`,
    );
  }

  return { dispute, pack };
}

async function liveShopifyRead(shopId, evidenceGid) {
  const { data: sessionRow } = await sb
    .from("shop_sessions")
    .select("shop_domain, access_token_encrypted")
    .eq("shop_id", shopId)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sessionRow) {
    console.log("\n── live Shopify read ──\nNO offline session for shop", shopId);
    return;
  }

  const token = decrypt(deserialize(sessionRow.access_token_encrypted));
  const endpoint = `https://${sessionRow.shop_domain}/admin/api/2026-01/graphql.json`;

  const query = `
    query($id: ID!) {
      node(id: $id) {
        ... on ShopifyPaymentsDisputeEvidence {
          id
          accessActivityLog
          cancellationPolicyDisclosure
          cancellationRebuttal
          customerEmailAddress
          customerFirstName
          customerLastName
          refundPolicyDisclosure
          refundRefusalExplanation
          uncategorizedText
        }
      }
    }
  `;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables: { id: evidenceGid } }),
  });
  const json = await res.json();
  console.log(`\n── live Shopify read (${evidenceGid}) ──`);
  if (json.errors) {
    console.log("GraphQL errors:", JSON.stringify(json.errors, null, 2));
  }
  const node = json?.data?.node;
  if (!node) {
    console.log("node is null — gid not found or wrong type");
    console.log("raw:", JSON.stringify(json).slice(0, 500));
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "id") {
      console.log(`  ${k}: ${v}`);
      continue;
    }
    console.log(`  ${k}: ${preview(v, 240)}`);
  }
}

const main = await inspectDispute(NEW_DISPUTE_ID, "NEW DISPUTE");
await inspectDispute(OLD_DISPUTE_ID, "OLD COMPARISON DISPUTE");

if (main?.dispute?.dispute_evidence_gid) {
  if (!main.dispute.dispute_evidence_gid.endsWith(`/${EXPECTED_EVIDENCE_ID}`)) {
    console.log(
      `\n!! WARNING: dispute_evidence_gid=${main.dispute.dispute_evidence_gid} does not end with /${EXPECTED_EVIDENCE_ID}`,
    );
  }
  await liveShopifyRead(main.dispute.shop_id, main.dispute.dispute_evidence_gid);
}
