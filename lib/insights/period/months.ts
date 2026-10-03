/**
 * Month selection for the Insights statement — the only place that decides
 * "which month" (CI invariant I4). The page default, the Liability-shift card,
 * the digests, the cron and the trend all ask here.
 *
 * Months are ISO first-of-month strings, "YYYY-MM-01", in UTC.
 */

export type PeriodState = "final" | "provisional";

function iso(y: number, m0: number): string {
  const d = new Date(Date.UTC(y, m0, 1));
  return d.toISOString().slice(0, 10);
}

function parts(month: string): { y: number; m0: number } {
  const [y, m] = month.split("-").map(Number);
  return { y: y!, m0: m! - 1 };
}

/** The month a statement is about: always the last complete calendar month. */
export function statementMonth(now: Date): string {
  return iso(now.getUTCFullYear(), now.getUTCMonth() - 1);
}

/** Exclusive end of `month`. */
export function monthEnd(month: string): string {
  const { y, m0 } = parts(month);
  return iso(y, m0 + 1);
}

/** `month` shifted by `delta` months. */
export function addMonths(month: string, delta: number): string {
  const { y, m0 } = parts(month);
  return iso(y, m0 + delta);
}

/** When a closed month becomes final: the 8th of the following month,
 *  00:00 UTC. Late chargebacks for a month keep arriving for about a week. */
export function finalOn(month: string): string {
  const { y, m0 } = parts(month);
  return new Date(Date.UTC(y, m0 + 1, 8)).toISOString();
}

/**
 * PR1's date-only state. PR2 replaces it with the persisted `stable_at`
 * (which adds the import-complete and coverage checks); the label rule is
 * the same.
 */
export function periodStateByDate(month: string, now: Date): PeriodState {
  return now.getTime() >= new Date(finalOn(month)).getTime() ? "final" : "provisional";
}

/**
 * The months the trend, the selector and the self-heal cover: up to 12,
 * ending at the statement month, never before the shop's history starts.
 */
export function trendWindow(args: {
  now: Date;
  sinceDate: string | null;
  firstOrderAt: string | null;
}): string[] {
  const last = statementMonth(args.now);
  const floors = [addMonths(last, -11)];
  if (args.sinceDate) floors.push(args.sinceDate.slice(0, 7) + "-01");
  if (args.firstOrderAt) floors.push(args.firstOrderAt.slice(0, 7) + "-01");
  const first = floors.sort().at(-1)!;
  const out: string[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) out.push(m);
  return out;
}
