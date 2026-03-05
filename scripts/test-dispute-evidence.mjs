#!/usr/bin/env node
/**
 * Test Shopify dispute evidence: append (draft) and submit end-to-end.
 *
 * Verifies:
 *   (1) Append: Update evidence text → appears in Shopify "Chargeback response (Draft)"
 *       and remains unsent (evidenceSentOn null, submitted false).
 *   (2) Submit: Call mutation with submitEvidence: true → dispute moves to submitted
 *       (evidenceSentOn set and/or submitted true).
 *
 * Usage:
 *   Set env: SHOPIFY_SHOP_DOMAIN, SHOPIFY_ADMIN_TOKEN
 *   Optional: SHOPIFY_API_VERSION (default 2026-01)
 *
 *   node scripts/test-dispute-evidence.mjs
 *   node scripts/test-dispute-evidence.mjs --dispute-gid "gid://shopify/ShopifyPaymentsDispute/123"
 *
 * Scopes required: read_shopify_payments_disputes, read_shopify_payments_dispute_evidences,
 *                  write_shopify_payments_dispute_evidences
 */

import { readFileSync } from "fs";
import { join } from "path";
import { getAdminToken } from "./shopify/admin-token.mjs";

function loadEnv() {
  try {
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
  } catch {
    return {};
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const gidIdx = args.indexOf("--dispute-gid");
  const disputeGid = gidIdx !== -1 ? args[gidIdx + 1] : null;
  const shopIdx = args.indexOf("--shop");
  const shop = shopIdx !== -1 ? args[shopIdx + 1] : null;
  return { disputeGid, shopOverride: shop };
}

async function resolveShopAndToken(env, shopOverride) {
  const shopDomain = shopOverride || env.SHOPIFY_SHOP_DOMAIN || env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN;
  if (!shopDomain) {
    console.error("Missing env. Set SHOPIFY_SHOP_DOMAIN or SHOPIFY_STORE_DOMAIN (or pass --shop domain).");
    process.exit(1);
  }
  const shop = shopDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const token = await getAdminToken({ shop, env });
  return { shop, token };
}

async function shopifyGraphQL(shop, token, query, variables = {}, apiVersion = "2026-01") {
  const url = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  const userErrors = body?.data?.disputeEvidenceUpdate?.userErrors;
  return {
    status: res.status,
    data: body?.data,
    errors: body?.errors || [],
    userErrors: userErrors || [],
  };
}

const DISPUTE_DETAIL_QUERY = `
  query DisputeDetail($id: ID!) {
    dispute(id: $id) {
      id
      status
      reasonDetails { reason }
      amount { amount currencyCode }
      initiatedAt
      evidenceDueBy
      evidenceSentOn
      finalizedOn
      order { id name }
      disputeEvidence {
        id
        submitted
        uncategorizedText
      }
    }
  }
`;

const DISPUTE_LIST_QUERY = `
  query DisputeList($first: Int!) {
    disputes(first: $first) {
      edges {
        node {
          id
          status
          evidenceDueBy
          evidenceSentOn
          reasonDetails { reason }
          order { id name }
          disputeEvidence { id submitted uncategorizedText }
        }
      }
    }
  }
`;

const EVIDENCE_RESOLVE_QUERY = `
  query DisputeEvidenceResolve($id: ID!) {
    disputeEvidence(id: $id) {
      id
      dispute { id }
    }
  }
`;

const EVIDENCE_UPDATE_MUTATION = `
  mutation DisputeEvidenceUpdate($id: ID!, $input: ShopifyPaymentsDisputeEvidenceUpdateInput!) {
    disputeEvidenceUpdate(id: $id, input: $input) {
      disputeEvidence {
        id
        submitted
        uncategorizedText
        dispute {
          id
          evidenceSentOn
          status
        }
      }
      userErrors { field message }
    }
  }
`;

function printDisputeSummary(dispute, label = "Dispute") {
  if (!dispute) {
    console.log(`${label}: (none)\n`);
    return;
  }
  const ev = dispute.disputeEvidence;
  console.log(`${label}:`);
  console.log(`  id:              ${dispute.id}`);
  console.log(`  status:          ${dispute.status}`);
  console.log(`  evidenceDueBy:   ${dispute.evidenceDueBy ?? "—"}`);
  console.log(`  evidenceSentOn:  ${dispute.evidenceSentOn ?? "null (draft)"}`);
  console.log(`  order:          ${dispute.order?.name ?? dispute.order?.id ?? "—"}`);
  console.log(`  reason:          ${dispute.reasonDetails?.reason ?? "—"}`);
  if (ev) {
    console.log(`  evidence id:     ${ev.id}`);
    console.log(`  submitted:      ${ev.submitted}`);
    console.log(`  uncategorizedText: ${ev.uncategorizedText ? `"${ev.uncategorizedText.slice(0, 80)}${ev.uncategorizedText.length > 80 ? "…" : ""}"` : "(empty)"}`);
  } else {
    console.log(`  evidence:       (no evidence record)`);
  }
  console.log("");
}

function logUserErrors(userErrors, prefix = "userErrors") {
  if (userErrors?.length) {
    console.log(`  ${prefix}:`);
    userErrors.forEach((e) => console.log(`    ${(e.field || []).join(".")}: ${e.message}`));
  }
}

async function findDispute(shop, token, disputeGid, apiVersion) {
  if (disputeGid) {
    let id = disputeGid;
    if (/^\d+$/.test(disputeGid)) {
      id = `gid://shopify/ShopifyPaymentsDispute/${disputeGid}`;
    }
    let out = await shopifyGraphQL(shop, token, DISPUTE_DETAIL_QUERY, { id }, apiVersion);
    if (out.status === 401 || out.status === 403) {
      console.error("HTTP " + out.status + ". Token or scopes likely missing (read_shopify_payments_disputes, read_shopify_payments_dispute_evidences).");
      process.exit(1);
    }
    if (out.errors?.length) {
      out.errors.forEach((e) => console.error("GraphQL error:", e.message));
      process.exit(1);
    }
    let dispute = out.data?.dispute;
    if (!dispute) {
      const evidenceGid = disputeGid.startsWith("gid://") ? disputeGid : `gid://shopify/ShopifyPaymentsDisputeEvidence/${disputeGid}`;
      const evOut = await shopifyGraphQL(shop, token, EVIDENCE_RESOLVE_QUERY, { id: evidenceGid }, apiVersion);
      const evidence = evOut.data?.disputeEvidence;
      if (evidence?.dispute?.id) {
        out = await shopifyGraphQL(shop, token, DISPUTE_DETAIL_QUERY, { id: evidence.dispute.id }, apiVersion);
        dispute = out.data?.dispute;
      }
    }
    if (!dispute) {
      console.error("Dispute not found for id:", disputeGid, "(tried as dispute GID and as evidence GID).");
      process.exit(1);
    }
    return dispute;
  }

  const out = await shopifyGraphQL(shop, token, DISPUTE_LIST_QUERY, { first: 5 }, apiVersion);
  if (out.status === 401 || out.status === 403) {
    console.error("HTTP " + out.status + ". Token or scopes likely missing.");
    process.exit(1);
  }
  if (out.errors?.length) {
    out.errors.forEach((e) => console.error("GraphQL error:", e.message));
    process.exit(1);
  }
  const edges = out.data?.disputes?.edges ?? [];
  const allowedStatuses = ["NEEDS_RESPONSE", "needs_response"];
  const pick = edges
    .map((e) => e.node)
    .find(
      (n) =>
        n.disputeEvidence?.id &&
        (allowedStatuses.includes(n.status) || !n.evidenceSentOn)
    );
  if (!pick) {
    console.error("No dispute found that allows evidence (need disputeEvidence.id and status allowing draft). List had:", edges.length);
    if (edges.length) {
      edges.forEach((e) => console.log("  -", e.node.id, e.node.status, e.node.disputeEvidence?.id ?? "no evidence"));
    }
    process.exit(1);
  }
  const detail = await shopifyGraphQL(shop, token, DISPUTE_DETAIL_QUERY, { id: pick.id }, apiVersion);
  return detail.data?.dispute ?? pick;
}

async function main() {
  const env = { ...process.env, ...loadEnv() };
  const apiVersion = env.SHOPIFY_API_VERSION || "2026-01";
  const { disputeGid, shopOverride } = parseArgs();
  const { shop, token } = await resolveShopAndToken(env, shopOverride);

  console.log("\n=== Shopify dispute evidence test (append + submit) ===\n");
  console.log("Shop:", shop);
  console.log("API version:", apiVersion);
  console.log("Dispute:", disputeGid || "(first eligible from list)");
  if (shopOverride) console.log("Shop override: --shop", shopOverride);
  console.log("");

  const dispute = await findDispute(shop, token, disputeGid, apiVersion);
  const evidenceGid = dispute.disputeEvidence?.id;
  if (!evidenceGid) {
    console.error("This dispute has no evidence record; cannot run evidence tests.");
    process.exit(1);
  }

  printDisputeSummary(dispute, "Before state");

  const marker = "DISPUTEDESK_APPEND_TEST_" + Date.now();
  const existingText = dispute.disputeEvidence?.uncategorizedText || "";
  const newText = existingText ? existingText + "\n" + marker : marker;

  // --- Test Case 1: Append evidence (draft only) ---
  console.log("--- Test Case 1: Append evidence (pending auto-submit) ---");
  console.log("Mutation input: uncategorizedText = (existing + marker), submitEvidence not set (default false)");
  console.log("Marker:", marker);

  const update1 = await shopifyGraphQL(shop, token, EVIDENCE_UPDATE_MUTATION, {
    id: evidenceGid,
    input: { uncategorizedText: newText },
  }, apiVersion);

  if (update1.status === 401 || update1.status === 403) {
    console.log("FAIL: HTTP " + update1.status + ". Token/scopes likely missing (write_shopify_payments_dispute_evidences, manage_orders_information).");
  } else if (update1.userErrors?.length) {
    console.log("FAIL: mutation returned userErrors:");
    logUserErrors(update1.userErrors);
  } else if (update1.errors?.length) {
    console.log("FAIL: GraphQL errors:", update1.errors.map((e) => e.message).join("; "));
  } else {
    const after1 = await shopifyGraphQL(shop, token, DISPUTE_DETAIL_QUERY, { id: dispute.id }, apiVersion);
    const d1 = after1.data?.dispute;
    const ev1 = d1?.disputeEvidence;
    const hasMarker = ev1?.uncategorizedText?.includes(marker);
    const stillDraft = d1?.evidenceSentOn == null;
    const notSubmitted = ev1?.submitted === false;

    if (hasMarker && stillDraft && notSubmitted) {
      console.log("PASS: Evidence text contains marker; evidenceSentOn still null; submitted still false (draft).");
    } else {
      console.log("FAIL:");
      console.log("  - Text contains marker:", hasMarker);
      console.log("  - evidenceSentOn still null:", stillDraft, "(value:", d1?.evidenceSentOn ?? "null", ")");
      console.log("  - submitted still false:", notSubmitted, "(value:", ev1?.submitted, ")");
    }
  }
  console.log("");

  // --- Test Case 2: Programmatic submit ---
  console.log("--- Test Case 2: Programmatic submit (submitEvidence: true) ---");
  const evidenceSentOnBefore = dispute.evidenceSentOn;
  const submittedBefore = dispute.disputeEvidence?.submitted;

  const update2 = await shopifyGraphQL(shop, token, EVIDENCE_UPDATE_MUTATION, {
    id: evidenceGid,
    input: { submitEvidence: true },
  }, apiVersion);

  if (update2.status === 401 || update2.status === 403) {
    console.log("FAIL: HTTP " + update2.status + ". Token/scopes likely missing.");
  } else if (update2.userErrors?.length) {
    console.log("Mutation userErrors (submit may not be allowed via API):");
    logUserErrors(update2.userErrors);
    console.log("Note: Shopify may require manual submission in Admin. Check Shopify docs for programmatic submit.");
  } else if (update2.errors?.length) {
    console.log("FAIL: GraphQL errors:", update2.errors.map((e) => e.message).join("; "));
  } else {
    const payload = update2.data?.disputeEvidenceUpdate?.disputeEvidence;
    const disputeNode = payload?.dispute;
    const evidenceSentOnAfter = disputeNode?.evidenceSentOn;
    const submittedAfter = payload?.submitted;

    const sentOnSet = evidenceSentOnAfter != null;
    const submittedTrue = submittedAfter === true;
    const statusChanged = disputeNode?.status && disputeNode.status !== dispute.status;

    if (sentOnSet || submittedTrue || statusChanged) {
      console.log("PASS: Submission detected.");
      if (sentOnSet) console.log("  - evidenceSentOn:", evidenceSentOnAfter);
      if (submittedTrue) console.log("  - submitted: true");
      if (statusChanged) console.log("  - status:", dispute.status, "->", disputeNode?.status);
    } else {
      const after2 = await shopifyGraphQL(shop, token, DISPUTE_DETAIL_QUERY, { id: dispute.id }, apiVersion);
      const d2 = after2.data?.dispute;
      console.log("FAIL: No sign of submission after mutation.");
      console.log("  evidenceSentOn before:", evidenceSentOnBefore, "-> after:", d2?.evidenceSentOn ?? evidenceSentOnAfter);
      console.log("  submitted before:", submittedBefore, "-> after:", d2?.disputeEvidence?.submitted ?? submittedAfter);
      console.log("  status:", d2?.status);
      console.log("Note: Shopify may require manual 'Submit now' in Admin; programmatic submit might not be supported for this store/role.");
    }
  }
  console.log("");

  console.log("Dispute id used:", dispute.id);
  console.log("Evidence id used:", evidenceGid);
  console.log("Mutation inputs — Test 1: { uncategorizedText: \"...\" + marker }; Test 2: { submitEvidence: true }");
  console.log("\n=== Done ===\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
