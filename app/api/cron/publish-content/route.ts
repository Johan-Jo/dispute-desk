import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { publishLocalization } from "@/lib/resources/publish";
import { sendPublishNotification } from "@/lib/email/sendPublishNotification";
import { notifySearchEngines } from "@/lib/seo/indexnow";

const CRON_SECRET = process.env.CRON_SECRET;

async function runPublish(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();
  const now = new Date().toISOString();

  const { data: due, error } = await sb
    .from("content_publish_queue")
    .select("id, content_localization_id, attempts")
    .eq("status", "pending")
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  // Load CMS settings for autopilot email
  const { data: settingsRow } = await sb
    .from("cms_settings")
    .select("settings_json")
    .eq("id", "singleton")
    .maybeSingle();
  const cmsSettings = (settingsRow?.settings_json ?? {}) as Record<string, unknown>;
  const notifyEmail = (cmsSettings.autopilotNotifyEmail as string) || "";

  for (const row of due ?? []) {
    await sb
      .from("content_publish_queue")
      .update({ status: "processing" })
      .eq("id", row.id);

    const pub = await publishLocalization(row.content_localization_id);

    if (pub.ok) {
      await sb
        .from("content_publish_queue")
        .update({ status: "succeeded", last_error: null })
        .eq("id", row.id);
      results.push({ id: row.id, ok: true });

      // Post-publish: email notification + SEO ping (single query so pillar + slug stay in sync)
      try {
        const { data: loc } = await sb
          .from("content_localizations")
          .select(
            "title, slug, locale, route_kind, content_item_id, content_items(generated_at, primary_pillar)"
          )
          .eq("id", row.content_localization_id)
          .maybeSingle();

        if (loc) {
          const routeKind = loc.route_kind ?? "resources";
          const rawCi = loc.content_items as
            | { generated_at: string | null; primary_pillar: string }
            | { generated_at: string | null; primary_pillar: string }[]
            | null;
          const contentItem = Array.isArray(rawCi) ? rawCi[0] : rawCi;
          const pillar =
            typeof contentItem?.primary_pillar === "string"
              ? contentItem.primary_pillar.trim()
              : "";

          // SEO notification (IndexNow + Google sitemap ping)
          if (loc.slug) {
            notifySearchEngines(loc.slug, loc.locale, routeKind, pillar).catch(() => {});
          }

          // Email notification for AI-generated content
          if (notifyEmail && loc.title && contentItem?.generated_at) {
            sendPublishNotification({
              to: notifyEmail,
              articleTitle: loc.title,
              articleSlug: loc.slug ?? loc.content_item_id,
              routeKind,
              pillar,
              locale: loc.locale,
            }).catch(() => {});
          }
        }
      } catch {
        // Non-blocking — publish already succeeded
      }
    } else {
      await sb
        .from("content_publish_queue")
        .update({
          status: "failed",
          last_error: pub.error ?? "unknown",
          attempts: (row.attempts ?? 0) + 1,
        })
        .eq("id", row.id);
      results.push({ id: row.id, ok: false, error: pub.error });
    }
  }

  return NextResponse.json({
    processed: results.length,
    results,
  });
}

/** POST or GET (Vercel Cron uses GET with ?secret=) */
export async function POST(req: NextRequest) {
  return runPublish(req);
}

export async function GET(req: NextRequest) {
  return runPublish(req);
}
