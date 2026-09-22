/**
 * Re-attempt submission for evidence that DisputeDesk wrote but Shopify never
 * accepted (fields present on the evidence object, `evidenceSentOn` still null).
 *
 * See docs/plans/submission-confirmation-gap.plan.md §0.
 *
 * This sends ONLY the control field — `{ submitEvidence: true }`. It does not
 * touch, re-send or regenerate any evidence content: the text and files are
 * already on Shopify's evidence object and were confirmed by read-back. The
 * full before/after evidence object is snapshotted to disk either way so a
 * wipe would be recoverable.
 *
 * Usage:
 *   node scripts/shopify/resubmit-stuck-evidence.mjs <disputeUuid>            # dry run
 *   node scripts/shopify/resubmit-stuck-evidence.mjs <disputeUuid> --submit   # act
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

for (const line of fs.readFileSync(".env.production.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

function dec(b) {
  const [v, i, t, c] = b.split(":");
  const ver = v.replace(/^v/, "");
  const k = process.env[`TOKEN_ENCRYPTION_KEY_V${ver}`] || process.env.TOKEN_ENCRYPTION_KEY;
  const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(k, "hex"), Buffer.from(i, "hex"));
  d.setAuthTag(Buffer.from(t, "hex"));
  return d.update(Buffer.from(c, "hex"), undefined, "utf8") + d.final("utf8");
}

const args = process.argv.slice(2);
const SUBMIT = args.includes("--submit");
const disputeId = args.find((a) => !a.startsWith("--"));
if (!disputeId) throw new Error("pass a dispute uuid");

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: d } = await sb
  .from("disputes")
  .select("id, shop_id, dispute_gid, dispute_evidence_gid, amount, currency_code, due_at, submission_state")
  .eq("id", disputeId)
  .single();
const { data: shop } = await sb.from("shops").select("shop_domain").eq("id", d.shop_id).single();
const { data: sess } = await sb
  .from("shop_sessions")
  .select("access_token_encrypted")
  .eq("shop_id", d.shop_id)
  .eq("session_type", "offline")
  .is("user_id", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .single();

const token = dec(sess.access_token_encrypted);
const API = process.env.SHOPIFY_API_VERSION || "2026-01";
const url = `https://${shop.shop_domain}/admin/api/${API}/graphql.json`;
const gql = async (query, variables) => {
  const r = await fetch(url, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
};

const READ = `
  query Read($id: ID!) {
    node(id: $id) {
      ... on ShopifyPaymentsDispute {
        id status type evidenceDueBy evidenceSentOn finalizedOn
        amount { amount currencyCode }
        disputeEvidence {
          id
          accessActivityLog cancellationPolicyDisclosure cancellationRebuttal
          customerEmailAddress customerFirstName customerLastName
          refundPolicyDisclosure refundRefusalExplanation uncategorizedText
          cancellationPolicyFile { id } customerCommunicationFile { id }
          refundPolicyFile { id } shippingDocumentationFile { id }
          uncategorizedFile { id } serviceDocumentationFile { id }
        }
      }
    }
  }
`;

const MUTATE = `
  mutation DisputeEvidenceUpdate($id: ID!, $input: ShopifyPaymentsDisputeEvidenceUpdateInput!) {
    disputeEvidenceUpdate(id: $id, input: $input) {
      disputeEvidence { id }
      userErrors { field message }
    }
  }
`;

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const snapDir = "scripts/.snapshots";
fs.mkdirSync(snapDir, { recursive: true });

const before = await gql(READ, { id: d.dispute_gid });
fs.writeFileSync(`${snapDir}/${disputeId}-before-${stamp}.json`, JSON.stringify(before, null, 2));
const nb = before.data?.node;
console.log(`dispute      : ${disputeId}  (${shop.shop_domain})`);
console.log(`amount       : ${nb?.amount?.amount} ${nb?.amount?.currencyCode}`);
console.log(`status       : ${nb?.status}`);
console.log(`evidenceSentOn BEFORE : ${nb?.evidenceSentOn ?? "NULL"}`);
console.log(`evidenceDueBy         : ${nb?.evidenceDueBy}`);
console.log(`evidence gid          : ${nb?.disputeEvidence?.id}`);
console.log(`snapshot     : ${snapDir}/${disputeId}-before-${stamp}.json`);

if (nb?.evidenceSentOn) {
  console.log("\nALREADY SUBMITTED — refusing to touch it. Nothing to do.");
  process.exit(0);
}
if (nb?.status !== "NEEDS_RESPONSE") {
  console.log(`\nstatus is ${nb?.status}, not NEEDS_RESPONSE — window not open. Refusing.`);
  process.exit(0);
}
if (!SUBMIT) {
  console.log("\nDRY RUN. Re-run with --submit to send { submitEvidence: true }.");
  process.exit(0);
}

const res = await gql(MUTATE, {
  id: nb.disputeEvidence.id,
  input: { submitEvidence: true },
});
console.log("\nmutation response:", JSON.stringify(res, null, 2));

await new Promise((r) => setTimeout(r, 3000));
const after = await gql(READ, { id: d.dispute_gid });
fs.writeFileSync(`${snapDir}/${disputeId}-after-${stamp}.json`, JSON.stringify(after, null, 2));
const na = after.data?.node;
console.log(`\nevidenceSentOn AFTER : ${na?.evidenceSentOn ?? "STILL NULL"}`);
console.log(`status AFTER         : ${na?.status}`);

const fieldsBefore = Object.entries(nb.disputeEvidence).filter(([k, v]) => k !== "id" && v != null).map(([k]) => k);
const fieldsAfter = Object.entries(na?.disputeEvidence ?? {}).filter(([k, v]) => k !== "id" && v != null).map(([k]) => k);
const lost = fieldsBefore.filter((f) => !fieldsAfter.includes(f));
console.log(`fields before : ${fieldsBefore.join(", ")}`);
console.log(`fields after  : ${fieldsAfter.join(", ")}`);
console.log(lost.length ? `!! FIELDS LOST: ${lost.join(", ")} — restore from snapshot` : "fields intact");
console.log(na?.evidenceSentOn ? "\nRESULT: SUBMITTED" : "\nRESULT: NO-OP (Shopify bug reproduced)");
