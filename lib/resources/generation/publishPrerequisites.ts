/**
 * Ensures author, primary CTA, and ≥3 tags exist so `publishLocalization` can succeed
 * for AI-generated hub content (including autopilot).
 */

import { getServiceClient } from "@/lib/supabase/server";

const DEFAULT_AUTHOR = {
  name: "DisputeDesk Editorial",
  role: "Editorial",
} as const;

/** Stable tag keys used when the DB has fewer than three tags yet. */
export const DEFAULT_HUB_TAG_KEYS = ["chargebacks", "shopify", "merchant-resources"] as const;

export function defaultHubMarketingUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return u && u.length > 0 ? u : "https://disputedesk.app";
}

async function getOrCreateAuthorId(): Promise<string> {
  const sb = getServiceClient();
  const { data: existing } = await sb
    .from("authors")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: inserted, error } = await sb.from("authors").insert(DEFAULT_AUTHOR).select("id").single();
  if (error || !inserted?.id) {
    throw new Error(`Failed to create default author: ${error?.message ?? "unknown"}`);
  }
  return inserted.id;
}

/**
 * Reads Admin → Settings "Default CTA" (`defaultCta`), e.g. `free_trial`.
 * Generation uses a `content_ctas` row with matching `event_name`.
 */
export function parseDefaultCtaPreference(settingsJson: unknown): string | null {
  if (!settingsJson || typeof settingsJson !== "object") return null;
  const v = (settingsJson as Record<string, unknown>).defaultCta;
  if (typeof v !== "string" || v === "" || v === "none") return null;
  return v;
}

async function loadPreferredCtaEventName(): Promise<string | null> {
  const sb = getServiceClient();
  const { data } = await sb.from("cms_settings").select("settings_json").eq("id", "singleton").maybeSingle();
  return parseDefaultCtaPreference(data?.settings_json ?? null);
}

async function getOrCreatePrimaryCtaId(preferredEventName: string | null): Promise<string> {
  const sb = getServiceClient();
  if (preferredEventName) {
    const { data: match } = await sb
      .from("content_ctas")
      .select("id")
      .eq("event_name", preferredEventName)
      .limit(1)
      .maybeSingle();
    if (match?.id) return match.id;
  }

  const { data: existing } = await sb
    .from("content_ctas")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const destination = defaultHubMarketingUrl();
  const { data: inserted, error } = await sb
    .from("content_ctas")
    .insert({
      type: "external",
      destination,
      event_name: "hub_default_cta",
      localized_copy_json: {},
    })
    .select("id")
    .single();
  if (error || !inserted?.id) {
    throw new Error(`Failed to create default CTA: ${error?.message ?? "unknown"}`);
  }
  return inserted.id;
}

async function getOrCreateTagIdForKey(key: string): Promise<string> {
  const sb = getServiceClient();
  const { data: existing } = await sb.from("content_tags").select("id").eq("key", key).maybeSingle();
  if (existing?.id) return existing.id;

  const { data: inserted, error } = await sb.from("content_tags").insert({ key }).select("id").single();
  if (!error && inserted?.id) return inserted.id;

  const { data: again } = await sb.from("content_tags").select("id").eq("key", key).maybeSingle();
  if (again?.id) return again.id;

  throw new Error(`Failed to ensure content tag "${key}": ${error?.message ?? "unknown"}`);
}

async function ensureThreeTagIds(): Promise<[string, string, string]> {
  const ids = await Promise.all(DEFAULT_HUB_TAG_KEYS.map((k) => getOrCreateTagIdForKey(k)));
  return [ids[0], ids[1], ids[2]];
}

export interface PublishPrerequisites {
  authorId: string;
  primaryCtaId: string;
  tagIds: [string, string, string];
}

/**
 * Loads or creates the rows required by `publishLocalization` (author, primary CTA, three tags).
 * Primary CTA prefers {@link parseDefaultCtaPreference} when a matching `content_ctas.event_name` exists.
 */
export async function ensurePublishPrerequisites(): Promise<PublishPrerequisites> {
  const preferredCta = await loadPreferredCtaEventName();
  const [authorId, primaryCtaId, tagIds] = await Promise.all([
    getOrCreateAuthorId(),
    getOrCreatePrimaryCtaId(preferredCta),
    ensureThreeTagIds(),
  ]);
  return { authorId, primaryCtaId, tagIds };
}
