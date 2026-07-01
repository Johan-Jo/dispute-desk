/**
 * Billing-lifecycle merchant emails (Phase 4a of billing PRD).
 *
 * Each function below corresponds to one row in the §5.5 communications
 * matrix and follows the same pattern:
 *
 *   1. Claim the idempotency slot via a conditional UPDATE on
 *      plan_entitlements (or, for top-ups, a SELECT against
 *      pack_credits_ledger). When two callers race, the database
 *      lets exactly one win; the other reads back the non-NULL
 *      stamp and short-circuits.
 *   2. Resolve the team email from shop_setup.steps.team.payload.
 *      The merchant can disable lifecycle emails via the same
 *      `notifications` block — `notifications.billing` controls
 *      every function in this file.
 *   3. Send via Resend with a calm, deadline-aware copy.
 *   4. Log a single audit_events row recording delivery.
 *
 * Fire-and-forget: every function returns void and swallows its own
 * errors. Callers (the reconciler, the topup-callback) MUST use
 * `void` + `.catch` so a transient email failure does not block a
 * state transition.
 *
 * Phase 4a intentionally OMITS the "trial ending in 3 days" notice
 * — that requires a dedicated daily cron checking
 * `trial_ends_at` BETWEEN now()+2d AND now()+3d. It will land in 4c
 * once Phase 4b's banners ship. The matrix's two pure-banner events
 * (low credits, generic dispute event copy) also belong to 4b.
 */

import { Resend } from "resend";
import { getServiceClient } from "@/lib/supabase/server";
import { getPlan, type PlanId } from "@/lib/billing/plans";
import { claimBillingBlockedEmailSlot } from "@/lib/automation/billingBlockedEmailThrottle";
import { DISPUTE_ATTENTION_REASONS } from "@/lib/disputes/attentionReasons";
import { getEmbeddedAppUrl } from "./publicSiteUrl";
import { brandHeader, ctaButton, plateLayout } from "./digestShared";

// Env reads happen at call time, not module load — capturing at module
// scope makes the module's behavior depend on import order in tests
// (the test file's beforeEach sets RESEND_API_KEY, but if it's read at
// module load that value is "" undefined). The runtime cost is negligible.
function resendApiKey(): string | undefined {
  return process.env.RESEND_API_KEY;
}
function fromEmail(): string {
  return (
    process.env.EMAIL_FROM ??
    "DisputeDesk <notifications@mail.disputedesk.app>"
  );
}
function replyTo(): string {
  return (
    process.env.EMAIL_REPLY_TO ??
    "DisputeDesk <notifications@mail.disputedesk.app>"
  );
}

type SbClient = ReturnType<typeof getServiceClient>;

/** Shared outcome shape so the test suite + the reconciler can
 *  reliably distinguish "we sent it" from "someone else already
 *  sent it" from "the merchant opted out" without inspecting the
 *  resulting audit row. */
export type LifecycleEmailOutcome =
  | { sent: true; logTag: string }
  | {
      skipped:
        | "already_sent"
        | "no_team_email"
        | "opted_out"
        | "no_setup"
        | "email_disabled"
        | "throttled";
    }
  | { error: string };

interface TeamContext {
  to: string | string[];
  shopDomain: string;
  shopName: string;
}

/** Subset of LifecycleEmailOutcome the team-context resolver can
 *  return. The "sent" variant is impossible here — we have not
 *  attempted a send — so excluding it lets callers narrow cleanly
 *  via `if ("skipped" in ctx || "error" in ctx) return ctx;`. */
type ResolveTeamContextResult =
  | TeamContext
  | { skipped: "no_team_email" | "opted_out" | "no_setup" }
  | { error: string };

/**
 * Resolve the merchant's team email + the per-shop billing-comms
 * opt-out flag. Returns null when the merchant has explicitly
 * disabled billing emails OR when no team email is configured.
 */
