import { config } from "dotenv";
import { createDecipheriv } from "crypto";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";

/* eslint-disable no-console -- deliberate probe logging */

/**
 * Embedded URL:
 * …/store/surasvenne/apps/disputedesk-1/app/disputes/75d2ee2b-6fd3-4a33-b11b-218ff5812602
 *
 * `/app/disputes/:id` is our disputes row UUID (NOT Shopify REST numeric id).
 * When `.env.local` has Supabase + token encryption keys, we resolve numeric id + offline token.
 */
const DISPUTEDESK_DISPUTE_ROW_ID =
  process.env.DISPUTEDESK_PROBE_DISPUTE_ID ??
  "75d2ee2b-6fd3-4a33-b11b-218ff5812602";

const FALLBACK_shopDomain = "surasvenne.myshopify.com";
const FALLBACK_accessToken = "shpat_REPLACE_ME";
/** Only used if Supabase lookup fails */
const FALLBACK_disputeNumericId = "REPLACE_NUMERIC_AFTER_DB_LOOKUP";

config({ path: join(process.cwd(), ".env.local") });

function deserializeTokenPayload(raw: string) {
  const [ver, iv, tag, ct] = raw.split(":");
  return {
    keyVersion: Number.parseInt(ver.slice(1), 10),
    iv: Buffer.from(iv, "hex"),
    tag: Buffer.from(tag, "hex"),
    ciphertext: Buffer.from(ct, "hex"),
  };
}

