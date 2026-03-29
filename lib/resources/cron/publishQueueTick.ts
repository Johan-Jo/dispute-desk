import { getServiceClient } from "@/lib/supabase/server";
import { publishLocalization } from "@/lib/resources/publish";
import { sendPublishNotification } from "@/lib/email/sendPublishNotification";
import { notifySearchEngines } from "@/lib/seo/indexnow";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PublishQueueRowResult = { id: string; ok: boolean; error?: string };

export type PublishQueueTickResult =
  | { ok: false; error: string }
  | { ok: true; processed: number; results: PublishQueueRowResult[] };

export type PublishQueueTickOptions = {
  /**
   * Max rows to claim per invocation. Cron / manual “publish queue” uses a small default so
   * requests stay bounded; autopilot generation passes a higher value and may call in a loop.
   */
  claimLimit?: number;
};

type ClaimedQueueRow = { id: string; content_localization_id: string; attempts: number | null };

const STALE_PROCESSING_MINUTES = 10;
const DEFAULT_CLAIM_LIMIT = 20;
const MAX_CLAIM_LIMIT = 500;

function resolveClaimLimit(opts: PublishQueueTickOptions): number {
  const n = opts.claimLimit ?? DEFAULT_CLAIM_LIMIT;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_CLAIM_LIMIT;
  return Math.min(Math.floor(n), MAX_CLAIM_LIMIT);
}

async function recoverStaleProcessingRows(sb: SupabaseClient): Promise<void> {
  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60_000).toISOString();
  const { error: staleErr } = await sb
    .from("content_publish_queue")
    .update({ status: "pending" })
    .eq("status", "processing")
    .lt("created_at", staleCutoff);
  if (staleErr) {
    console.error("[publish-queue] Stale processing recovery failed:", staleErr.message);
  }
}

async function loadAutopilotNotifyEmail(sb: SupabaseClient): Promise<string> {
  const { data: settingsRow } = await sb
    .from("cms_settings")
    .select("settings_json")
    .eq("id", "singleton")
    .maybeSingle();
  const cmsSettings = (settingsRow?.settings_json ?? {}) as Record<string, unknown>;
  return (cmsSettings.autopilotNotifyEmail as string) || "";
}

async function runClaimedQueueRows(
  sb: SupabaseClient,
  due: ClaimedQueueRow[],
  notifyEmail: string
): Promise<PublishQueueRowResult[]> {
  const results: PublishQueueRowResult[] = [];

  for (const row of due) {
    const pub = await publishLocalization(row.content_localization_id);

    if (pub.ok) {
      const { error: succErr } = await sb
        .from("content_publish_queue")
        .update({ status: "succeeded", last_error: null })
        .eq("id", row.id);
      if (succErr) console.error("[publish-queue] Failed to mark row succeeded:", succErr.message);
      results.push({ id: row.id, ok: true });

      try {
        const { data: loc } = await sb
          .from("content_localizations")
          .select(
            "title, slug, locale, route_kind, content_item_id, content_items(primary_pillar)"
          )
          .eq("id", row.content_localization_id)
          .maybeSingle();

        if (loc) {
          const routeKind = loc.route_kind ?? "resources";
          const rawCi = loc.content_items as
            | { primary_pillar: string }
            | { primary_pillar: string }[]
            | null;
          const contentItem = Array.isArray(rawCi) ? rawCi[0] : rawCi;
          const pillar =
            typeof contentItem?.primary_pillar === "string"
              ? contentItem.primary_pillar.trim()
              : "";

          if (loc.slug) {
            notifySearchEngines(loc.slug, loc.locale, routeKind, pillar).catch((err) => {
              console.error("[publish-queue] notifySearchEngines error:", err);
            });
          }

          const emailTo = typeof notifyEmail === "string" ? notifyEmail.trim() : "";
          if (emailTo && loc.title?.trim() && loc.slug?.trim()) {
            const sent = await sendPublishNotification({
              to: emailTo,
              articleTitle: loc.title,
              articleSlug: loc.slug,
              routeKind,
              pillar,
              locale: loc.locale,
            });
            if (!sent.ok) {
              console.error("[publish-queue] Autopilot notify email failed:", sent.error);
            }
          }
        }
      } catch (err) {
        console.error("[publish-queue] Post-publish hooks error:", err);
      }
    } else {
      const { error: failErr } = await sb
        .from("content_publish_queue")
        .update({
          status: "failed",
          last_error: pub.error ?? "unknown",
          attempts: (row.attempts ?? 0) + 1,
        })
        .eq("id", row.id);
      if (failErr) console.error("[publish-queue] Failed to mark row failed:", failErr.message);
      results.push({ id: row.id, ok: false, error: pub.error });
    }
  }

  return results;
}

