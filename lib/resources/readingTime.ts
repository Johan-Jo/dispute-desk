import "server-only";

import { getServiceClient } from "@/lib/supabase/server";

const WORDS_PER_MINUTE = 225;

export function estimateReadingTimeMinutes(mainHtml: string | undefined): number | null {
  if (!mainHtml || !mainHtml.trim()) return null;

  const plain = mainHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

  if (!plain) return null;
  const words = plain.split(" ").filter(Boolean).length;
  if (words === 0) return null;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

export async function backfillMissingReadingTimes(limit = 300): Promise<{
  scanned: number;
  updated: number;
  skipped: number;
  failures: { localizationId: string; error: string }[];
}> {
  const sb = getServiceClient();
  const { data: rows, error } = await sb
    .from("content_localizations")
    .select("id, body_json, reading_time_minutes")
    .is("reading_time_minutes", null)
    .limit(limit);

  if (error) throw error;

  let updated = 0;
  let skipped = 0;
  const failures: { localizationId: string; error: string }[] = [];

  for (const row of rows ?? []) {
    const body = (row.body_json ?? {}) as Record<string, unknown>;
    const mainHtml = typeof body.mainHtml === "string" ? body.mainHtml : "";
    const minutes = estimateReadingTimeMinutes(mainHtml);
    if (minutes == null) {
      skipped += 1;
      continue;
    }

    const { error: updErr } = await sb
      .from("content_localizations")
      .update({ reading_time_minutes: minutes })
      .eq("id", row.id);

    if (updErr) failures.push({ localizationId: row.id as string, error: updErr.message });
    else updated += 1;
  }

  return {
    scanned: rows?.length ?? 0,
    updated,
    skipped,
    failures,
  };
}
