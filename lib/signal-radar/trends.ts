import type { SupabaseClient } from "@supabase/supabase-js";
import { SIGNAL_CATEGORIES } from "./schema";

export interface CategoryDelta {
  category: string;
  current_7d: number;
  prior_7d: number;
  delta_pct: number;
  direction: "up" | "down" | "flat" | "new";
}

export async function compareWeekOverWeek(
  sb: SupabaseClient
): Promise<CategoryDelta[]> {
  const now = Date.now();
  const t7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const t14 = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

  const counts = await Promise.all(
    SIGNAL_CATEGORIES.map(async (category) => {
      const [{ count: cur }, { count: prior }] = await Promise.all([
        sb
          .from("signal_analysis")
          .select("*", { count: "exact", head: true })
          .eq("category", category)
          .gt("created_at", t7),
        sb
          .from("signal_analysis")
          .select("*", { count: "exact", head: true })
          .eq("category", category)
          .gt("created_at", t14)
          .lte("created_at", t7),
      ]);
      return { category, current_7d: cur ?? 0, prior_7d: prior ?? 0 };
    })
  );

  const deltas: CategoryDelta[] = counts.map(({ category, current_7d, prior_7d }) => {
    let delta_pct: number;
    let direction: CategoryDelta["direction"];
    if (prior_7d === 0 && current_7d === 0) {
      delta_pct = 0;
      direction = "flat";
    } else if (prior_7d === 0) {
      delta_pct = 100;
      direction = "new";
    } else {
      delta_pct = Math.round(((current_7d - prior_7d) / prior_7d) * 100);
      if (delta_pct > 5) direction = "up";
      else if (delta_pct < -5) direction = "down";
      else direction = "flat";
    }
    return { category, current_7d, prior_7d, delta_pct, direction };
  });

  return deltas
    .filter((d) => d.current_7d > 0 || d.prior_7d > 0)
    .sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct))
    .slice(0, 10);
}