function mergeTickResults(a: PublishQueueTickResult, b: PublishQueueTickResult): PublishQueueTickResult {
  if (!a.ok) return a;
  if (!b.ok) return b;
  return { ok: true, processed: a.processed + b.processed, results: [...a.results, ...b.results] };
}

/**
 * Claim and publish queue rows for specific localizations (e.g. the article autopilot just created).
 * Runs before the global FIFO drain so new work is not stuck behind a large backlog.
 */
export async function publishQueuedRowsForLocalizationIds(
  localizationIds: string[]
): Promise<PublishQueueTickResult> {
  if (localizationIds.length === 0) {
    return { ok: true, processed: 0, results: [] };
  }

  const sb = getServiceClient();
  await recoverStaleProcessingRows(sb);
  const now = new Date().toISOString();

  const { data: due, error } = await sb
    .from("content_publish_queue")
    .update({ status: "processing" })
    .in("content_localization_id", localizationIds)
    .eq("status", "pending")
    .lte("scheduled_for", now)
    .select("id, content_localization_id, attempts");

  if (error) {
    return { ok: false, error: error.message };
  }

  const notifyEmail = await loadAutopilotNotifyEmail(sb);
  const results = await runClaimedQueueRows(sb, due ?? [], notifyEmail);
  return { ok: true, processed: results.length, results };
}

/**
 * Process due rows in `content_publish_queue` (same logic as `/api/cron/publish-content`).
 */
export async function executePublishQueueTick(
  opts: PublishQueueTickOptions = {}
): Promise<PublishQueueTickResult> {
  const sb = getServiceClient();
  await recoverStaleProcessingRows(sb);
  const now = new Date().toISOString();
  const claimLimit = resolveClaimLimit(opts);

  const { data: due, error } = await sb
    .from("content_publish_queue")
    .update({ status: "processing" })
    .eq("status", "pending")
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(claimLimit)
    .select("id, content_localization_id, attempts");

  if (error) {
    return { ok: false, error: error.message };
  }

  const notifyEmail = await loadAutopilotNotifyEmail(sb);
  const results = await runClaimedQueueRows(sb, due ?? [], notifyEmail);
  return { ok: true, processed: results.length, results };
}

/** Backlog drain after autopilot: bounded rounds so one request does not run unbounded sequential publishes. */
const AUTOPILOT_DRAIN_ROUND_CLAIM = 80;
const AUTOPILOT_DRAIN_MAX_ROUNDS = 10;

/**
 * Run FIFO publish-queue ticks until a round claims nothing, or max rounds.
 * Call **after** `publishQueuedRowsForLocalizationIds` so the current article is already handled.
 */
export async function drainPublishQueueAfterAutopilotEnqueue(): Promise<PublishQueueTickResult> {
  let combined: PublishQueueTickResult = { ok: true, processed: 0, results: [] };
  for (let round = 0; round < AUTOPILOT_DRAIN_MAX_ROUNDS; round++) {
    const tick = await executePublishQueueTick({ claimLimit: AUTOPILOT_DRAIN_ROUND_CLAIM });
    if (!tick.ok) return tick;
    combined = mergeTickResults(combined, tick);
    if (tick.processed === 0) break;
  }
  return combined;
}
