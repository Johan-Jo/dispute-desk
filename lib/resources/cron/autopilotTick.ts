import { getServiceClient } from "@/lib/supabase/server";
import { runGenerationPipeline } from "@/lib/resources/generation/pipeline";
import { isGenerationEnabled } from "@/lib/resources/generation/generate";

const INITIAL_BURST_COUNT = 5;

async function getCmsSettingsJson(): Promise<Record<string, unknown>> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("cms_settings")
    .select("settings_json")
    .eq("id", "singleton")
    .maybeSingle();
  return (data?.settings_json ?? {}) as Record<string, unknown>;
}

async function countAutopilotPublishedSince(since: string): Promise<number> {
  const sb = getServiceClient();
  const { count } = await sb
    .from("content_items")
    .select("id", { count: "exact", head: true })
    .not("generated_at", "is", null)
    .eq("workflow_status", "published")
    .gte("generated_at", since);
  return count ?? 0;
}

const PICK_BATCH = 50;

/** Only backlog / brief_ready — `idea` stays editorial-only until promoted. */
async function pickNextArchiveItem(excludeIds: ReadonlySet<string>): Promise<string | null> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("content_archive_items")
    .select("id")
    .in("status", ["backlog", "brief_ready"])
    .is("created_from_archive_to_content_item_id", null)
    .order("priority_score", { ascending: false })
    .limit(PICK_BATCH);
  const row = data?.find((r) => r.id && !excludeIds.has(r.id));
  return row?.id ?? null;
}

export type AutopilotArticleResult = {
  archiveItemId: string;
  contentItemId: string | null;
  error: string | null;
};

export type AutopilotTickResult =
  | { skipped: true; reason: string }
  | { autopilot: true; articlesGenerated: number; results: AutopilotArticleResult[] };

/**
 * One autopilot cron tick: generate from backlog per settings (same rules as
 * `/api/cron/autopilot-generate`).
 */
export interface AutopilotTickOptions {
  /**
   * When true (admin manual trigger), bypass the daily rate limit and generate
   * up to `overrideCount` articles in a single tick. Defaults to false (cron behavior).
   */
  bypassRateLimit?: boolean;
  /** Max articles to generate when bypassing rate limit. Default: 20. */
  overrideCount?: number;
}

export async function executeAutopilotTick(opts: AutopilotTickOptions = {}): Promise<AutopilotTickResult> {
  if (!isGenerationEnabled()) {
    return { skipped: true, reason: "Generation not enabled" };
  }

  const settings = await getCmsSettingsJson();

  if (!settings.autopilotEnabled) {
    return { skipped: true, reason: "Autopilot is disabled" };
  }

  const startedAt = settings.autopilotStartedAt as string | null;
  const articlesPerDay = (settings.autopilotArticlesPerDay as number) ?? 1;

  let articlesToGenerate: number;

  if (opts.bypassRateLimit) {
    articlesToGenerate = opts.overrideCount ?? 20;
  } else {
    articlesToGenerate = articlesPerDay;
    if (startedAt) {
      const published = await countAutopilotPublishedSince(startedAt);
      if (published < INITIAL_BURST_COUNT) {
        articlesToGenerate = 1;
      }
    }
  }

  const generated: AutopilotArticleResult[] = [];
  const triedThisTick = new Set<string>();
  /** If the top-priority row fails (e.g. pillar), try the next row instead of blocking all lower-priority items forever. */
  const maxAttempts = Math.min(PICK_BATCH, Math.max(articlesToGenerate * 8, articlesToGenerate + 15));
  let attempts = 0;

  while (attempts < maxAttempts) {
    const successes = generated.filter((r) => !r.error).length;
    if (successes >= articlesToGenerate) break;

    const archiveItemId = await pickNextArchiveItem(triedThisTick);
    if (!archiveItemId) break;

    triedThisTick.add(archiveItemId);
    attempts += 1;

    const result = await runGenerationPipeline(archiveItemId, { autopilot: true });
    generated.push({
      archiveItemId,
      contentItemId: result.contentItemId,
      error: result.error,
    });
  }

  const articlesGenerated = generated.filter((r) => !r.error).length;

  return {
    autopilot: true,
    articlesGenerated,
    results: generated,
  };
}
