/**
 * Shared scoring + verdict presentation for the 5-Minute Winnability Test
 * (/test, DP-TEST-01).
 *
 * Single source of truth so the on-screen result, the merchant result email,
 * and the admin notification can never diverge. The design explicitly requires
 * the email's verdict, reasons and CTAs to match the on-screen test exactly.
 *
 * English-only GTM copy — this is a marketing funnel module (same convention as
 * lib/marketing/playbook/*), intentionally outside the i18n token system.
 */

// Real destinations (relative paths; the email builder absolutizes them).
// The install CTA routes to the on-site free-trial popup at /#pricing, NOT the
// App Store — see lib/marketing/shopifyInstallUrl.ts.
export const WINNABILITY_URLS = {
  freeTrial: "/#pricing",
  demo: "/demo",
  contact: "/en/contact",
  playbook: "/en/playbook",
  video: "https://www.youtube.com/watch?v=k7TY52tFr5I",
} as const;

export type WinnabilityAnswers = Record<string, string | number>;
export type WinState = "win" | "borderline" | "no" | "other";
export type WinLane = "ff" | "fraud" | "other";
export type RatioBand = "green" | "amber" | "red" | "unknown";
/** ["ok"|"no", text] — a ✓ or ✕ reason row. */
export type Reason = ["ok" | "no", string];

export interface WinResult {
  state: WinState;
  headline: string;
  reasons: Reason[];
  lane: WinLane;
}

export interface RatioResult {
  pct: number | null;
  band: RatioBand;
}

export interface Cta {
  h: string;
  p: string;
  primary: { label: string; href: string };
  secondary?: { label: string; href: string };
}

/** The verdict pill: background, text color, label. */
export const VERDICT_BAND: Record<WinState, { bg: string; color: string; label: string }> = {
  win: { bg: "rgba(31,122,77,0.16)", color: "#1f7a4d", label: "Winnable" },
  borderline: { bg: "rgba(176,109,18,0.18)", color: "#b06d12", label: "Borderline" },
  no: { bg: "rgba(138,42,31,0.18)", color: "#8a2a1f", label: "Not winnable" },
  other: { bg: "rgba(37,99,235,0.14)", color: "#1d4ed8", label: "Different lane" },
};

export const RATIO_BAND_COLOR: Record<RatioBand, string> = {
  green: "#1f7a4d",
  amber: "#b06d12",
  red: "#8a2a1f",
  unknown: "#64748b",
};

export const RATIO_BAND_TEXT: Record<RatioBand, string> = {
  green: "Safe — for now",
  amber: "Approaching the line",
  red: "In the danger zone",
  unknown: "Add numbers to see",
};

export const RATIO_BAND_DESC: Record<RatioBand, string> = {
  green: "Comfortably under the ~0.9% threshold. Keep winning the winnable ones.",
  amber: "This is where most merchants sit — and don’t realise it. Worth acting before it climbs.",
  red: "At or over the line. You may already be on a monitoring program. Act now.",
  unknown: "We couldn’t compute a ratio from your numbers.",
};

