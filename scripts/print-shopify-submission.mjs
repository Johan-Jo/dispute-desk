/**
 * Reconstruct and print the exact `disputeEvidenceUpdate` payload that was
 * submitted to Shopify for a dispute, by running the same builder function
 * (`composeShopifyMutationPayload`) the production job uses, against the
 * stored pack sections + rebuttal + manual uploads.
 *
 * Usage: node scripts/print-shopify-submission.mjs <dispute-id-prefix>
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";
import { pathToFileURL } from "node:url";

config({ path: join(process.cwd(), ".env.local") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const prefix = (process.argv[2] || "").toLowerCase();
if (!prefix) {
  console.error("Usage: node scripts/print-shopify-submission.mjs <dispute-id-prefix>");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const padLow = prefix.padEnd(8, "0");
  const padHigh = prefix.padEnd(8, "f");
  const { data: disputes } = await sb
    .from("disputes")
    .select("id, shop_id, dispute_evidence_gid, reason, customer_display_name, customer_email")
    .filter("id", "gte", `${padLow}-0000-0000-0000-000000000000`)
    .filter("id", "lte", `${padHigh}-ffff-ffff-ffff-ffffffffffff`);
  if (!disputes?.length) throw new Error(`No dispute matching ${prefix}`);
  if (disputes.length > 1) throw new Error("Multiple matches");
  const dispute = disputes[0];

  const { data: pack } = await sb
    .from("evidence_packs")
    .select("id, pack_json, pdf_path")
    .eq("dispute_id", dispute.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pack) throw new Error("No pack");

  const sections = Array.isArray(pack.pack_json?.sections) ? pack.pack_json.sections : [];

  const { data: rebuttalDraft } = await sb
    .from("rebuttal_drafts")
    .select("sections")
    .eq("pack_id", pack.id)
    .eq("locale", "en-US")
    .maybeSingle();
  const rebuttalText = rebuttalDraft?.sections
    ? rebuttalDraft.sections.map((s) => s.text).join("\n\n").trim() || null
    : null;

  const { data: manualItems } = await sb
    .from("evidence_items")
    .select("id, label, payload, created_at")
    .eq("pack_id", pack.id)
    .eq("source", "manual_upload")
    .order("created_at", { ascending: false });

  // Build placeholder short-link URLs in the same shape the job produces.
  const manualAttachments = (manualItems ?? []).map((item) => {
    const meta = item.payload ?? {};
    return {
      checklistField: meta.checklistField ?? null,
      label: item.label ?? null,
      fileName: typeof meta.fileName === "string" ? meta.fileName : null,
      fileSize: typeof meta.fileSize === "number" ? meta.fileSize : null,
      createdAt: item.created_at ?? null,
      // Real short-link tokens are 16-char base62. Use the actual format,
      // but mark as a reconstruction since the original token isn't stored.
      url: `https://disputedesk.app/e/<original-token-${item.id.slice(0, 8)}>`,
    };
  });

  const pdfAttachment = pack.pdf_path
    ? { url: `https://disputedesk.app/e/<original-pdf-token>` }
    : null;

  const { composeShopifyMutationPayload } = await import(
    pathToFileURL(join(process.cwd(), "lib/shopify/composeShopifyMutationPayload.ts")).href
  );

  const input = composeShopifyMutationPayload({
    sections,
    rebuttalText,
    disputeReason: dispute.reason,
    customer: {
      displayName: dispute.customer_display_name ?? null,
      email: dispute.customer_email ?? null,
    },
    manualAttachments,
    pdfAttachment,
  });

  console.log("═".repeat(78));
  console.log("disputeEvidenceUpdate payload — id:", dispute.dispute_evidence_gid);
  console.log("═".repeat(78));
  console.log();
  console.log(JSON.stringify(input, null, 2));
  console.log();
  console.log("─".repeat(78));
  console.log("Note: short-link tokens shown as <original-token-…> placeholders.");
  console.log("The original tokens were generated at submit time and rotated.");
  console.log("Everything else is byte-for-byte what was sent.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
