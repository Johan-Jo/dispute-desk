/**
 * The 3-month average line on the "Card dispute ratio by month" chart.
 *
 * A display aid over the stored monthly ratios, never a programme figure:
 * the mean of each month's ratio and the (up to) two months before it.
 * A month without a ratio has no point, and is left out of its neighbours'
 * averages rather than counted as zero.
 */

import { roundRatio } from "@/lib/insights/programmeThresholds";

export function trendAverage(ratios: Array<number | null>, size = 3): Array<number | null> {
  return ratios.map((own, i) => {
    if (own === null) return null;
    const window = ratios.slice(Math.max(0, i - size + 1), i + 1).filter((v): v is number => v !== null);
    return roundRatio(window.reduce((a, b) => a + b, 0) / window.length);
  });
}