async function resolveTeamContext(
  sb: SbClient,
  shopId: string,
): Promise<ResolveTeamContextResult> {
  const { data: setup } = await sb
    .from("shop_setup")
    .select("steps")
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!setup) return { skipped: "no_setup" };

  const steps = setup.steps as Record<
    string,
    { payload?: Record<string, unknown> }
  > | null;

  const teamPayload = steps?.team?.payload;
  const notifications = teamPayload?.notifications as
    | { billing?: boolean }
    | undefined;
  // Default: billing emails are ON. Merchant must explicitly set
  // `notifications.billing = false` to disable.
  if (notifications?.billing === false) return { skipped: "opted_out" };

  const raw = teamPayload?.teamEmail as string | undefined;
  if (!raw || !raw.trim()) return { skipped: "no_team_email" };
  const to = raw.includes(",")
    ? raw.split(",").map((e) => e.trim()).filter(Boolean)
    : raw.trim();

  const { data: shop } = await sb
    .from("shops")
    .select("shop_domain")
    .eq("id", shopId)
    .single();
  const shopDomain = shop?.shop_domain ?? "";

  return { to, shopDomain, shopName: shopDomain };
}

async function sendViaResend(args: {
  subject: string;
  html: string;
  text: string;
  to: string | string[];
  logTag: string;
}): Promise<LifecycleEmailOutcome> {
  const apiKey = resendApiKey();
  if (!apiKey) {
    console.warn(
      `[billingLifecycle] RESEND_API_KEY not set — skipping ${args.logTag}`,
    );
    return { skipped: "email_disabled" };
  }
  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: fromEmail(),
      replyTo: replyTo(),
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });
    return { sent: true, logTag: args.logTag };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[billingLifecycle] send failed (${args.logTag}):`, message);
    return { error: message };
  }
}

function billingUrl(shopDomain: string): string {
  return getEmbeddedAppUrl(shopDomain, "billing");
}

function renderShell(args: {
  preheader: string;
  title: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
}): { html: string; text: string } {
  const cta =
    args.ctaLabel && args.ctaUrl
      ? `<div style="margin:28px 0 0">${ctaButton(args.ctaLabel, args.ctaUrl)}</div>`
      : "";

  const innerHtml = `${brandHeader("billing")}
    <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#111827;line-height:1.3;letter-spacing:-0.01em">${args.title}</h1>
    <div style="font-size:15px;color:#374151;line-height:1.6">${args.bodyHtml}</div>
    ${cta}`;

  const html = plateLayout({
    innerHtml,
    previewText: args.preheader,
    footerText: "DisputeDesk · billing notification",
  });

  const ctaText =
    args.ctaLabel && args.ctaUrl ? `\n\n${args.ctaLabel}: ${args.ctaUrl}` : "";
  // Strip HTML for the text fallback.
  const bodyText = args.bodyHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const text = `${args.title}\n\n${bodyText}${ctaText}`;
  return { html, text };
}

/* ── 1. Trial started ───────────────────────────────────────── */

export async function sendTrialStartedEmail(
  shopId: string,
): Promise<LifecycleEmailOutcome> {
  const sb = getServiceClient();
  const { data: claimed } = await sb
    .from("plan_entitlements")
    .update({ trial_started_at: new Date().toISOString() })
    .eq("shop_id", shopId)
    .is("trial_started_at", null)
    .select("plan_key, trial_ends_at")
    .single();
  if (!claimed) return { skipped: "already_sent" };

  const ctx = await resolveTeamContext(sb, shopId);
  if ("skipped" in ctx || "error" in ctx) return ctx;

  const plan = getPlan((claimed.plan_key as PlanId) ?? "free");
  const trialEnd = claimed.trial_ends_at
    ? new Date(claimed.trial_ends_at as string).toUTCString()
    : "the trial deadline";

  const { html, text } = renderShell({
    preheader: `Your DisputeDesk ${plan.name} trial is live`,
    title: `Welcome to ${plan.name}`,
    bodyHtml: `<p>Your trial is active. You have <strong>14 days + 25 trial packs</strong> to put auto-build through its paces.</p>
