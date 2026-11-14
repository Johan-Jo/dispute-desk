/**
 * Formatting for the dispute record. Dates are written in UTC, the clock
 * Shopify's records use, so the same instant reads the same on every tab and
 * for every viewer ("25 Oct 2026"). English month abbreviations are fixed here
 * rather than taken from the runtime's ICU data, which spells September
 * "Sept" in some locales; every other locale uses Intl.
 */

/**
 * ONE reading of an ISO timestamp for the dispute record.
 *
 * Carrier timestamps often carry NO zone ("2026-10-27T18:25:00": ParcelPanel's `date_carbon`, kept verbatim on
 * purpose because its zone is undocumented, see `lib/carriers/trackingApps/parcelPanelMap.ts`). `Date.parse` reads
 * such a string in the VIEWER'S local zone, so the same record sorted differently for a viewer in Sao Paulo than
 * for one in Stockholm: a Swedish delivery at 18:25 became 21:25 UTC for a Brazilian viewer and landed AFTER a
 * return created at 20:18 UTC (dispute #24697, 2026-11-14). A zone-less time is read here as UTC, so the order and
 * the day shown are identical for every viewer. It stays an approximation of the carrier's local clock (hours, so
 * two events a day apart never swap), which is why the record shows dates and not clock times for it.
 * A string with an explicit zone ("Z", "+02:00") and a date-only string parse exactly as before.
 */
const ZONE_LESS_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

export function parseRecordInstant(iso: string): number {
  const s = iso.trim();
  return Date.parse(ZONE_LESS_DATE_TIME.test(s) ? `${s.replace(" ", "T")}Z` : s);
}

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface RecordFormat {
  /** "25 Oct 2026" (UTC). */
  date: (iso: string) => string;
  /** "CAD 112.67". */
  money: (amount: number, currency: string) => string;
}

export function createRecordFormat(locale: string): RecordFormat {
  const lang = (locale || "en").toLowerCase().split("-")[0];
  const number = new Intl.NumberFormat(locale || "en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let intl: Intl.DateTimeFormat | null = null;
  try {
    intl = new Intl.DateTimeFormat(locale || "en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  } catch {
    intl = null;
  }
  return {
    date(iso) {
      const d = new Date(parseRecordInstant(iso));
      if (Number.isNaN(d.getTime())) return "";
      if (lang === "en" || !intl) return `${d.getUTCDate()} ${EN_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      return intl.format(d);
    },
    money(amount, currency) {
      return `${currency} ${number.format(amount)}`;
    },
  };
}

const DAY_MS = 86_400_000;

/** Whole UTC calendar days from `now` to `iso` (0 on the day itself, negative once past). */
export function utcDaysUntil(iso: string, now: string): number | null {
  const a = new Date(iso);
  const b = new Date(now);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((day(a) - day(b)) / DAY_MS);
}
