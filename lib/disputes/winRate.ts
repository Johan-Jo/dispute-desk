/**
 * The one win-rate definition (plan §13.1, decision 2026-07-24), shared by
 * the dashboard and the Insights month record so the two can never disagree
 * on what "win rate" means.
 *
 * won ÷ (won + lost + accepted). `accepted` (the merchant conceded) counts as
 * a loss; `refunded`, `partially_won`, `expired` and `canceled` stay out of
 * both sides (resolved without a ruling on the merits).
 */
export interface WinRateCounts {
  won: number;
  lost: number;
  accepted: number;
  decided: number;
  /** Whole percent, or null when nothing was decided — never 0 by default. */
  ratePct: number | null;
}

export function winRateCounts(
  rows: ReadonlyArray<{ final_outcome?: unknown }>,
): WinRateCounts {
  let won = 0;
  let lost = 0;
  let accepted = 0;
  for (const r of rows) {
    if (r.final_outcome === "won") won += 1;
    else if (r.final_outcome === "lost") lost += 1;
    else if (r.final_outcome === "accepted") accepted += 1;
  }
  const decided = won + lost + accepted;
  return {
    won,
    lost,
    accepted,
    decided,
    ratePct: decided > 0 ? Math.round((won / decided) * 100) : null,
  };
}