<p>Trial ends <strong>${trialEnd}</strong>. We'll send a heads-up three days before it ends so you can keep the automation running.</p>
<p>Already connected? Open a dispute to see auto-build kick in on the next chargeback.</p>`,
    ctaLabel: "Open DisputeDesk",
    ctaUrl: billingUrl(ctx.shopDomain),
  });

  const outcome = await sendViaResend({
    subject: `DisputeDesk ${plan.name} trial activated`,
    html,
    text,
    to: ctx.to,
    logTag: "trial_started",
  });
  await logEmailAudit(sb, shopId, "billing_email_sent", "trial_started", outcome);
  return outcome;
}

/* ── 2. First paid cycle (trial → active) ───────────────────── */

export async function sendFirstPaidCycleEmail(
  shopId: string,
  cycleEndIso: string,
): Promise<LifecycleEmailOutcome> {
  const sb = getServiceClient();
  const { data: claimed } = await sb
    .from("plan_entitlements")
    .update({ first_paid_cycle_started_at: new Date().toISOString() })
    .eq("shop_id", shopId)
    .is("first_paid_cycle_started_at", null)
    .select("plan_key")
    .single();
  if (!claimed) return { skipped: "already_sent" };

  const ctx = await resolveTeamContext(sb, shopId);
  if ("skipped" in ctx || "error" in ctx) return ctx;

  const plan = getPlan((claimed.plan_key as PlanId) ?? "free");
  const { html, text } = renderShell({
    preheader: `${plan.name} is active — first ${plan.packsPerMonth} packs are unlocked`,
    title: `You're on ${plan.name}`,
    bodyHtml: `<p>Your first $${plan.price} charge cleared and your first month of <strong>${plan.packsPerMonth} packs</strong> is available. Cycle ends ${new Date(cycleEndIso).toUTCString()}.</p>
<p>Auto-build is on for every new dispute that lands inside the cycle. Top-ups are available if you need more.</p>`,
    ctaLabel: "Open billing",
    ctaUrl: billingUrl(ctx.shopDomain),
  });

  const outcome = await sendViaResend({
    subject: `${plan.name} is active — ${plan.packsPerMonth} packs unlocked`,
    html,
    text,
    to: ctx.to,
    logTag: "first_paid_cycle",
  });
  await logEmailAudit(sb, shopId, "billing_email_sent", "first_paid_cycle", outcome);
  return outcome;
}

/* ── 3. Cycle renewed (monthly digest) ──────────────────────── */

export async function sendCycleRenewedEmail(args: {
  shopId: string;
  cycleEndIso: string;
  packsGranted: number;
}): Promise<LifecycleEmailOutcome> {
  const { shopId } = args;
  const sb = getServiceClient();
  // Only send once per cycle — the column stores the cycle_end the
  // last email referenced. Same cycle_end on a retry = already sent.
  const { data: claimed } = await sb
    .from("plan_entitlements")
    .update({ last_renewal_email_sent_cycle_end: args.cycleEndIso })
    .eq("shop_id", shopId)
    .or(
      `last_renewal_email_sent_cycle_end.is.null,last_renewal_email_sent_cycle_end.lt.${args.cycleEndIso}`,
    )
    .select("plan_key")
    .single();
  if (!claimed) return { skipped: "already_sent" };

  const ctx = await resolveTeamContext(sb, shopId);
  if ("skipped" in ctx || "error" in ctx) return ctx;
  const plan = getPlan((claimed.plan_key as PlanId) ?? "free");
  const cycleEnd = new Date(args.cycleEndIso).toUTCString();

  const { html, text } = renderShell({
    preheader: `${args.packsGranted} fresh packs are ready`,
    title: "Your cycle renewed",
    bodyHtml: `<p><strong>${args.packsGranted} packs</strong> are now available on your ${plan.name} plan. Cycle ends ${cycleEnd}.</p>
<p>Top-ups added during the cycle still expire 30 days from their original purchase, independent of this renewal.</p>`,
    ctaLabel: "View usage",
    ctaUrl: billingUrl(ctx.shopDomain),
  });

  const outcome = await sendViaResend({
    subject: `${args.packsGranted} packs unlocked for the new cycle`,
    html,
    text,
    to: ctx.to,
    logTag: "cycle_renewed",
  });
  await logEmailAudit(sb, shopId, "billing_email_sent", "cycle_renewed", outcome);
  return outcome;
}

