import { NextRequest, NextResponse } from "next/server";
import { cronEnvGate } from "@/lib/cron/envGate";
import { getServiceClient } from "@/lib/supabase/server";
import { regenerateArticleInPlace } from "@/lib/resources/generation/expandInPlace";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Backlog drain: rebuilds thin (below-tier-floor) Resources Hub localizations
 * in place, a few per run, until none remain flagged. A row opts in by carrying
 * `migration_action = 'expand'` (set by the thin-content audit / noindex step).
 *
 * Each run takes ONE content_item and regenerates up to BATCH of its flagged
 * locales (in parallel inside regenerateArticleInPlace, with maxRetries=1), so a
 * single invocation stays well under the 300s function limit. Scheduled every
 * 2 minutes; it no-ops cheaply once the flag set is empty. cronEnvGate handles
 * CRON_ENABLED + CRON_SECRET. See docs/technical.md § Thin-content gate.
 */
const BATCH = 3;

async function run(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("content_localizations")
    .select("content_item_id, locale")
    .eq("migration_action", "expand")
    .eq("is_published", true)
    .order("content_item_id", { ascending: true })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data?.length) {
    return NextResponse.json({ done: true, remaining: 0, processed: 0 });
  }

  // One item per run; up to BATCH of its flagged locales.
  const itemId = data[0].content_item_id as string;
  const locales = data
    .filter((r) => r.content_item_id === itemId)
    .slice(0, BATCH)
    .map((r) => r.locale as string);

  const result = await regenerateArticleInPlace(itemId, { publish: true, locales });

  return NextResponse.json({
    done: false,
    remainingFlagged: data.length >= 50 ? "50+" : data.length,
    contentItemId: itemId,
    locales,
    perLocale: result.perLocale,
    error: result.error,
  });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
