/**
 * Probe A — introspect the exact DisputeFileUploadInput shape so we know
 * what `id` field type Shopify expects.
 * Probe B — call stagedUploadsCreate with resource DISPUTE_FILE_UPLOAD and
 * print the returned stagedTargets verbatim.
 * Probe C — attempt disputeEvidenceUpdate using the stagedTargets.resourceUrl
 * as { uncategorizedFile: { id: resourceUrl } } to observe Shopify's
 * actual rejection/acceptance message.
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";
const DISPUTE_EVIDENCE_GID = "gid://shopify/ShopifyPaymentsDisputeEvidence/10486054969";

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

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
  const key = Buffer.from(hex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, payload.iv);
  decipher.setAuthTag(payload.tag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString("utf8");
}

const { data: sessionRow } = await sb
  .from("shop_sessions")
  .select("shop_domain, access_token_encrypted")
  .eq("shop_id", SHOP_ID)
  .eq("session_type", "offline")
  .is("user_id", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

const accessToken = decrypt(deserialize(sessionRow.access_token_encrypted));
const endpoint = `https://${sessionRow.shop_domain}/admin/api/2025-04/graphql.json`;

async function gql(q, v) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query: q, variables: v }),
  });
  const body = await res.json();
  return { status: res.status, requestId: res.headers.get("x-request-id"), body };
}

// ── Probe A: introspect DisputeFileUpload input types ──
console.log("\n══ Probe A: DisputeFileUploadInput introspection ══");
const nameCandidates = [
  "DisputeFileUploadInput",
  "ShopifyPaymentsDisputeFileUploadInput",
  "ShopifyPaymentsDisputeFileUploadUpdateInput",
];
for (const name of nameCandidates) {
  const r = await gql(
    `query { __type(name: "${name}") { name kind inputFields { name type { name kind ofType { name kind } } } } }`,
  );
  const t = r.body.data?.__type;
  if (!t) {
    console.log(`  ${name}: NOT FOUND`);
    continue;
  }
  console.log(`  ${name} (${t.kind}):`);
  for (const f of t.inputFields ?? []) {
    const tn = f.type.name ?? f.type.ofType?.name ?? f.type.kind;
    console.log(`    ${f.name}: ${tn}${f.type.kind === "NON_NULL" ? "!" : ""}`);
  }
}

// ── Probe B: stagedUploadsCreate ──
console.log("\n══ Probe B: stagedUploadsCreate with DISPUTE_FILE_UPLOAD ══");
const stagedMutation = `
  mutation($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;
const stagedResp = await gql(stagedMutation, {
  input: [{
    resource: "DISPUTE_FILE_UPLOAD",
    filename: "probe-evidence.pdf",
    mimeType: "application/pdf",
    httpMethod: "POST",
  }],
});
console.log(`HTTP ${stagedResp.status} X-Request-Id=${stagedResp.requestId}`);
console.log(JSON.stringify(stagedResp.body, null, 2));

// ── Probe C: try to use the resourceUrl directly on disputeEvidenceUpdate ──
const target = stagedResp.body.data?.stagedUploadsCreate?.stagedTargets?.[0];
if (target?.resourceUrl) {
  console.log("\n══ Probe C: pass resourceUrl as uncategorizedFile.id (DO NOT EXPECT SUCCESS) ══");
  const updateMutation = `
    mutation($id: ID!, $input: ShopifyPaymentsDisputeEvidenceUpdateInput!) {
      disputeEvidenceUpdate(id: $id, input: $input) {
        disputeEvidence { id }
        userErrors { field message }
      }
    }
  `;
  const r = await gql(updateMutation, {
    id: DISPUTE_EVIDENCE_GID,
    input: { uncategorizedFile: { id: target.resourceUrl } },
  });
  console.log(`HTTP ${r.status} X-Request-Id=${r.requestId}`);
  console.log(JSON.stringify(r.body, null, 2));
}

// ── Probe D: see what __type returns for the existing Shopify example's id ──
// We have a known good attached-file case — probe-file-gid.mjs mentioned that
// a real dispute in prod HAS a file attached whose id starts with
// gid://shopify/ShopifyPaymentsDisputeFileUpload/. Introspect that ObjectType:
console.log("\n══ Probe D: ShopifyPaymentsDisputeFileUpload type ══");
const r4 = await gql(`query { __type(name: "ShopifyPaymentsDisputeFileUpload") { name kind fields { name type { name kind ofType { name kind } } } } }`);
console.log(JSON.stringify(r4.body.data?.__type, null, 2));
