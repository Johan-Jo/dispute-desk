#!/usr/bin/env node
/**
 * Diagnostic: verify whether a manually-uploaded dispute file GID
 * can be re-attached via disputeEvidenceUpdate.
 *
 * Runs 4 tests against Shopify Admin API (pinned version 2026-01):
 *   T1  Schema introspection — ShopifyPaymentsDisputeFileUploadUpdateInput
 *       + DisputeEvidenceUpdate input + ShopifyPaymentsDisputeEvidence fields
 *   T2  Dispute evidence read — inspect every *File field + uncategorizedFile
 *   T3  Extract a real file GID from the dispute and re-attach it via
 *       disputeEvidenceUpdate { customerCommunicationFile: { id } }
 *   T4  REST read /dispute_file_uploads.json to see what is actually attached
 *
 * Captures X-Request-Id on every call.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";

// ─────────────────────────────────────────────────────────────
// env
// ─────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = join(process.cwd(), ".env.local");
  const raw = readFileSync(envPath, "utf-8");
  const vars = {};
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\"/g, '"');
    else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    vars[key] = val;
  }
  return vars;
}

const env = { ...loadEnv(), ...process.env };
const API_VERSION = env.SHOPIFY_API_VERSION || "2026-01";

// ─────────────────────────────────────────────────────────────
// decrypt token (mirror of lib/security/encryption.ts)
// ─────────────────────────────────────────────────────────────
function decryptToken(raw) {
  const parts = raw.split(":");
  if (parts.length !== 4 || !parts[0].startsWith("v")) {
    throw new Error(`Bad encrypted payload: ${raw.slice(0, 20)}…`);
  }
  const version = parseInt(parts[0].slice(1), 10);
  const keyHex = env[`TOKEN_ENCRYPTION_KEY_V${version}`] || (version === 1 ? env.TOKEN_ENCRYPTION_KEY : null);
  if (!keyHex) throw new Error(`Missing TOKEN_ENCRYPTION_KEY_V${version}`);
  const key = Buffer.from(keyHex, "hex");
  const iv = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const ct = Buffer.from(parts[3], "hex");
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

// ─────────────────────────────────────────────────────────────
// Shopify client with X-Request-Id capture
// ─────────────────────────────────────────────────────────────
async function gql(shop, token, query, variables = {}) {
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const requestId = res.headers.get("x-request-id");
  const body = await res.json();
  return { status: res.status, requestId, data: body?.data, errors: body?.errors || [], raw: body };
}

async function rest(shop, token, method, path, body) {
  const url = `https://${shop}/admin/api/${API_VERSION}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const requestId = res.headers.get("x-request-id");
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, requestId, body: parsed };
}

// ─────────────────────────────────────────────────────────────
// find an online session + candidate dispute
// ─────────────────────────────────────────────────────────────
async function pickSessionAndDispute() {
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Find the shop that actually has disputes with evidence GIDs
  const { data: disputeRow } = await sb
    .from("disputes")
    .select("shop_id")
    .not("dispute_evidence_gid", "is", null)
    .order("initiated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!disputeRow) throw new Error("No disputes with evidence GID in DB");

  const targetShopId = disputeRow.shop_id;

  // Try online first (required for writes); fall back to offline for reads
  const { data: allSessions } = await sb
    .from("shop_sessions")
    .select("shop_id, shop_domain, access_token_encrypted, created_at, session_type")
    .eq("shop_id", targetShopId)
    .order("created_at", { ascending: false });

  const online = (allSessions || []).find(s => s.session_type === "online");
  const offline = (allSessions || []).find(s => s.session_type === "offline");
  if (!online && !offline) throw new Error("No session for target shop");

  const chosen = offline || online; // offline is more durable for reads
  const onlineAgeDays = online ? ((Date.now() - new Date(online.created_at).getTime()) / 86400000).toFixed(1) : null;

  const accessToken = decryptToken(chosen.access_token_encrypted);
  const onlineToken = online ? decryptToken(online.access_token_encrypted) : null;

  const { data: disputes } = await sb
    .from("disputes")
    .select("id, dispute_gid, dispute_evidence_gid, reason, status")
    .eq("shop_id", targetShopId)
    .not("dispute_evidence_gid", "is", null)
    .order("initiated_at", { ascending: false })
    .limit(20);

  return {
    shop: chosen.shop_domain,
    token: accessToken,
    tokenKind: chosen.session_type,
    onlineToken,
    onlineAgeDays,
    disputes: disputes || [],
  };
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────
function banner(t) {
  console.log("\n" + "═".repeat(72));
  console.log("  " + t);
  console.log("═".repeat(72));
}

async function testIntrospection(shop, token) {
  banner("T1 — Schema introspection (file-upload input + evidence fields)");
  const results = {};

  // (a) ShopifyPaymentsDisputeFileUploadUpdateInput
  const q1 = `
    query {
      __type(name: "ShopifyPaymentsDisputeFileUploadUpdateInput") {
        name
        kind
        inputFields {
          name
          type { name kind ofType { name kind } }
          defaultValue
        }
      }
    }`;
  const r1 = await gql(shop, token, q1);
  console.log("\n[T1a] ShopifyPaymentsDisputeFileUploadUpdateInput");
  console.log("  X-Request-Id:", r1.requestId);
  if (r1.data?.__type) {
    console.log("  inputFields:");
    for (const f of r1.data.__type.inputFields) {
      const tn = f.type.name || f.type.ofType?.name || f.type.kind;
      console.log(`    - ${f.name}: ${tn}`);
    }
    results.fileUploadInput = r1.data.__type.inputFields.map(f => f.name);
  } else {
    console.log("  NOT FOUND:", JSON.stringify(r1.errors));
    results.fileUploadInput = null;
  }

  // (b) ShopifyPaymentsDisputeEvidenceUpdateInput
  const q2 = `
    query {
      __type(name: "ShopifyPaymentsDisputeEvidenceUpdateInput") {
        name
        inputFields { name type { name kind ofType { name kind } } }
      }
    }`;
  const r2 = await gql(shop, token, q2);
  console.log("\n[T1b] ShopifyPaymentsDisputeEvidenceUpdateInput");
  console.log("  X-Request-Id:", r2.requestId);
  if (r2.data?.__type) {
    for (const f of r2.data.__type.inputFields) {
      const tn = f.type.name || f.type.ofType?.name || f.type.kind;
      console.log(`    - ${f.name}: ${tn}`);
    }
    results.updateInput = r2.data.__type.inputFields.map(f => f.name);
  }

  // (c) ShopifyPaymentsDisputeEvidence (readable)
  const q3 = `
    query {
      __type(name: "ShopifyPaymentsDisputeEvidence") {
        name
        fields { name type { name kind ofType { name kind } } }
      }
    }`;
  const r3 = await gql(shop, token, q3);
  console.log("\n[T1c] ShopifyPaymentsDisputeEvidence (readable fields)");
  console.log("  X-Request-Id:", r3.requestId);
  if (r3.data?.__type) {
    for (const f of r3.data.__type.fields) {
      const tn = f.type.name || f.type.ofType?.name || f.type.kind;
      if (/file|upload/i.test(f.name) || /file|upload/i.test(tn || "")) {
        console.log(`    - ${f.name}: ${tn}`);
      }
    }
    results.evidenceFields = r3.data.__type.fields.map(f => f.name);
  }

  // (d) ShopifyPaymentsDisputeFileUpload type — can it be read directly?
  const q4 = `
    query {
      __type(name: "ShopifyPaymentsDisputeFileUpload") {
        name
        kind
        fields { name type { name kind ofType { name kind } } }
      }
    }`;
  const r4 = await gql(shop, token, q4);
  console.log("\n[T1d] ShopifyPaymentsDisputeFileUpload type");
  console.log("  X-Request-Id:", r4.requestId);
  if (r4.data?.__type) {
    console.log("  kind:", r4.data.__type.kind);
    for (const f of (r4.data.__type.fields || [])) {
      const tn = f.type.name || f.type.ofType?.name || f.type.kind;
      console.log(`    - ${f.name}: ${tn}`);
    }
    results.fileUploadType = r4.data.__type.fields?.map(f => f.name) || [];
  } else {
    console.log("  NOT FOUND:", JSON.stringify(r4.errors));
    results.fileUploadType = null;
  }

  return results;
}

async function testReadEvidence(shop, token, disputeGid) {
  banner("T2 — Read dispute evidence file fields");
  const q = `
    query($id: ID!) {
      dispute(id: $id) {
        id
        status
        disputeEvidence {
          id
          uncategorizedText
          uncategorizedFile { id }
          cancellationPolicyFile { id }
          customerCommunicationFile { id }
          refundPolicyFile { id }
          serviceDocumentationFile { id }
          shippingDocumentationFile { id }
        }
      }
    }`;
  const r = await gql(shop, token, q, { id: disputeGid });
  console.log("  Dispute GID:", disputeGid);
  console.log("  X-Request-Id:", r.requestId);
  console.log("  status:", r.status);
  if (r.errors?.length) {
    console.log("  GraphQL errors:", JSON.stringify(r.errors, null, 2));
  }
  console.log("  data:", JSON.stringify(r.data, null, 2));
  return r.data?.dispute?.disputeEvidence;
}

async function testRestListFiles(shop, token, disputeGid) {
  banner("T4 — REST: list dispute file uploads");
  const numeric = disputeGid.match(/\/(\d+)$/)?.[1];
  if (!numeric) throw new Error(`bad dispute GID: ${disputeGid}`);

  const paths = [
    `/shopify_payments/disputes/${numeric}/dispute_file_uploads.json`,
    `/shopify_payments/disputes/${numeric}/dispute_evidences.json`,
  ];
  const out = {};
  for (const p of paths) {
    const r = await rest(shop, token, "GET", p);
    console.log(`\n  GET ${p}`);
    console.log("    status:", r.status, "X-Request-Id:", r.requestId);
    console.log("    body:", typeof r.body === "string" ? r.body.slice(0, 400) : JSON.stringify(r.body, null, 2).slice(0, 1200));
    out[p] = { status: r.status, requestId: r.requestId, body: r.body };
  }
  return out;
}

async function testReattach(shop, token, disputeEvidenceGid, fileGid) {
  banner("T3 — Re-attach a real file GID via disputeEvidenceUpdate");
  console.log("  Evidence GID:", disputeEvidenceGid);
  console.log("  File GID:     ", fileGid);

  const mutation = `
    mutation($id: ID!, $input: ShopifyPaymentsDisputeEvidenceUpdateInput!) {
      disputeEvidenceUpdate(id: $id, input: $input) {
        disputeEvidence { id }
        userErrors { field message }
      }
    }`;

  const attempts = [
    { name: "customerCommunicationFile", input: { customerCommunicationFile: { id: fileGid } } },
    { name: "uncategorizedFile",          input: { uncategorizedFile:          { id: fileGid } } },
    { name: "shippingDocumentationFile",  input: { shippingDocumentationFile:  { id: fileGid } } },
  ];

  const results = [];
  for (const a of attempts) {
    const r = await gql(shop, token, mutation, { id: disputeEvidenceGid, input: a.input });
    const ue = r.data?.disputeEvidenceUpdate?.userErrors || [];
    const ok = r.status === 200 && !r.errors?.length && ue.length === 0;
    console.log(`\n  [${a.name}]`);
    console.log("    status:", r.status, "X-Request-Id:", r.requestId, "→", ok ? "OK" : "FAIL");
    if (r.errors?.length) console.log("    errors:", JSON.stringify(r.errors, null, 2));
    if (ue.length)        console.log("    userErrors:", JSON.stringify(ue, null, 2));
    results.push({ field: a.name, ok, requestId: r.requestId, errors: r.errors, userErrors: ue });
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────
(async () => {
  const { shop, token, tokenKind, onlineToken, onlineAgeDays, disputes } = await pickSessionAndDispute();
  console.log("Shop:", shop);
  console.log("API version:", API_VERSION);
  console.log("Read token kind:", tokenKind);
  console.log("Online token available:", !!onlineToken, onlineAgeDays ? `(age ${onlineAgeDays}d, Shopify online expiry ≈ 1d)` : "");
  console.log("Candidate disputes:", disputes.length);

  // Introspection first (doesn't need a dispute)
  const t1 = await testIntrospection(shop, token);

  if (!disputes.length) {
    console.log("\n[halt] No disputes with evidence GID to test T2/T3/T4.");
    return;
  }

  // Find a dispute where at least one file field is non-null
  let chosen = null;
  let evidence = null;
  for (const d of disputes) {
    const ev = await testReadEvidence(shop, token, d.dispute_gid);
    const hasFile = ev && Object.entries(ev).some(
      ([k, v]) => k.endsWith("File") && v && typeof v === "object" && v.id,
    );
    if (hasFile) {
      chosen = d;
      evidence = ev;
      break;
    }
  }
  if (!chosen) {
    console.log("\n[halt] No dispute in the sample had a file attached via any *File field.");
    console.log("        Re-run after manually uploading a file to one of the disputes in Shopify Admin.");
    return;
  }

  console.log("\nChosen dispute:", chosen.dispute_gid, "reason:", chosen.reason);

  // Pick any non-null file GID
  const [fileField, fileNode] = Object.entries(evidence)
    .find(([k, v]) => k.endsWith("File") && v && typeof v === "object" && v.id);
  console.log("Using file GID from field", fileField, "→", fileNode.id);

  // T3 requires an online token; use it if present, else try offline and report the exact failure
  const writeToken = onlineToken || token;
  const t3 = await testReattach(shop, writeToken, evidence.id, fileNode.id);
  const t4 = await testRestListFiles(shop, token, chosen.dispute_gid);

  // T3b: try re-attaching the same file GID to a dispute whose due date has NOT passed
  //       (status === 'needs_response') — this isolates the due-date block from schema issues.
  banner("T3b — Re-attach same file GID to a NEEDS_RESPONSE dispute");
  const active = disputes.find(d => (d.status || "").toLowerCase() === "needs_response");
  let t3b = null;
  if (!active) {
    console.log("  skipped: no NEEDS_RESPONSE dispute in sample");
  } else {
    const activeEv = await testReadEvidence(shop, token, active.dispute_gid);
    if (!activeEv) {
      console.log("  could not read active dispute evidence");
    } else {
      console.log("  Active dispute:", active.dispute_gid, "status:", active.status);
      console.log("  Active evidence:", activeEv.id);
      t3b = await testReattach(shop, writeToken, activeEv.id, fileNode.id);
    }
  }

  // Summary
  banner("SUMMARY");
  console.log(JSON.stringify({
    shop,
    apiVersion: API_VERSION,
    chosenDispute: chosen.dispute_gid,
    evidenceGid: evidence.id,
    fileGidUsed: fileNode.id,
    t1_introspection: {
      ShopifyPaymentsDisputeFileUploadUpdateInput: t1.fileUploadInput,
      ShopifyPaymentsDisputeFileUpload_type: t1.fileUploadType,
    },
    t3_reattach_results: t3,
    t3b_reattach_on_active_dispute: t3b,
    t4_rest_paths_tried: Object.keys(t4).map(p => ({ path: p, status: t4[p].status, requestId: t4[p].requestId })),
  }, null, 2));
})().catch(err => { console.error("FATAL:", err); process.exit(1); });
