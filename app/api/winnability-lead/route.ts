import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getServiceClient } from "@/lib/supabase/server";
import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";
import { unsubscribeUrl } from "@/lib/marketing/playbook/leads";
import { buildWinnabilityResultEmail } from "@/lib/marketing/winnability/resultEmail";
import {
  scoreWinnability,
  scoreRatio,
  VERDICT_BAND,
  type WinnabilityAnswers,
} from "@/lib/marketing/winnability/scoring";
import { sendAdminWinnabilityLeadNotification } from "@/lib/email/sendAdminNotification";

export const runtime = "nodejs";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";

/**
 * POST /api/winnability-lead
 *
 * Lead-capture endpoint for the 5-Minute Winnability Test (/test, DP-TEST-01).
 * On every completion this does three things (none block the merchant's result):
 *
 *   1. Persist the lead to `winnability_leads` (verdict, ratio, answers) →
 *      surfaced at /admin/winnability-leads. Re-takes update to the latest.
 *   2. Email the MERCHANT their result (the DP-RESULT-EMAIL design). This is the
 *      ONLY email a test-taker gets — they are NOT enrolled in the playbook
 *      CE 3.0 nurture (that chain stays exclusive to the /playbook funnel).
 *   3. Notify the team (→ ADMIN_NOTIFY_EMAIL / oi@johan.com.br) via the same
 *      admin-alert mechanism the playbook (LinkedIn) capture uses.
 *
 * Always returns 2xx so the merchant sees their verdict instantly, but the body
 * carries `{ ok, emailed, reason }` so a probe can tell whether the merchant
 * result email actually sent (a 2xx does not prove delivery).
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
// in components/marketing/WinnabilityTest.tsx) — used in the admin notification.
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

function answerLines(answers: WinnabilityAnswers): string[] {
  return ["reason", "returning", "window", "anchor"]
    .map((id) => {
      const v = answers[id];
      if (v == null) return null;
      const label = ANSWER_LABELS[id]?.[String(v)] ?? String(v);
      return `${id}: ${label}`;
    })
    .filter((x): x is string => x !== null);
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

  const rawEmail = body.email?.trim();
  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return NextResponse.json({ error: "Invalid email." }, { status: 400 });
  }
  const email = rawEmail.toLowerCase();
  const store = body.store?.trim() || null;
  const answers: WinnabilityAnswers = body.answers ?? {};

  // Compute verdict + ratio server-side from the answers (single source of
  // truth — never trust the client's `winnability`/`ratio` fields).
  const w = scoreWinnability(answers);
  const ratio = scoreRatio(answers);
  const verdictLabel = VERDICT_BAND[w.state].label;
  const disputes =
    answers.disputes != null && answers.disputes !== "" ? Number(answers.disputes) : null;
  const orders =
    answers.orders != null && answers.orders !== "" ? Number(answers.orders) : null;

  // 1) Persist (best-effort — never blocks the result).
  try {
    const sb = getServiceClient();
    const { error } = await sb.from("winnability_leads").upsert(
      {
        email,
        store,
        verdict: w.state,
        lane: w.lane,
        ratio_pct: ratio.pct,
        ratio_band: ratio.band,
        disputes_per_month: Number.isFinite(disputes) ? disputes : null,
        orders_per_month: Number.isFinite(orders) ? orders : null,
        answers,
        status: "active",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "email" },
    );
    if (error) console.error("[winnability-lead] upsert error:", error);
  } catch (err) {
    console.error("[winnability-lead] db threw:", err);
  }

  // 3) Admin notification to the team (fire-and-forget; never throws).
  void sendAdminWinnabilityLeadNotification({
    email,
    store,
    verdictLabel,
    ratioPct: ratio.pct,
    ratioBand: ratio.band,
    disputesPerMonth: disputes,
    ordersPerMonth: orders,
    answerLines: answerLines(answers),
  }).catch((err) => console.error("[winnability-lead] admin notify threw:", err));

  // 2) Merchant result email (the one the test promises). Best-effort: report
  //    the outcome in the response but never fail the request.
  if (!RESEND_API_KEY) {
    console.warn("[winnability-lead] RESEND_API_KEY not set — result email skipped");
    return NextResponse.json({ ok: true, emailed: false, reason: "RESEND_API_KEY not set" });
  }

  const baseUrl = getPublicSiteBaseUrl();
  const { subject, html, text } = buildWinnabilityResultEmail({
    answers,
    baseUrl,
    unsubscribeUrl: unsubscribeUrl(email),
  });

  try {
    const resend = new Resend(RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject,
      html,
      text,
    });
    if (error) {
      console.error("[winnability-lead] Resend error:", JSON.stringify(error));
      return NextResponse.json({
        ok: true,
        emailed: false,
        reason: error.message ?? error.name ?? "send failed",
      });
    }
  } catch (err) {
    console.error("[winnability-lead] send threw:", err);
    return NextResponse.json({ ok: true, emailed: false, reason: "send threw" });
  }

  return NextResponse.json({ ok: true, emailed: true, to: email });
}
