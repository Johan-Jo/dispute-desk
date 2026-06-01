import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { cronEnvGate } from "@/lib/cron/envGate";
import {
  buildNurtureSequence,
  NURTURE_SEQUENCE_LENGTH,
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
// Bounded by the active-lead pool; each lead is one Resend send + one update.
export const maxDuration = 300;

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 200;

/**
 * GET /api/cron/playbook-nurture
 *
 * Daily driver for the CE 3.0 Email Course (the Playbook nurture sequence).
 * For each active lead whose NEXT step is due (its `sendAfterDays` ≤ days since
 * capture), sends that one email and advances `nurture_step` by one. The step
 * gate makes it idempotent: a second run the same day sends nothing because the
 * step already advanced. At most one email per lead per run, so a back-dated
 * lead never gets blasted with the whole sequence at once.
 *
 * Welcome (step 1) is sent at capture time by /api/playbook/lead, so this cron
 * only ever sends steps 2..5.
 *
 * Schedule: daily at 13:00 UTC (see vercel.json) — mid-morning US, early
 * afternoon EU, a reasonable open-rate window.
 */
export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const sb = getServiceClient();
  const now = Date.now();

  const sequence = buildNurtureSequence({
    playbookUrl: playbookReadUrl(),
    calUrl: calTeardownUrl(),
    installUrl: installUrl(),
  });

  // Active leads that have not finished the sequence, oldest first.
  const { data: leads, error } = await sb
    .from("playbook_leads")
    .select("id, email, created_at, nurture_step")
    .eq("status", "active")
    .lt("nurture_step", NURTURE_SEQUENCE_LENGTH)
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!leads?.length) {
    return NextResponse.json({ sent: 0, skipped: 0, total: 0 });
  }

  let sent = 0;
  let skipped = 0;
  const failures: Array<{ email: string; reason: string }> = [];

  for (const lead of leads) {
    const nextStep = lead.nurture_step + 1; // 2..5
    const email = sequence.find((e) => e.step === nextStep);
    if (!email) {
      skipped++;
      continue;
    }

    const ageDays = (now - new Date(lead.created_at).getTime()) / DAY_MS;
    if (ageDays < email.sendAfterDays) {
      // Not due yet.
      skipped++;
      continue;
    }

    const rendered = renderNurtureEmail(email, {
      unsubscribeUrl: unsubscribeUrl(lead.email),
    });
    const ok = await sendPlaybookEmail({
      to: lead.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (!ok) {
      // Leave nurture_step unchanged so the next run retries this step.
      failures.push({ email: lead.email, reason: "send failed" });
      continue;
    }

    const { error: updErr } = await sb
      .from("playbook_leads")
      .update({ nurture_step: nextStep, updated_at: new Date().toISOString() })
      .eq("id", lead.id)
      .eq("nurture_step", lead.nurture_step); // optimistic guard vs concurrent run

    if (updErr) {
      failures.push({ email: lead.email, reason: updErr.message });
      continue;
    }
    sent++;
  }

  return NextResponse.json({
    sent,
    skipped,
    failed: failures.length,
    total: leads.length,
    ...(failures.length ? { failures: failures.slice(0, 20) } : {}),
  });
}
