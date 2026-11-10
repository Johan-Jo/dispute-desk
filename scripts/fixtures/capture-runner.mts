/**
 * One capture: runs the REAL workspace route for one dispute through the
 * read-only database path and writes the scrubbed fixture.
 * Launched by capture-workspace-fixture.mjs (never run it by hand against a
 * database you have not confirmed with scripts/guard-db-target.mjs).
 *
 *   node --import tsx scripts/fixtures/capture-runner.mts <disputeId> <caseName> <outFile> [note]
 */
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import { installReadOnlyFetch, queryJ, SHIM_ORIGIN } from "./lib/readOnlyDb";
import { findLeaks, scrubFixture } from "./lib/scrub";

const [disputeId, caseName, outFile, note] = process.argv.slice(2);
if (!disputeId || !caseName || !outFile) {
  console.error("usage: capture-runner.mts <disputeId> <caseName> <outFile> [note]");
  process.exit(1);
}
if (!/^[0-9a-f-]{36}$/i.test(disputeId)) throw new Error("disputeId must be a full UUID");

process.env.SUPABASE_URL = SHIM_ORIGIN;
process.env.SUPABASE_SERVICE_ROLE_KEY = "capture-shim-not-a-key";
process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "capture-shim-secret";
// Prod serves the canonical pipeline (CLAUDE memory: LIVE since ~08-15); the route reads this per call.
process.env.CANONICAL_PIPELINE = "on";

installReadOnlyFetch();

// `server-only` is a Next bundler concept, not an installable package; resolve it to the vitest stub.
const M = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const resolveOrig = M._resolveFilename;
M._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]) {
  const target = request === "server-only" ? path.resolve("tests/mocks/server-only.ts") : request;
  return resolveOrig.call(this, target, ...rest);
};

const { NextRequest } = await import("next/server");
const { GET } = await import("../../app/api/disputes/[id]/workspace/route");
const { getServiceClient } = await import("../../lib/supabase/server");
const { loadEnrichSourceRows } = await import("../../lib/disputes/workspacePayload/sourceRows");
const { ENRICHED_PATHS } = await import("../../lib/disputes/workspacePayload/enrich");

const head = (await queryJ(
  `select coalesce(json_agg(t), '[]'::json) as j from (select d.shop_id, s.shop_domain, s.primary_domain from disputes d join shops s on s.id = d.shop_id where d.id = '${disputeId}') t;`,
)) as Array<{ shop_id: string; shop_domain: string; primary_domain: string | null }>;
if (head.length !== 1) throw new Error(`dispute ${disputeId} not found`);
const { shop_id: shopId, shop_domain: shopDomain, primary_domain: primaryDomain } = head[0];

const res = await GET(
  new NextRequest(`http://localhost/api/disputes/${disputeId}/workspace?shop_id=${shopId}`),
  { params: Promise.resolve({ id: disputeId }) },
);
if (res.status !== 200) throw new Error(`route answered ${res.status}: ${await res.text()}`);
const payload = (await res.json()) as Record<string, unknown>;

// The route returns the ENRICHED payload; fixtures freeze the pre-enrichment one so the
// tests run the shared enrichment themselves (plan 3.1). `ENRICHED_PATHS` lists what it adds.
for (const p of ENRICHED_PATHS) {
  const segs = p.split(".");
  let cur: unknown = payload;
  for (const s of segs.slice(0, -1)) cur = (cur as Record<string, unknown> | undefined)?.[s];
  if (cur && typeof cur === "object") delete (cur as Record<string, unknown>)[segs[segs.length - 1]];
}

const sourceRows = await loadEnrichSourceRows(getServiceClient(), disputeId);
const domains = [shopDomain, primaryDomain].filter((d): d is string => !!d);
const { json, literals } = scrubFixture(
  {
    shop_id: shopId,
    shopDomain,
    payload,
    sourceRows,
  },
  domains,
  domains.map((d) => d.replace(/\.myshopify\.com$/i, "").replace(/^www\./i, "").replace(/\.[a-z.]+$/i, "")),
);
const text = JSON.stringify(json, null, 1);
const leaks = findLeaks(text, literals);
if (leaks.length > 0) {
  console.error(`LEAKS in ${caseName}:\n  ${leaks.slice(0, 30).join("\n  ")}`);
  process.exit(2);
}
const out = json as { payload: unknown; sourceRows: unknown };
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(
  outFile,
  JSON.stringify(
    {
      meta: { case: caseName, disputeId, note: note ?? null, capturedAt: new Date().toISOString(), source: "prod, read-only" },
      payload: out.payload,
      sourceRows: out.sourceRows,
    },
    null,
    1,
  ) + "\n",
);
console.log(`captured ${caseName} (${disputeId}) -> ${outFile} (${text.length} bytes)`);
process.exit(0);
