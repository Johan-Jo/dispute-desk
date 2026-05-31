import { NextResponse } from "next/server";
import { KNOWN_PROD_SUPABASE_PROJECT_REF } from "@/lib/env/build-identity";

export const runtime = "nodejs";

/**
 * Module-load timestamp. Captured at cold start so subsequent /api/health
 * calls report the same value until the lambda is recycled. Closest proxy
 * we have for "build/deploy time" without a build-time injection step.
 */
const PROCESS_STARTED_AT = new Date().toISOString();

function extractSupabaseRefFp(url: string | undefined): string {
  if (!url) return "";
  const m = url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1].slice(0, 8) : "";
}

/**
 * GET /api/health
 *
 * Environment identity probe. Returns non-secret fingerprints of the
 * runtime config so an operator can confirm which environment a given
 * deployment is wired to. Used by:
 *
 *  - the post-deploy checklist in docs/runbooks/prod-release.md
 *  - the dev/prod split verification in
 *    docs/plans/dev-prod-environment-split.plan.md §6.3
 *
 * Every emitted value is either a public identifier (URL, public
 * client_id, project ref) or its first-8-char fingerprint. No secret
 * values, hashes of secrets, or derivatives thereof are returned.
 */
export async function GET() {
  const appEnv = process.env.APP_ENV ?? "unknown";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const supabaseProjectRefFp = extractSupabaseRefFp(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
  );
  const shopifyClientIdFp = (
    process.env.SHOPIFY_API_KEY ??
    process.env.SHOPIFY_CLIENT_ID ??
    ""
  ).slice(0, 8);
  const cronEnabled = process.env.CRON_ENABLED === "true";
  const gitSha = (
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    ""
  ).slice(0, 7);
  const apiVersion = process.env.SHOPIFY_API_VERSION ?? "2026-01";
  const vercelEnv = process.env.VERCEL_ENV ?? "";
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID ?? "";

  // Identity check: is the runtime supabase pointed at the known prod
  // project? Surface a boolean here so the post-deploy script can assert
  // it without re-doing the regex match.
  const supabaseIsKnownProd =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(KNOWN_PROD_SUPABASE_PROJECT_REF) ??
    process.env.SUPABASE_URL?.includes(KNOWN_PROD_SUPABASE_PROJECT_REF) ??
    false;

  return NextResponse.json({
    status: "ok",
    appEnv,
    appUrl,
    supabaseProjectRefFp,
    supabaseIsKnownProd,
    shopifyClientIdFp,
    cronEnabled,
    gitSha,
    apiVersion,
    vercelEnv,
    deploymentId,
    processStartedAt: PROCESS_STARTED_AT,
  });
}