/* ── 4. Payment failed → grace ──────────────────────────────── */

export async function sendGraceEnteredEmail(
  shopId: string,
): Promise<LifecycleEmailOutcome> {
  const sb = getServiceClient();
  // grace_entered_at is set by the reconciler at transition time.
  // We do not re-stamp it here — instead we use a side guard via a
  // bool audit lookup to keep idempotency at the email layer.
  const { data: entitlement } = await sb
    .from("plan_entitlements")
    .select("grace_entered_at")
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!entitlement?.grace_entered_at) return { skipped: "already_sent" };

  // Has an email for THIS grace event already been recorded?
  const { data: prior } = await sb
    .from("audit_events")
    .select("id")
    .eq("shop_id", shopId)
    .eq("event_type", "billing_email_sent")
    .filter("event_payload->>event", "eq", "grace_entered")
    .filter(
      "event_payload->>grace_entered_at",
      "eq",
      entitlement.grace_entered_at as string,
    )
    .limit(1)
    .maybeSingle();
  if (prior) return { skipped: "already_sent" };

  const ctx = await resolveTeamContext(sb, shopId);
  if ("skipped" in ctx || "error" in ctx) return ctx;

  const { html, text } = renderShell({
    preheader: "Card declined — auto-build still runs for 3 days",
    title: "Payment failed — short grace period",
    bodyHtml: `<p>Shopify couldn't charge your card for the latest DisputeDesk cycle. Shopify will keep retrying for the next 3 days.</p>
<p><strong>Auto-build still runs during grace</strong>, so your disputes keep getting packs built. After 3 days without a successful charge, auto-build pauses and you'll need to update payment in Shopify Admin to reactivate.</p>`,
    ctaLabel: "Update payment in Shopify",
    ctaUrl: `https://${ctx.shopDomain}/admin/charges`,
  });

  const outcome = await sendViaResend({
    subject: "Payment failed — please update card",
    html,
    text,
    to: ctx.to,
    logTag: "grace_entered",
  });
  await logEmailAudit(sb, shopId, "billing_email_sent", "grace_entered", outcome, {
    grace_entered_at: entitlement.grace_entered_at as string,
  });
  return outcome;
}

/* ── 5. Subscription expired ────────────────────────────────── */

export async function sendSubscriptionExpiredEmail(
  shopId: string,
): Promise<LifecycleEmailOutcome> {
  const sb = getServiceClient();
  const { data: entitlement } = await sb
    .from("plan_entitlements")
    .select("subscription_expired_at")
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!entitlement?.subscription_expired_at) return { skipped: "already_sent" };

  const { data: prior } = await sb
    .from("audit_events")
    .select("id")
    .eq("shop_id", shopId)
    .eq("event_type", "billing_email_sent")
    .filter("event_payload->>event", "eq", "subscription_expired")
    .filter(
      "event_payload->>subscription_expired_at",
      "eq",
      entitlement.subscription_expired_at as string,
    )
    .limit(1)
    .maybeSingle();
  if (prior) return { skipped: "already_sent" };

  const ctx = await resolveTeamContext(sb, shopId);
  if ("skipped" in ctx || "error" in ctx) return ctx;

  const { html, text } = renderShell({
    preheader: "Auto-build paused — historical disputes still accessible",
    title: "Auto-build paused",
    bodyHtml: `<p>Your DisputeDesk subscription is no longer active, so auto-build is paused for new disputes.</p>
<p><strong>You still have full access</strong> to every past dispute, evidence pack, and audit timeline — billing only gates new automation, never historical reads. Reactivate any time to resume.</p>`,
    ctaLabel: "Reactivate",
    ctaUrl: billingUrl(ctx.shopDomain),
  });

  const outcome = await sendViaResend({
    subject: "DisputeDesk auto-build paused — reactivate to resume",
    html,
    text,
    to: ctx.to,
    logTag: "subscription_expired",
  });
  await logEmailAudit(
    sb,
    shopId,
    "billing_email_sent",
    "subscription_expired",
    outcome,
    { subscription_expired_at: entitlement.subscription_expired_at as string },
  );
  return outcome;
}

