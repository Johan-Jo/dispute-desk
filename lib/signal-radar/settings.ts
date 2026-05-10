import { getServiceClient } from "@/lib/supabase/server";

export interface SignalRadarSettings {
  shopify_community_enabled: boolean;
  app_store_enabled: boolean;
  reddit_enabled: boolean;
  hackernews_enabled: boolean;
  reddit_cron_enabled: boolean;
  classify_cron_enabled: boolean;
}

const DEFAULTS: SignalRadarSettings = {
  shopify_community_enabled: true,
  app_store_enabled: true,
  reddit_enabled: true,
  hackernews_enabled: true,
  reddit_cron_enabled: true,
  classify_cron_enabled: true,
};

export async function getSignalRadarSettings(): Promise<SignalRadarSettings> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("signal_radar_settings")
    .select(
      "shopify_community_enabled, app_store_enabled, reddit_enabled, hackernews_enabled, reddit_cron_enabled, classify_cron_enabled"
    )
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) {
    // Row missing or query failed — fall back to all-on so the system keeps working.
    return { ...DEFAULTS };
  }
  return data as SignalRadarSettings;
}

export async function updateSignalRadarSettings(
  patch: Partial<SignalRadarSettings>
): Promise<SignalRadarSettings> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("signal_radar_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", 1)
    .select()
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to update Signal Radar settings");
  }
  return {
    shopify_community_enabled: data.shopify_community_enabled,
    app_store_enabled: data.app_store_enabled,
    reddit_enabled: data.reddit_enabled,
    hackernews_enabled: data.hackernews_enabled,
    reddit_cron_enabled: data.reddit_cron_enabled,
    classify_cron_enabled: data.classify_cron_enabled,
  };
}
