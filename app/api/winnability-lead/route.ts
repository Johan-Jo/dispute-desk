import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL =
  process.env.LEADS_FORM_TO ??
  process.env.CONTACT_FORM_TO ??
  "support@disputedesk.app";
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";

/**
 * POST /api/winnability-lead
 *
 * Lead-capture endpoint for the 5-minute Winnability Test (/test).
 * Every submission is a fully-qualified lead — it carries the merchant's
 * winnability verdict, chargeback-ratio band, dispute volume and store URL.
 * A "Winnable + red ratio" lead is a hot prospect worth calling within the hour.
 *
 * Wiring point referenced by the design's `submitLead()`: emails the lead to
 * the sales/support inbox via Resend (same infra as /api/contact). Failures
 * are swallowed so the merchant always sees their result instantly.
 */

type LeadPayload = {
  email?: string;
  store?: string;
  answers?: Record<string, string | number>;
  winnability?: string;
  ratio?: number | null;
  ts?: string;
};

const recentSubmissions = new Map<string, number>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const last = recentSubmissions.get(ip);
  if (last && now - last < 10_000) return true;
  recentSubmissions.set(ip, now);
  if (recentSubmissions.size > 1000) {
    for (const [key, ts] of recentSubmissions) {
      if (now - ts > 60_000) recentSubmissions.delete(key);
    }
  }
  return false;
}

// Human-readable labels for the captured answers (mirrors the question model
// in components/marketing/WinnabilityTest.tsx).
const ANSWER_LABELS: Record<string, Record<string, string>> = {
  reason: {
    ff: '"Don\'t recognise this charge" / unauthorised (Visa 10.4)',
    inr: '"Item not received" (13.1)',
    nad: '"Not as described" / quality (13.3)',
    fraud: "Genuine fraud — wasn't the customer",
  },
  returning: {
    yes: "Yes — prior clean order(s)",
    no: "No — first and only order",
    unsure: "Not sure",
  },
  window: {
    yes: "Yes — within 120–365 days",
    no: "No — older than ~12 months",
    unsure: "Not sure",
  },
  anchor: {
    yes: "Yes — IP / device matches a prior order",
    weak: "Only name / email / address match",
    none: "We don't capture IP or device",
  },
};

const VERDICT_LABEL: Record<string, string> = {
  win: "WINNABLE",
  borderline: "BORDERLINE",
  no: "NOT WINNABLE",
  other: "DIFFERENT LANE",
};

function ratioBand(ratio: number | null | undefined): string {
  if (ratio == null) return "unknown";
  if (ratio >= 0.9) return "RED — danger zone";
  if (ratio >= 0.65) return "AMBER — approaching the line";
  return "GREEN — safe for now";
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    // Never block the merchant's result on rate limiting.
    return NextResponse.json({ ok: true });
  }

  let body: LeadPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email." }, { status: 400 });
  }

  const store = body.store?.trim() || "—";
  const answers = body.answers ?? {};
  const verdict = VERDICT_LABEL[body.winnability ?? ""] ?? "—";
  const ratio = typeof body.ratio === "number" ? body.ratio : null;
  const band = ratioBand(ratio);
  const hot = body.winnability === "win" && ratio != null && ratio >= 0.9;

  // Best-effort delivery — log and continue on any failure so /test stays instant.
  if (!RESEND_API_KEY) {
    console.warn("[winnability-lead] RESEND_API_KEY not set — lead not emailed", {
      email,
      store,
      verdict,
      ratio,
    });
    return NextResponse.json({ ok: true });
  }

  const answerLines = ["reason", "returning", "window", "anchor"]
    .map((id) => {
      const v = answers[id];
      if (v == null) return null;
      const label = ANSWER_LABELS[id]?.[String(v)] ?? String(v);
      return `  • ${id}: ${label}`;
    })
    .filter(Boolean)
    .join("\n");

  const disputes = answers.disputes ?? "—";
  const orders = answers.orders ?? "—";

  const text = [
    hot ? "🔥 HOT LEAD — Winnable verdict + red ratio. Call within the hour.\n" : "",
    `Email:   ${email}`,
    `Store:   ${store}`,
    "",
    `Verdict: ${verdict}`,
    `Ratio:   ${ratio == null ? "—" : ratio.toFixed(2) + "%"}  (${band})`,
    `Volume:  ${disputes} disputes / ${orders} orders per month`,
    "",
    "Answers:",
    answerLines || "  (none)",
    "",
    `Taken:   ${body.ts ?? "—"}`,
  ].join("\n");

  const resend = new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: TO_EMAIL,
    replyTo: email,
    subject: `${hot ? "🔥 " : ""}[Winnability Test] ${verdict} · ${email}`,
    text,
  });

  if (error) {
    console.error("[winnability-lead] Resend error:", error);
    // Still report success — the merchant should always see their result.
  }

  return NextResponse.json({ ok: true });
}