/* ── 6. Cancelled ───────────────────────────────────────────── */

export async function sendCancellationEmail(
  shopId: string,
): Promise<LifecycleEmailOutcome> {
  const sb = getServiceClient();
  const { data: entitlement } = await sb
    .from("plan_entitlements")
    .select("cancelled_at")
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!entitlement?.cancelled_at) return { skipped: "already_sent" };

  const { data: prior } = await sb
    .from("audit_events")
    .select("id")
    .eq("shop_id", shopId)
    .eq("event_type", "billing_email_sent")
    .filter("event_payload->>event", "eq", "cancelled")
    .filter(
      "event_payload->>cancelled_at",
      "eq",
      entitlement.cancelled_at as string,
    )
    .limit(1)
    .maybeSingle();
  if (prior) return { skipped: "already_sent" };

  const ctx = await resolveTeamContext(sb, shopId);
  if ("skipped" in ctx || "error" in ctx) return ctx;

  const { html, text } = renderShell({
    preheader: "Sorry to see you go — your packs and history are preserved",
    title: "Subscription cancelled",
    bodyHtml: `<p>Your DisputeDesk subscription is cancelled. Auto-build is off, but every dispute, evidence pack, and audit row you've ever generated is preserved and remains viewable.</p>
<p>Resubscribe at any time and your packs pick up from your current cycle's allotment.</p>`,
    ctaLabel: "Reactivate",
    ctaUrl: billingUrl(ctx.shopDomain),
  });

  const outcome = await sendViaResend({
    subject: "DisputeDesk subscription cancelled",
    html,
    text,
    to: ctx.to,
    logTag: "cancelled",
  });
  await logEmailAudit(sb, shopId, "billing_email_sent", "cancelled", outcome, {
    cancelled_at: entitlement.cancelled_at as string,
  });
  return outcome;
}

/* ── 7. Top-up purchased ────────────────────────────────────── */

export async function sendTopupPurchasedEmail(args: {
  shopId: string;
  packs: number;
  expiresAt: string;
  reference: string;
}): Promise<LifecycleEmailOutcome> {
  const sb = getServiceClient();

  // Per-purchase idempotency: one email per ledger reference. The
  // pack_credits_ledger row is the source of truth; if its insert
  // ran, the reference is unique and this lookup will find a single
  // matching audit row on retry.
  const { data: prior } = await sb
    .from("audit_events")
    .select("id")
    .eq("shop_id", args.shopId)
    .eq("event_type", "billing_email_sent")
    .filter("event_payload->>event", "eq", "topup_purchased")
    .filter("event_payload->>reference", "eq", args.reference)
    .limit(1)
    .maybeSingle();
  if (prior) return { skipped: "already_sent" };

  const ctx = await resolveTeamContext(sb, args.shopId);
  if ("skipped" in ctx || "error" in ctx) return ctx;

  const expiresLabel = new Date(args.expiresAt).toUTCString();
  const { html, text } = renderShell({
    preheader: `${args.packs} extra packs added`,
    title: `${args.packs} top-up packs added`,
    bodyHtml: `<p>Your top-up cleared. <strong>${args.packs} extra packs</strong> are now available alongside your monthly allotment.</p>
<p>Top-up packs expire 30 days from purchase, independent of your billing cycle — these expire <strong>${expiresLabel}</strong>.</p>`,
    ctaLabel: "View usage",
    ctaUrl: billingUrl(ctx.shopDomain),
  });

  const outcome = await sendViaResend({
    subject: `${args.packs} top-up packs added to your account`,
    html,
    text,
    to: ctx.to,
    logTag: "topup_purchased",
  });
  await logEmailAudit(
    sb,
    args.shopId,
    "billing_email_sent",
    "topup_purchased",
    outcome,
    { reference: args.reference, packs: args.packs, expires_at: args.expiresAt },
  );
  return outcome;
}

