import { NextRequest, NextResponse } from "next/server";
import { cronEnvGate } from "@/lib/cron/envGate";
import { regenerateArticleInPlace, generateComparisonForLocale } from "@/lib/resources/generation/expandInPlace";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Rebuilds ONE existing content_item in place to its tier floor across all
 * locales (see lib/resources/generation/expandInPlace.ts). Targeted, not a
 * scheduled sweep — the client (scripts/expand-thin-article.mjs) drives it one
 * item at a time so each rebuild stays inside the 300s function budget.
 *
 *   GET/POST /api/cron/expand-thin?contentItemId=<uuid>&publish=true
 *
 * cronEnvGate handles CRON_ENABLED + CRON_SECRET auth.
 */
async function run(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const url = new URL(req.url);
  const contentItemId = url.searchParams.get("contentItemId");
  const publish = url.searchParams.get("publish") === "true";
  // Optional locale filter (single or comma-separated). The client paces one
  // locale per call to stay under the OpenAI TPM cap.
  const localeParam = url.searchParams.get("locale");
  const locales = localeParam ? localeParam.split(",").map((l) => l.trim()).filter(Boolean) : undefined;
  // Optional generation-provider override for A/B (openai | claude). Defaults to env.
  const providerParam = url.searchParams.get("provider");
  const provider = providerParam === "claude" || providerParam === "openai" ? providerParam : null;

  if (!contentItemId) {
    return NextResponse.json({ error: "Missing contentItemId" }, { status: 400 });
  }

  // Comparison mode: same brief/prompt through both providers, no DB write.
  if (url.searchParams.get("compare") === "true") {
    const cmp = await generateComparisonForLocale(contentItemId, localeParam || "en-US");
    return NextResponse.json(cmp, { status: cmp.error && cmp.drafts.length === 0 ? 500 : 200 });
  }

  const result = await regenerateArticleInPlace(contentItemId, { publish, locales, provider });
  const status = result.error && result.perLocale.length === 0 ? 500 : 200;
  return NextResponse.json(result, { status });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
