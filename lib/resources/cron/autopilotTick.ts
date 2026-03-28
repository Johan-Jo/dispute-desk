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

async function pickNextArchiveItem(): Promise<string | null> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("content_archive_items")
    .select("id")
    .in("status", ["backlog", "brief_ready"])
    .is("created_from_archive_to_content_item_id", null)
    .order("priority_score", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
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
export async function executeAutopilotTick(): Promise<AutopilotTickResult> {
  if (!isGenerationEnabled()) {
    return { skipped: true, reason: "Generation not enabled" };
  }

  const settings = await getCmsSettingsJson();

  if (!settings.autopilotEnabled) {
    return { skipped: true, reason: "Autopilot is disabled" };
  }

  const startedAt = settings.autopilotStartedAt as string | null;
  const articlesPerDay = (settings.autopilotArticlesPerDay as number) ?? 1;

  let articlesToGenerate = articlesPerDay;

  if (startedAt) {
    const published = await countAutopilotPublishedSince(startedAt);
    if (published < INITIAL_BURST_COUNT) {
      articlesToGenerate = 1;
    }
  }

  const generated: AutopilotArticleResult[] = [];

  for (let i = 0; i < articlesToGenerate; i++) {
    const archiveItemId = await pickNextArchiveItem();
    if (!archiveItemId) {
      break;
    }

    const result = await runGenerationPipeline(archiveItemId, { autopilot: true });
    generated.push({
      archiveItemId,
      contentItemId: result.contentItemId,
      error: result.error,
    });

    if (result.error) break;
  }

  return {
    autopilot: true,
    articlesGenerated: generated.length,
    results: generated,
  };
}