function decryptShopifyOfflineToken(payload: ReturnType<typeof deserializeTokenPayload>) {
  const envName = `TOKEN_ENCRYPTION_KEY_V${payload.keyVersion}`;
  let hex = process.env[envName];
  if (!hex && payload.keyVersion === 1) hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error(`Missing ${envName} / TOKEN_ENCRYPTION_KEY for decryption`);
  const key = Buffer.from(hex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, payload.iv);
  decipher.setAuthTag(payload.tag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString("utf8");
}

function gidTailNumeric(gid: string): string | null {
  const m = gid.match(/\/(\d+)$/);
  return m?.[1] ?? null;
}

async function resolveFromSupabase(disputeRowId: string): Promise<{
  shopDomain: string;
  accessToken: string;
  disputeNumericId: string;
  disputeGid: string;
} | null> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: row, error: dErr } = await sb
    .from("disputes")
    .select("shop_id, dispute_gid")
    .eq("id", disputeRowId)
    .maybeSingle();

  if (dErr || !row?.shop_id || !row.dispute_gid) {
    if (dErr) console.error("→ Supabase disputes lookup:", dErr.message);
    return null;
  }

  const numeric = gidTailNumeric(row.dispute_gid);
  if (!numeric) {
    console.error("→ Could not parse numeric id from dispute_gid:", row.dispute_gid);
    return null;
  }

  const { data: shop, error: sErr } = await sb
    .from("shops")
    .select("shop_domain")
    .eq("id", row.shop_id)
    .maybeSingle();
  if (sErr || !shop?.shop_domain) {
    if (sErr) console.error("→ Supabase shops lookup:", sErr.message);
    return null;
  }

  const { data: sessionRow } = await sb
    .from("shop_sessions")
    .select("access_token_encrypted")
    .eq("shop_id", row.shop_id)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sessionRow?.access_token_encrypted) {
    console.error("→ No offline shop_session for this dispute's shop.");
    return null;
  }

  try {
    const accessToken = decryptShopifyOfflineToken(
      deserializeTokenPayload(sessionRow.access_token_encrypted),
    );
    return {
      shopDomain: shop.shop_domain,
      accessToken,
      disputeNumericId: numeric,
      disputeGid: row.dispute_gid,
    };
  } catch (e) {
    console.error("→ Token decrypt failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

const API_VERSION = "2025-01";
const UPLOAD_FILENAME = "disputedesk-probe.pdf";

const MINIMAL_PDF = Buffer.from(
  "%PDF-1.4\n" +
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<<>>/Contents 4 0 R>>endobj\n" +
    "4 0 obj<</Length 44>>stream\n" +
    "BT /F1 12 Tf 50 750 Td (DisputeDesk test file upload probe) Tj ET\n" +
    "endstream endobj\n" +
    "xref\n" +
    "0 5\n" +
    "0000000000 65535 f \n" +
    "0000000009 00000 n \n" +
    "0000000052 00000 n \n" +
    "0000000101 00000 n \n" +
    "0000000189 00000 n \n" +
    "trailer<</Size 5/Root 1 0 R>>\nstartxref\n270\n%%EOF\n",
  "utf8",
);

function headersToRecord(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function logHeaders(label: string, headers: Headers | Record<string, string>) {
  const entries: Record<string, string> =
    headers instanceof Headers ? headersToRecord(headers) : headers;
  console.log(`→ ${label} (all headers):`);
  console.log(JSON.stringify(entries, null, 2));
}

function formatBodySnippet(text: string, max = 8000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… (${text.length} chars total)`;
}

interface UploadAttemptResult {
  kind: "multipart" | "json";
  status: number;
  bodyText: string;
  requestId: string | null;
  responseHeaders: Record<string, string>;
}

async function uploadMultipart(
  uploadUrl: string,
  token: string,
  pdf: Buffer,
  filename: string,
): Promise<UploadAttemptResult> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(pdf)], { type: "application/pdf" });
  form.append("file", blob, filename);
  form.append("filename", filename);

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
    },
    body: form,
  });
  const bodyText = await res.text();
  return {
    kind: "multipart",
    status: res.status,
    bodyText,
    requestId: res.headers.get("x-request-id"),
    responseHeaders: headersToRecord(res.headers),
  };
}

async function uploadJsonBase64(
  uploadUrl: string,
  token: string,
  pdf: Buffer,
  filename: string,
): Promise<UploadAttemptResult> {
  const payload = {
    dispute_file_upload: {
      document_type: "UNCATEGORIZED_FILE",
      filename,
      mimetype: "application/pdf",
      data: pdf.toString("base64"),
    },
  };

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify(payload),
  });
  const bodyText = await res.text();
  return {
    kind: "json",
    status: res.status,
    bodyText,
    requestId: res.headers.get("x-request-id"),
    responseHeaders: headersToRecord(res.headers),
  };
}

function parseUploadJson(raw: string): {
  dispute_file_upload?: { id?: unknown };
  errors?: unknown;
} | null {
  try {
    return JSON.parse(raw) as {
      dispute_file_upload?: { id?: unknown };
      errors?: unknown;
    };
  } catch {
    return null;
  }
}

function extractUploadId(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const d = parsed as { dispute_file_upload?: { id?: unknown } };
  const id = d.dispute_file_upload?.id;
  if (typeof id === "number" || typeof id === "string") return String(id);
  return undefined;
}

async function gqlRequest(
  graphqlUrl: string,
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{
  status: number;
  requestId: string | null;
  bodyText: string;
  parsed: unknown;
  responseHeaders: Record<string, string>;
}> {
  const res = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const bodyText = await res.text();
  let parsed: unknown = bodyText;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    /* keep text */
  }
  return {
    status: res.status,
    requestId: res.headers.get("x-request-id"),
    bodyText,
    parsed,
    responseHeaders: headersToRecord(res.headers),
  };
}

async function main(): Promise<void> {
  console.log("\n=== DISPUTE FILE UPLOAD TEST ===");
  console.log("DisputeDesk row id (embedded URL slug):", DISPUTEDESK_DISPUTE_ROW_ID);

  let shopDomain = FALLBACK_shopDomain;
  let accessToken = FALLBACK_accessToken;
  let disputeNumericId = FALLBACK_disputeNumericId;
  let shopifyDisputeGidFromDb: string | null = null;

  const resolved = await resolveFromSupabase(DISPUTEDESK_DISPUTE_ROW_ID);
  if (resolved) {
    shopDomain = resolved.shopDomain;
    accessToken = resolved.accessToken;
    disputeNumericId = resolved.disputeNumericId;
    shopifyDisputeGidFromDb = resolved.disputeGid;
    console.log("→ Resolved via Supabase — shop:", shopDomain);
    console.log("→ Shopify dispute GID:", resolved.disputeGid);
    console.log("→ Numeric id for REST path:", disputeNumericId);
  } else {
    console.log(
      "→ Supabase resolve unavailable or lookup failed — using FALLBACK_* tokens (won't work unless you replace them manually).",
    );
  }

  if (
    accessToken === FALLBACK_accessToken ||
    !/^\d+$/.test(disputeNumericId)
  ) {
    console.log(
      "\nABORTED: Need a valid offline token + numeric dispute id (digits only). Populate .env.local for Supabase resolve, or set real FALLBACK_shopDomain / FALLBACK_accessToken / FALLBACK_disputeNumericId.",
    );
    return;
  }

  console.log("(Runtime target shop):", shopDomain);
  console.log("(Runtime Shopify dispute numeric):", disputeNumericId);

  const disputeId = disputeNumericId;
  const uploadUrl = `https://${shopDomain}/admin/api/${API_VERSION}/shopify_payments/disputes/${disputeId}/dispute_file_uploads.json`;

  let uploadOutcome: UploadAttemptResult | null = null;
  let multipartOutcome: UploadAttemptResult | null = null;

  try {
    console.log("\n→ Step 1a: multipart/form-data POST (probe requirement)…");

    multipartOutcome = await uploadMultipart(uploadUrl, accessToken, MINIMAL_PDF, UPLOAD_FILENAME);

    console.log("→ Upload (multipart) response status:", multipartOutcome.status);
    console.log("→ Upload (multipart) response body:", formatBodySnippet(multipartOutcome.bodyText));
    logHeaders("Upload (multipart) response headers", multipartOutcome.responseHeaders);
    console.log("→ X-Request-ID (multipart):", multipartOutcome.requestId ?? "(none)");
    console.log("(multipart — Content-Type omitted so fetch adds multipart boundary)");

    uploadOutcome =
      multipartOutcome.status === 200 || multipartOutcome.status === 201 ? multipartOutcome : null;

    if (!uploadOutcome) {
      console.log("\n→ Step 1b: JSON + base64 POST (matches Shopify REST docs + existing probes)…");
      const jsonTry = await uploadJsonBase64(uploadUrl, accessToken, MINIMAL_PDF, UPLOAD_FILENAME);
      console.log("→ Upload (json) response status:", jsonTry.status);
      console.log("→ Upload (json) response body:", formatBodySnippet(jsonTry.bodyText));
      logHeaders("Upload (json) response headers", jsonTry.responseHeaders);
      console.log("→ X-Request-ID (json):", jsonTry.requestId ?? "(none)");
      if (jsonTry.status === 200 || jsonTry.status === 201) {
        uploadOutcome = jsonTry;
      }
    }

    if (!uploadOutcome) {
      console.log("\nUPLOAD FAILED");
      console.log("\n→ GraphQL test: FAILED");
      console.log("→ GraphQL errors: (skipped — REST upload did not return 200/201)");
      return;
    }

    const parsedBody = parseUploadJson(uploadOutcome.bodyText);
    const uploadId = extractUploadId(parsedBody);
    if (!uploadId) {
      console.log("\nUPLOAD FAILED (no dispute_file_upload.id in JSON body)");
      console.log("→ Raw body:", formatBodySnippet(uploadOutcome.bodyText));
      console.log("\n→ GraphQL test: FAILED");
      console.log("→ GraphQL errors: (skipped — no file upload id)");
      return;
    }

    console.log(`\nUPLOAD SUCCESS — ID: ${uploadId}`);
    const fileGid = `gid://shopify/ShopifyPaymentsDisputeFileUpload/${uploadId}`;
    console.log("→ GID:", fileGid);

    const graphqlUrl = `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`;
    const disputeGid =
      shopifyDisputeGidFromDb ??
      `gid://shopify/ShopifyPaymentsDispute/${disputeId}`;

    const evidenceQuery = `
      query DisputeEvidenceForProbe($id: ID!) {
        dispute(id: $id) {
          id
          disputeEvidence { id }
        }
      }
    `;

    console.log("\n→ GraphQL: resolve disputeEvidence id for mutation…");
    const ev = await gqlRequest(graphqlUrl, accessToken, evidenceQuery, { id: disputeGid });
    console.log("→ evidence query status:", ev.status);
    console.log("→ evidence query X-Request-ID:", ev.requestId ?? "(none)");
    logHeaders("evidence query response headers", ev.responseHeaders);
    console.log("→ evidence query body:", formatBodySnippet(ev.bodyText, 4000));

    const evParsed = ev.parsed as {
      errors?: unknown;
      data?: { dispute?: { disputeEvidence?: { id?: string } | null } | null };
    };
    const evidenceGid = evParsed?.data?.dispute?.disputeEvidence?.id;
    const gqlErrors = evParsed?.errors;

    if (!evidenceGid) {
      console.log("\n→ GraphQL test: FAILED (could not read disputeEvidence.id)");
      console.log("→ GraphQL errors:", JSON.stringify(gqlErrors ?? null, null, 2));
      return;
    }
    if (Array.isArray(gqlErrors) && gqlErrors.length > 0) {
      console.log("→ evidence query top-level GraphQL errors (non-fatal if id present):", JSON.stringify(gqlErrors, null, 2));
    }

    const mutation = `
      mutation ProbeDisputeEvidenceUpdate($id: ID!, $input: ShopifyPaymentsDisputeEvidenceUpdateInput!) {
        disputeEvidenceUpdate(id: $id, input: $input) {
          disputeEvidence { id }
          userErrors { field message }
        }
      }
    `;

    const variables = {
      id: evidenceGid,
      input: {
        uncategorizedFile: { id: fileGid },
      },
    };

    const mut = await gqlRequest(graphqlUrl, accessToken, mutation, variables);
    console.log("\n→ GraphQL mutation status:", mut.status);
    console.log("→ GraphQL mutation X-Request-ID:", mut.requestId ?? "(none)");
    logHeaders("GraphQL mutation response headers", mut.responseHeaders);
    console.log("→ GraphQL mutation body:", formatBodySnippet(mut.bodyText, 4000));

    const mutParsed = mut.parsed as {
      errors?: { message?: string }[];
      data?: {
        disputeEvidenceUpdate?: {
          disputeEvidence?: { id?: string } | null;
          userErrors?: { field?: string[]; message?: string }[];
        };
      };
    };

    const topErrors = mutParsed?.errors ?? [];
    const userErrors =
      mutParsed?.data?.disputeEvidenceUpdate?.userErrors ?? [];
    const ok =
      mut.status === 200 &&
      topErrors.length === 0 &&
      userErrors.length === 0;

    console.log("\n→ GraphQL test:", ok ? "SUCCESS" : "FAILED");
    console.log(
      "→ GraphQL errors:",
      JSON.stringify(
        topErrors.length ? topErrors : userErrors.length ? userErrors : [],
        null,
        2,
      ),
    );

    console.log("\n--- Summary ---");
    console.log("REST upload used:", uploadOutcome.kind);
    console.log(
      uploadOutcome.kind === "json" && multipartOutcome
        ? `Multipart preview status was ${multipartOutcome.status} before JSON fallback.`
        : "Multipart succeeded or JSON was first success path.",
    );
  } catch (err) {
    console.log("\nUPLOAD FAILED — caught exception:");
    console.log(
      JSON.stringify(
        {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        },
        null,
        2,
      ),
    );
    console.log("\n→ GraphQL test: FAILED");
    console.log("→ GraphQL errors: (skipped — exception above)");
  }
}

void main();
