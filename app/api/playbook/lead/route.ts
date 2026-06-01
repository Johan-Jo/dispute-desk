import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  buildNurtureSequence,
} from "@/lib/marketing/playbook/nurtureSequence";
import { renderNurtureEmail } from "@/lib/marketing/playbook/renderNurtureEmail";
import {
  playbookReadUrl,
  calTeardownUrl,
  installUrl,
  unsubscribeUrl,
  sendPlaybookEmail,
} from "@/lib/marketing/playbook/leads";

export const runtime = "nodejs";

/**
 * POST /api/playbook/lead
 * Body: { email, source?, locale?, utm?, _honey? }
 *
 * Captures a Liability-Shift Playbook lead, then sends the welcome email
 * (nurture step 1) synchronously. The four follow-ups fire from the daily
 * /api/cron/playbook-nurture cron. Re-capturing an existing email is a no-op
 * on nurture state (we never restart or double-send the sequence).
 *
 * Returns { ok, readUrl } so the client success state can deep-link straight
 * to the Playbook reader.
 */

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

const VALID_LOCALES = new Set(["en", "de", "es", "fr", "pt", "sv"]);
const VALID_SOURCES = new Set(["hero", "final"]);

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Please wait a moment before trying again." },
      { status: 429 },
    );
  }

  let body: {
    email?: string;
    source?: string;
    locale?: string;
    utm?: Record<string, unknown>;
    _honey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Honeypot — bots fill this, humans never see it.
  if (body._honey) {
    return NextResponse.json({ ok: true, readUrl: playbookReadUrl() });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  const source = VALID_SOURCES.has(body.source ?? "") ? body.source : null;
  const locale = VALID_LOCALES.has(body.locale ?? "") ? body.locale : null;
  // Keep UTM small + JSON-safe.
  const utm: Record<string, string> = {};
  if (body.utm && typeof body.utm === "object") {
    for (const [k, v] of Object.entries(body.utm)) {
      if (typeof v === "string" && v.length <= 200) utm[k.slice(0, 60)] = v;
    }
  }

  const readUrl = playbookReadUrl();

  let isNewLead = false;
  try {
    const sb = getServiceClient();
    // Insert; on email conflict do nothing (keep earliest capture + step).
    const { data, error } = await sb
      .from("playbook_leads")
      .upsert(
        {
          email,
          source,
          locale,
          utm,
          status: "active",
          nurture_step: 1,
        },
        { onConflict: "email", ignoreDuplicates: true },
      )
      .select("id");

    if (error) {
      console.error("[playbook/lead] upsert error:", error);
    } else {
      isNewLead = (data?.length ?? 0) > 0;
    }
  } catch (err) {
    console.error("[playbook/lead] db threw:", err);
    // Still attempt the welcome send so the user gets the Playbook.
    isNewLead = true;
  }

  // Send the welcome email only for genuinely new leads (re-submits don't
  // re-trigger the sequence). Failure is non-fatal — the lead is captured.
  if (isNewLead) {
    const sequence = buildNurtureSequence({
      playbookUrl: readUrl,
      calUrl: calTeardownUrl(),
      installUrl: installUrl(),
    });
    const welcome = sequence[0];
    const rendered = renderNurtureEmail(welcome, {
      unsubscribeUrl: unsubscribeUrl(email),
    });
    await sendPlaybookEmail({
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  return NextResponse.json({ ok: true, readUrl });
}
