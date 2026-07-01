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
import { createTranslator } from "next-intl";
import { getServiceClient } from "@/lib/supabase/server";
import { getPlan, type PlanId } from "@/lib/billing/plans";
import { claimBillingBlockedEmailSlot } from "@/lib/automation/billingBlockedEmailThrottle";
import { DISPUTE_ATTENTION_REASONS } from "@/lib/disputes/attentionReasons";
import { getMessages } from "@/lib/i18n/getMessages";
import { normalizeLocale, DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";
import { toBcp47 } from "@/lib/i18n/bcp47";
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

/** A namespaced translator for the `email.billing` message tree plus a
 *  locale-aware absolute-date formatter. Built from `shops.locale`, so
 *  request-less senders (billing cron/webhook) still localize. */
interface BillingT {
  /** Namespaced (`email.billing`) translator. Typed loosely because the
   *  message tree is loaded at runtime from a locale JSON, not the
   *  compile-time `IntlMessages` shape createTranslator infers. */
  t: (key: string, values?: Record<string, string | number>) => string;
  /** Format an ISO timestamp as an absolute date in the shop's locale. */
  formatDate: (iso: string) => string;
}

/**
 * Resolve the shop's persisted locale and return a translator scoped to
 * `email.billing`. Falls back to the default locale when the shop row or
 * its `locale` column is missing. `shops.locale` is written at OAuth
 * install/re-auth time (see the shopify callback route).
 */
async function getBillingTranslator(
  sb: SbClient,
  shopId: string,
): Promise<BillingT> {
  const { data: shop } = await sb
    .from("shops")
    .select("locale")
    .eq("id", shopId)
    .maybeSingle();
  const locale: Locale =
    normalizeLocale((shop?.locale as string | null) ?? null) ?? DEFAULT_LOCALE;

  const messages = await getMessages(locale);
  // The runtime-loaded catalog isn't the compile-time IntlMessages shape
  // createTranslator infers, so build the translator against a loosely
  // typed factory and expose a plain (key, values) => string signature.
  const create = createTranslator as unknown as (opts: {
    locale: string;
    messages: Record<string, unknown>;
    namespace: string;
  }) => (key: string, values?: Record<string, string | number>) => string;
  const t = create({ locale, messages, namespace: "email.billing" });

  const bcp47 = toBcp47(locale);
  const formatDate = (iso: string): string => {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    return new Intl.DateTimeFormat(bcp47, {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(d);
  };

  return { t, formatDate };
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

/** Minimal HTML escape for message-sourced copy before we inject our
 *  own `<p>` / `<strong>` markup. Keeps a stray `<` in translated copy
 *  from becoming a broken tag. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Bodies are stored as plain, translator-safe text in messages/*.json:
 * paragraphs separated by a blank line (`\n\n`) and emphasis marked with
 * `**bold**` (markdown-style). We can't use inline `<p>`/`<strong>` in the
 * message strings because next-intl's ICU parser treats `<tag>` as rich-text
 * markup and throws unless a tag handler is supplied. Converting here keeps
 * the message catalog free of HTML AND gives a clean text fallback.
 */
function bodyToHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((para) => {
      const withStrong = escapeHtml(para).replace(
        /\*\*([^*]+)\*\*/g,
        "<strong>$1</strong>",
      );
      return `<p style="margin:0 0 14px">${withStrong}</p>`;
    })
    .join("");
}

function bodyToText(body: string): string {
  return body.replace(/\*\*([^*]+)\*\*/g, "$1").trim();
}

function renderShell(args: {
  preheader: string;
  title: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}): { html: string; text: string } {
  const cta =
    args.ctaLabel && args.ctaUrl
      ? `<div style="margin:28px 0 0">${ctaButton(args.ctaLabel, args.ctaUrl)}</div>`
      : "";

  const innerHtml = `${brandHeader("billing")}
    <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#111827;line-height:1.3;letter-spacing:-0.01em">${escapeHtml(args.title)}</h1>
    <div style="font-size:15px;color:#374151;line-height:1.6">${bodyToHtml(args.body)}</div>
    ${cta}`;

  const html = plateLayout({
    innerHtml,
    previewText: args.preheader,
    footerText: "DisputeDesk · billing notification",
  });

  const ctaText =
    args.ctaLabel && args.ctaUrl ? `\n\n${args.ctaLabel}: ${args.ctaUrl}` : "";
  const text = `${args.title}\n\n${bodyToText(args.body)}${ctaText}`;
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

  const { t, formatDate } = await getBillingTranslator(sb, shopId);
  const plan = getPlan((claimed.plan_key as PlanId) ?? "free");
  const trialEnd = claimed.trial_ends_at
    ? formatDate(claimed.trial_ends_at as string)
    : t("trialStarted.trialDeadlineFallback");
  const vars = { planName: plan.name, trialEnd };

  const { html, text } = renderShell({
    preheader: t("trialStarted.preheader", vars),
    title: t("trialStarted.title", vars),
    body: t("trialStarted.body", vars),
    ctaLabel: t("trialStarted.cta"),
    ctaUrl: billingUrl(ctx.shopDomain),
  });

  const outcome = await sendViaResend({
    subject: t("trialStarted.subject", vars),
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

  const { t, formatDate } = await getBillingTranslator(sb, shopId);
  const plan = getPlan((claimed.plan_key as PlanId) ?? "free");
  const vars = {
    planName: plan.name,
    packs: plan.packsPerMonth,
    price: plan.price,
    cycleEnd: formatDate(cycleEndIso),
  };
  const { html, text } = renderShell({
    preheader: t("firstPaidCycle.preheader", vars),
    title: t("firstPaidCycle.title", vars),
    body: t("firstPaidCycle.body", vars),
    ctaLabel: t("firstPaidCycle.cta"),
    ctaUrl: billingUrl(ctx.shopDomain),
  });

  const outcome = await sendViaResend({
    subject: t("firstPaidCycle.subject", vars),
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
  const { t, formatDate } = await getBillingTranslator(sb, shopId);
  const plan = getPlan((claimed.plan_key as PlanId) ?? "free");
  const vars = {
    packs: args.packsGranted,
    planName: plan.name,
    cycleEnd: formatDate(args.cycleEndIso),
  };

  const { html, text } = renderShell({
    preheader: t("cycleRenewed.preheader", vars),
    title: t("cycleRenewed.title", vars),
    body: t("cycleRenewed.body", vars),
    ctaLabel: t("cycleRenewed.cta"),
    ctaUrl: billingUrl(ctx.shopDomain),
  });

  const outcome = await sendViaResend({
    subject: t("cycleRenewed.subject", vars),
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

  const { t } = await getBillingTranslator(sb, shopId);
  const { html, text } = renderShell({
    preheader: t("graceEntered.preheader"),
    title: t("graceEntered.title"),
    body: t("graceEntered.body"),
    ctaLabel: t("graceEntered.cta"),
    ctaUrl: `https://${ctx.shopDomain}/admin/charges`,
  });

  const outcome = await sendViaResend({
    subject: t("graceEntered.subject"),
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

  const { t } = await getBillingTranslator(sb, shopId);
  const { html, text } = renderShell({
    preheader: t("subscriptionExpired.preheader"),
    title: t("subscriptionExpired.title"),
    body: t("subscriptionExpired.body"),
    ctaLabel: t("subscriptionExpired.cta"),
    ctaUrl: billingUrl(ctx.shopDomain),
  });

  const outcome = await sendViaResend({
    subject: t("subscriptionExpired.subject"),
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

  const { t } = await getBillingTranslator(sb, shopId);
  const { html, text } = renderShell({
    preheader: t("cancelled.preheader"),
    title: t("cancelled.title"),
    body: t("cancelled.body"),
    ctaLabel: t("cancelled.cta"),
    ctaUrl: billingUrl(ctx.shopDomain),
  });

  const outcome = await sendViaResend({
    subject: t("cancelled.subject"),
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

  const { t, formatDate } = await getBillingTranslator(sb, args.shopId);
  const vars = { packs: args.packs, expiresAt: formatDate(args.expiresAt) };
  const { html, text } = renderShell({
    preheader: t("topupPurchased.preheader", vars),
    title: t("topupPurchased.title", vars),
    body: t("topupPurchased.body", vars),
    ctaLabel: t("topupPurchased.cta"),
    ctaUrl: billingUrl(ctx.shopDomain),
  });

  const outcome = await sendViaResend({
    subject: t("topupPurchased.subject", vars),
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

  const { t } = await getBillingTranslator(sb, args.shopId);
  const { html, text } = renderShell({
    preheader: t("freeOutOfPacks.preheader"),
    title: t("freeOutOfPacks.title"),
    body: t("freeOutOfPacks.body"),
    ctaLabel: t("freeOutOfPacks.cta"),
    ctaUrl: billingUrl(ctx.shopDomain),
  });

  const outcome = await sendViaResend({
    subject: t("freeOutOfPacks.subject"),
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
