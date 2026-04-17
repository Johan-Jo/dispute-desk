#!/usr/bin/env node
/**
 * Produce the exact artefacts Shopify Support requested:
 *   1. API versions tested
 *   2. One sanitized stagedUploadsCreate response (GraphQL)
 *   3. One sanitized x-request-id for a failed POST /dispute_file_uploads.json
 *
 * Sanitization: shop domain → "{SHOP}.myshopify.com", dispute numeric id → "{DISPUTE_ID}",
 * tokens never logged, staged-upload URLs redacted to host+path (no signed params).
 */

import { readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";

function loadEnv() {
  const raw = readFileSync(join(process.cwd(), ".env.local"), "utf-8");
  const vars = {};
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    vars[k] = v;
  }
  return vars;
}
const env = { ...loadEnv(), ...process.env };
const API_VERSION = env.SHOPIFY_API_VERSION || "2026-01";

function decryptToken(raw) {
  const parts = raw.split(":");
  const version = parseInt(parts[0].slice(1), 10);
  const keyHex = env[`TOKEN_ENCRYPTION_KEY_V${version}`] || (version === 1 ? env.TOKEN_ENCRYPTION_KEY : null);
  const key = Buffer.from(keyHex, "hex");
  const iv = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const ct = Buffer.from(parts[3], "hex");
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

async function pickSession() {
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: dRow } = await sb.from("disputes")
    .select("shop_id, dispute_gid, status")
    .not("dispute_evidence_gid", "is", null)
    .order("initiated_at", { ascending: false })
    .limit(50);
  if (!dRow?.length) throw new Error("no disputes");

  const { data: sess } = await sb.from("shop_sessions")
    .select("shop_domain, access_token_encrypted, session_type, created_at")
    .eq("shop_id", dRow[0].shop_id)
    .order("created_at", { ascending: false });
  const offline = sess.find(s => s.session_type === "offline");
  const token = decryptToken(offline.access_token_encrypted);

  // Prefer an active dispute for the POST call
  const active = dRow.find(d => (d.status || "").toLowerCase() === "needs_response") || dRow[0];
  return { shop: offline.shop_domain, token, disputeGid: active.dispute_gid, status: active.status };
}

function sanitizeShop(shop, s) {
  if (typeof s !== "string") return s;
  return s.replaceAll(shop, "{SHOP}.myshopify.com")
          .replace(/\/admin\/api\/[^/]+\//g, `/admin/api/${API_VERSION}/`);
}
function redactUrl(u) {
  try {
    const url = new URL(u);
    return `${url.protocol}//${url.host}${url.pathname} [query redacted: ${[...url.searchParams.keys()].join(", ")}]`;
  } catch { return u; }
}
function sanitizeStagedResp(json) {
  const out = JSON.parse(JSON.stringify(json));
  const targets = out?.data?.stagedUploadsCreate?.stagedTargets;
  if (Array.isArray(targets)) {
    for (const t of targets) {
      if (t.url) t.url = redactUrl(t.url);
      if (t.resourceUrl) t.resourceUrl = redactUrl(t.resourceUrl);
      if (Array.isArray(t.parameters)) {
        t.parameters = t.parameters.map(p => ({ name: p.name, value: "{REDACTED}" }));
      }
    }
  }
  return out;
}

async function gql(shop, token, query, variables) {
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  return { status: res.status, requestId: res.headers.get("x-request-id"), body: await res.json() };
}

async function rest(shop, token, method, path, body) {
  const url = `https://${shop}/admin/api/${API_VERSION}${path}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, requestId: res.headers.get("x-request-id"), body: parsed };
}

(async () => {
  const { shop, token, disputeGid, status } = await pickSession();
  const disputeNumeric = disputeGid.match(/\/(\d+)$/)?.[1];

  // ── (1) API version ──────────────────────────────────────────
  const apiInfo = {
    graphql_admin_api_version: API_VERSION,
    rest_admin_api_version: API_VERSION,
    test_timestamp_utc: new Date().toISOString(),
    dispute_status_used_for_post: status,
  };

  // ── (2) stagedUploadsCreate ──────────────────────────────────
  const stagedMutation = `
    mutation($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }`;
  const stagedVars = {
    input: [{
      resource: "FILE",
      filename: "dispute_evidence_probe.pdf",
      mimeType: "application/pdf",
      httpMethod: "POST",
      fileSize: "1024",
    }],
  };
  const staged = await gql(shop, token, stagedMutation, stagedVars);
  const stagedSanitized = sanitizeStagedResp(staged.body);

  // Also try resource: "BULK_MUTATION_VARIABLES" is not relevant; try resource types Shopify documents for files
  // Keep to one call per support's request.

  // ── (3) POST /dispute_file_uploads.json ──────────────────────
  const tinyPdfBase64 =
    "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDAvS2lkc1tdPj4KZW5kb2JqCnRyYWlsZXIKPDwvUm9vdCAxIDAgUj4+CiUlRU9G";
  const restPost = await rest(shop, token, "POST",
    `/shopify_payments/disputes/${disputeNumeric}/dispute_file_uploads.json`,
    {
      dispute_file_upload: {
        document_type: "UNCATEGORIZED_FILE",
        filename: "probe.pdf",
        mimetype: "application/pdf",
        data: tinyPdfBase64,
      },
    });

  // ── Sanitized output ─────────────────────────────────────────
  const report = {
    api_versions_tested: apiInfo,
    stagedUploadsCreate: {
      request_id: staged.requestId,
      http_status: staged.status,
      sanitized_response: stagedSanitized,
      note: "resource: FILE, mimeType: application/pdf. URLs + signed parameters redacted.",
    },
    failed_rest_create: {
      method: "POST",
      path: `/admin/api/${API_VERSION}/shopify_payments/disputes/{DISPUTE_ID}/dispute_file_uploads.json`,
      dispute_status_at_time_of_call: status,
      request_id: restPost.requestId,
      http_status: restPost.status,
      response_body: sanitizeShop(shop, JSON.stringify(restPost.body)),
    },
    app_scopes_on_token: env.SHOPIFY_SCOPES,
  };

  console.log(JSON.stringify(report, null, 2));
})().catch(err => { console.error("FATAL:", err.message || err); process.exit(1); });