/* ── 8. Free tier out of packs ──────────────────────────────── */

/**
 * A free shop exhausted its lifetime pack floor and hit the wall on a
 * manual pack build. The in-app `free_out_of_packs` banner always
 * shows; this email is the "come back before your deadline" nudge for
 * merchants who close the tab.
 *
 * Unlike the state-transition lifecycle emails above, the free tier has
 * no billing cycle, so idempotency is delegated to the shared
 * `claimBillingBlockedEmailSlot` throttle — the SAME guard the paid
 * auto-build path uses (1 email per dispute ever, 6h per-shop cooldown
 * for the same reason, always send when the dispute deadline is within
 * 72h). We key the slot on `QUOTA_EXCEEDED` so a free shop that later
 * upgrades and hits the paid quota wall doesn't get a duplicate email
 * for the same dispute.
 */
export async function sendFreeOutOfPacksEmail(args: {
  shopId: string;
  disputeId: string;
  disputeDueAt?: string | null;
}): Promise<LifecycleEmailOutcome> {
  const sb = getServiceClient();

  const slot = await claimBillingBlockedEmailSlot({
    shopId: args.shopId,
    disputeId: args.disputeId,
    reason: DISPUTE_ATTENTION_REASONS.QUOTA_EXCEEDED,
    disputeDueAt: args.disputeDueAt ?? null,
  });
  if (!slot.allowed) return { skipped: "throttled" };

  const ctx = await resolveTeamContext(sb, args.shopId);
  if ("skipped" in ctx || "error" in ctx) return ctx;

  const { html, text } = renderShell({
    preheader: "You're out of free submissions — upgrade to keep responding",
    title: "You've used your free submissions",
    bodyHtml: `<p>Drafts are still unlimited — but submitting evidence to the bank needs a credit, and you've used all your free submissions.</p>
<p>A recovered chargeback is usually worth far more than a $29/mo plan, so a single won dispute pays for months of submissions. Upgrade now to keep responding before your deadline.</p>`,
    ctaLabel: "Upgrade plan",
    ctaUrl: billingUrl(ctx.shopDomain),
  });

  const outcome = await sendViaResend({
    subject: "You're out of free submissions — upgrade to keep responding",
    html,
    text,
    to: ctx.to,
    logTag: "free_out_of_packs",
  });
  await logEmailAudit(
    sb,
    args.shopId,
    "billing_email_sent",
    "free_out_of_packs",
    outcome,
    { dispute_id: args.disputeId },
  );
  return outcome;
}

/* ── Audit logger ───────────────────────────────────────────── */

async function logEmailAudit(
  sb: SbClient,
  shopId: string,
  eventType: string,
  event: string,
  outcome: LifecycleEmailOutcome,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    await sb.from("audit_events").insert({
      shop_id: shopId,
      actor_type: "system",
      event_type: eventType,
      event_payload: {
        event,
        outcome,
        ...(extra ?? {}),
        sent_at: new Date().toISOString(),
      },
    });
  } catch {
    /* non-fatal */
  }
}