export function scoreWinnability(a: WinnabilityAnswers): WinResult {
  // Non-friendly-fraud reasons route out of the CE 3.0 lane.
  if (a.reason === "fraud")
    return {
      state: "no",
      headline: "Don’t fight this one.",
      reasons: [
        ["no", "This is genuine fraud — the customer didn’t make the purchase"],
        ["no", "Contesting true fraud hurts your win rate and your standing"],
      ],
      lane: "fraud",
    };
  if (a.reason === "inr" || a.reason === "nad")
    return {
      state: "other",
      headline: "Different rulebook.",
      reasons: [
        ["no", "This isn’t a friendly-fraud / “don’t recognise” dispute"],
        ["ok", "It can still be winnable — but on delivery / description evidence, not CE 3.0"],
      ],
      lane: "other",
    };

  // Friendly-fraud lane.
  const kills: Reason[] = [];
  const wins: Reason[] = [];
  let unsure = false;

  if (a.returning === "yes") wins.push(["ok", "Returning customer with prior clean orders"]);
  else if (a.returning === "no") kills.push(["no", "No prior order — CE 3.0 needs a transaction history"]);
  else unsure = true;

  if (a.window === "yes") wins.push(["ok", "A prior order falls inside the 120–365 day window"]);
  else if (a.window === "no") kills.push(["no", "Prior order is outside the eligible look-back window"]);
  else unsure = true;

  if (a.anchor === "yes") wins.push(["ok", "You have the IP / device anchor — the decisive match"]);
  else if (a.anchor === "weak") kills.push(["no", "Only name/email/address match — not enough for CE 3.0"]);
  else if (a.anchor === "none") kills.push(["no", "No IP / device captured — the anchor is missing"]);

  if (kills.length === 0 && !unsure) {
    return { state: "win", headline: "This one’s winnable.", reasons: wins, lane: "ff" };
  }
  if (kills.length === 0 && unsure) {
    return {
      state: "borderline",
      headline: "Closer than you think.",
      reasons: wins.concat([
        ["no", "A couple of unknowns to confirm — that gap is what loses winnable disputes"],
      ]),
      lane: "ff",
    };
  }
  return { state: "no", headline: "Not this one — here’s why.", reasons: kills.concat(wins), lane: "ff" };
}

export function scoreRatio(a: WinnabilityAnswers): RatioResult {
  const d = Number(a.disputes) || 0;
  const o = Number(a.orders) || 0;
  if (o <= 0) return { pct: null, band: "unknown" };
  const pct = (d / o) * 100;
  let band: RatioBand = "green";
  if (pct >= 0.9) band = "red";
  else if (pct >= 0.65) band = "amber";
  return { pct, band };
}

/**
 * The ratio meter marker position, as a percentage of track width.
 * Scale tops out at 1.5% (the on-screen gauge's max); capped at 100%.
 */
export function ratioMarkerPct(pct: number | null): number {
  if (pct == null) return 0;
  return Math.min((pct / 1.5) * 100, 100);
}

/**
 * Per-verdict CTA — each points at a real page that delivers on the promise.
 * Identical mapping to the on-screen test and the email (design DP-RESULT-EMAIL).
 */
export function ctaFor(w: WinResult, urls = WINNABILITY_URLS): Cta {
  if (w.state === "win")
    return {
      h: "Let’s win it.",
      p: "You’ve got the anchor. DisputeDesk builds the evidence pack and files it for you — start free, no card.",
      primary: { label: "Start free — fight this dispute →", href: urls.freeTrial },
      secondary: { label: "Or have us review it with you", href: urls.contact },
    };
  if (w.state === "borderline")
    return {
      h: "Let’s confirm it.",
      p: "A couple of unknowns to nail down. Send us the details — chat, email, or a quick call — and we’ll tell you definitively.",
      primary: { label: "Get it checked →", href: urls.contact },
      secondary: { label: "Or see how DisputeDesk works", href: urls.demo },
    };
  if (w.state === "other")
    return {
      h: "Still worth a look.",
      p: "Item-not-received and quality disputes win on different evidence — and DisputeDesk builds those packs too. See it, or send us this one.",
      primary: { label: "Watch the 2-min demo →", href: urls.demo },
      secondary: { label: "Or send us this dispute", href: urls.contact },
    };
  if (w.lane === "fraud")
    return {
      h: "This one’s not yours to fight.",
      p: "Genuine fraud should be refunded — contesting it hurts your standing. But strong checkout data helps you spot and stop the next one.",
      primary: { label: "See how DisputeDesk helps →", href: urls.demo },
      secondary: { label: "Talk it through with us", href: urls.contact },
    };
  return {
    h: "Make the next one winnable.",
    p: "The fix is upstream: DisputeDesk captures IP + device on every order automatically, so your next dispute has the anchor this one was missing.",
    primary: { label: "Start free — start capturing →", href: urls.freeTrial },
    secondary: { label: "Or read the 2-minute setup", href: urls.playbook },
  };
}
