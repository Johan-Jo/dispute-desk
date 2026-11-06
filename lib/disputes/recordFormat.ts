/**
 * Formatting for the dispute record. Dates are written in UTC, the clock
 * Shopify's records use, so the same instant reads the same on every tab and
 * for every viewer ("25 Oct 2026"). English month abbreviations are fixed here
 * rather than taken from the runtime's ICU data, which spells September
 * "Sept" in some locales; every other locale uses Intl.
 */

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
      const d = new Date(iso);
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
