import { getServiceClient } from "@/lib/supabase/server";
import { publishLocalization } from "@/lib/resources/publish";
import { sendPublishNotification } from "@/lib/email/sendPublishNotification";
import { notifySearchEngines } from "@/lib/seo/indexnow";

export type PublishQueueRowResult = { id: string; ok: boolean; error?: string };

export type PublishQueueTickResult =
  | { ok: false; error: string }
  | { ok: true; processed: number; results: PublishQueueRowResult[] };

const STALE_PROCESSING_MINUTES = 10;

/**
 * Process due rows in `content_publish_queue` (same logic as `/api/cron/publish-content`).
 */
export async function executePublishQueueTick(): Promise<PublishQueueTickResult> {
  const sb = getServiceClient();
  const now = new Date().toISOString();

  // M3: Recover rows stuck in "processing" for too long (crashed worker).
  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60_000).toISOString();
  const { error: staleErr } = await sb
    .from("content_publish_queue")
    .update({ status: "pending" })
    .eq("status", "processing")
    .lt("created_at", staleCutoff);
  if (staleErr) {
    console.error("[publish-queue] Stale processing recovery failed:", staleErr.message);
  }

  // M2: Atomic claim — update pending→processing and return claimed rows in one step.
  const { data: due, error } = await sb
    .from("content_publish_queue")
    .update({ status: "processing" })
    .eq("status", "pending")
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(20)
    .select("id, content_localization_id, attempts");

  if (error) {
    return { ok: false, error: error.message };
  }

  const results: PublishQueueRowResult[] = [];

  const { data: settingsRow } = await sb
    .from("cms_settings")
    .select("settings_json")
    .eq("id", "singleton")
    .maybeSingle();
  const cmsSettings = (settingsRow?.settings_json ?? {}) as Record<string, unknown>;
  const notifyEmail = (cmsSettings.autopilotNotifyEmail as string) || "";

  for (const row of due ?? []) {
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

  return { ok: true, processed: results.length, results };
}
