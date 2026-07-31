import { DISPUTE_REASON_FAMILIES, type AllDisputeReasonCode } from "@/lib/rules/disputeReasons";
import { normalizeDisputeReasonKey } from "@/lib/disputes/reasonLabel";
import { safeDynamicT } from "@/lib/i18n/safeDynamicT";
import type { DisputePresentation } from "@/lib/disputes/presentation/types";
import { listPrimaryState } from "@/lib/disputes/presentation/labels";
import { effectiveReviewDecision } from "@/lib/disputes/presentation/reviewDecision";
import type { I18nToken } from "@/lib/i18n/token";
import {
  ATTENTION_ROW_EMPHASIS,
  type RowEmphasisTokens,
} from "@/lib/disputes/presentation/uiTokens";

export interface Dispute {
  id: string;
  dispute_gid: string;
  order_gid: string | null;
  order_name?: string | null;
  customer_display_name?: string | null;
  status: string | null;
  reason: string | null;
  phase: string | null;
  amount: number | null;
  currency_code: string | null;
  due_at: string | null;
  initiated_at: string | null;
  needs_review: boolean;
  /** Merchant review decision (2026-07-23). Drives the list chip and
   *  removes approved/conceded rows from the actionable views. */
  review_state?: "in_review" | "approved" | "conceded" | null;
  review_due_at?: string | null;
  last_synced_at: string | null;
  normalized_status?: string | null;
  submission_state?: string | null;
  final_outcome?: string | null;
  closed_at?: string | null;
  submitted_at?: string | null;
  outcome_amount_recovered?: number | null;
  outcome_amount_lost?: number | null;
  last_event_at?: string | null;
  /** Latest non-failed pack's case_strength snapshot. Surfaced by
   *  `/api/disputes` to render the Figma list-page strength pill +
   *  "{N} strong signals" subtitle. Null when no completed pack exists. */
  caseStrength?: {
    overall: "strong" | "moderate" | "weak" | "insufficient";
    strongCount: number;
    moderateCount: number;
    supportingCount: number;
    /** Rules-engine explanation token — the strength subtitle
     *  (replaces the banned signal-count arithmetic; plan §5). */
    strengthReasonI18n?: I18nToken | null;
  } | null;
  /** Shared presentation model resolved server-side by
   *  lib/disputes/presentation — the same interpretation the dashboard
   *  and detail page use. The list never re-derives it. */
  presentation?: DisputePresentation | null;
}

/* ── Shared-presentation row helpers (plan §5) ── */

/** The two-line "Status & next step" cell: primary operational label +
 *  secondary responsibility copy. Falls back to the legacy next-action
 *  vocabulary only when a row predates the presentation field. */
export function rowPrimaryState(
  d: Dispute,
  t: Translate,
): { label: string; sub: string } {
  if (d.presentation) {
    const keys = listPrimaryState(d.presentation, d.review_state ?? null);
    return { label: t(keys.labelKey), sub: t(keys.subKey) };
  }
  return { label: figmaNextAction(d, t), sub: "" };
}

/** Row emphasis follows MERCHANT ATTENTION only (plan §5): light for
 *  opportunity/recommended, clear-task for requested, warning for
 *  blocking, error for merchant-resolvable technical problems. Never
 *  emphasized for active/weak/editable/monitoring/saved. */
export function rowAttentionEmphasis(d: Dispute): RowEmphasisTokens | null {
  const attention = d.presentation?.attention;
  if (!attention) return null;
  return ATTENTION_ROW_EMPHASIS[attention] ?? null;
}

/** Full row chrome from the shared model. Emphasis is attention-driven;
 *  a tight deadline AMPLIFIES a row that already carries a required
 *  action (blocking/requested) to the warning treatment — deadline risk
 *  is emphasis, never a standalone attention value (plan §3.1/§5).
 *  Terminal rows dim. Falls back to the legacy chrome for rows without
 *  a presentation. */
export function rowChromeV2(d: Dispute): {
  stripeColor: string | null;
  bgColor: string | null;
  opacity: number;
} {
  const p = d.presentation;
  if (!p) return figmaRowChrome(d);
  if (p.terminal) return { stripeColor: null, bgColor: null, opacity: 0.6 };
  // A recorded review decision (approved/conceded/in_review) calms the
  // row — no attention emphasis — mirroring the detail page, which
  // suppresses the attention pill once a decision exists. Without this an
  // in_review dispute kept its amber/blocking chrome on the list while
  // the detail showed a calm "On hold" (list-vs-detail divergence).
  // Only while the decision is still pending: once it has been carried
  // out, attention is authoritative again (a save that later fails must
  // not stay calm forever behind a stale `review_state`).
  if (effectiveReviewDecision(p.lifecycle, d.review_state)) {
    return { stripeColor: null, bgColor: null, opacity: 1 };
  }
  const emphasis = ATTENTION_ROW_EMPHASIS[p.attention] ?? null;
  if (!emphasis) return { stripeColor: null, bgColor: null, opacity: 1 };
  const hasRequiredAction =
    p.attention === "blocking" ||
    p.attention === "requested" ||
    p.attention === "technical_error";
  if (hasRequiredAction && d.due_at && !d.closed_at) {
    const hoursLeft =
      (new Date(d.due_at).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursLeft <= 48) {
      const warn = ATTENTION_ROW_EMPHASIS.blocking!;
      return { stripeColor: warn.stripe, bgColor: warn.bg, opacity: 1 };
    }
  }
  return { stripeColor: emphasis.stripe, bgColor: emphasis.bg, opacity: 1 };
}

// strengthSubtitle was removed (user decision 2026-07-26, reconfirmed):
// the Case strength column shows the grade pill ONLY (Weak/Moderate/
// Strong) — no explanation sub-line, which also leaked raw i18n keys
// like "disputes.strengthReaso…" on rows whose token had no locale
// entry. The engine's explanation still renders on the detail page.

export type TabId = "active" | "closed" | "all";
export type SortMode = "default" | "urgency" | "amount" | "newest" | "closed_desc";

type Translate = (key: string, params?: Record<string, string | number>) => string;
type BadgeTone = "success" | "critical" | "warning" | "info" | "attention" | undefined;
type SoftTone = "success" | "critical" | "warning" | undefined;

export const NORMALIZED_STATUS_TONE: Record<string, BadgeTone> = {
  won: "success",
  lost: "critical",
  new: "info",
  in_progress: "info",
  needs_review: "attention",
  ready_to_submit: "attention",
  action_needed: "warning",
  submitted: "info",
  submitted_to_shopify: "info",
  waiting_on_issuer: "info",
  submitted_to_bank: "info",
  accepted_not_contested: "success",
  closed_other: "success",
};

export const OUTCOME_TONE: Record<string, SoftTone> = {
  won: "success",
  lost: "critical",
  refunded: "warning",
  accepted: "warning",
  partially_won: "success",
  canceled: undefined,
  expired: undefined,
};

export function translateReason(reason: string | null, t: Translate): string {
  if (!reason) return "—";
  // Canonicalize casing: legacy rows may carry a lowercase REST reason
  // (e.g. "credit_not_processed") while the disputeReasons map is keyed by the
  // UPPERCASE enum. Without this the localized label silently misses.
  const canonical = normalizeDisputeReasonKey(reason);
  const fallback = canonical
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return safeDynamicT(t, `disputeReasons.${canonical}`, fallback);
}

export function translateFamily(reason: string | null, t: Translate): string {
  const family =
    DISPUTE_REASON_FAMILIES[normalizeDisputeReasonKey(reason) as AllDisputeReasonCode];
  if (!family) return "";
  return safeDynamicT(t, `disputeFamilies.${family}`, family);
}

export function formatCurrency(
  amount: number | null,
  code: string | null,
  locale: string,
): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code ?? "USD",
  }).format(amount);
}

export function formatShortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

export function formatListDisputeId(id: string): string {
  const hex = id.replace(/-/g, "").slice(0, 4).toUpperCase();
  return `DP-${hex}`;
}

export function orderLabel(d: Dispute): string {
  return d.order_name ?? (d.order_gid ? `#${String(d.order_gid).slice(-4)}` : "—");
}

export function formatDueDate(iso: string | null, dateLocale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(dateLocale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function statusLabelForCsv(status: string | null, t: Translate): string {
  if (!status) return t("disputes.statusUnknown");
  switch (status) {
    case "needs_response":
      return t("disputes.statusOpen");
    case "under_review":
      return t("disputes.statusUnderReview");
    case "charge_refunded":
    case "won":
      return t("disputes.statusWon");
    case "lost":
      return t("disputes.statusLost");
    default:
      return status.replace(/_/g, " ");
  }
}

export function statusBadgeTone(status: string | null): BadgeTone {
  switch (status) {
    case "charge_refunded":
    case "won":
      return "success";
    case "lost":
      return "critical";
    case "under_review":
      return "warning";
    case "needs_response":
      return "info";
    default:
      return undefined;
  }
}

export function statusBadgeLabel(status: string | null, t: Translate): string {
  if (!status) return t("disputes.statusUnknown");
  switch (status) {
    case "needs_response":
      return t("disputes.statusOpen");
    case "under_review":
      return t("disputes.statusUnderReview");
    case "charge_refunded":
    case "won":
      return t("disputes.statusWon");
    case "lost":
      return t("disputes.statusLost");
    default:
      return status.replace(/_/g, " ");
  }
}

export type UrgencyTone = "critical" | "warning" | "attention" | "success" | undefined;

export function getUrgency(
  d: Dispute,
  t: Translate,
): { label: string; tone: UrgencyTone } {
  if (d.due_at) {
    const hoursLeft = (new Date(d.due_at).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursLeft < 0) return { label: t("disputes.urgencyOverdue"), tone: "critical" };
    if (hoursLeft <= 48) return { label: t("disputes.urgencyUrgent"), tone: "warning" };
  }
  if (d.needs_review) return { label: t("disputes.urgencyReview"), tone: "attention" };
  return { label: t("disputes.urgencyOnTrack"), tone: "success" };
}

export type DueTimingTone = "critical" | "subdued" | undefined;

export function formatDueTiming(
  d: Dispute,
  activeTab: TabId,
  t: Translate,
  dateLocale: string,
): { label: string; tone: DueTimingTone } {
  if (activeTab === "closed" && d.closed_at) {
    return {
      label: t("disputes.mobileClosedOn", { date: formatDueDate(d.closed_at, dateLocale) }),
      tone: "subdued",
    };
  }
  if (!d.due_at) {
    return { label: t("disputes.mobileNoDueDate"), tone: "subdued" };
  }
  const diffMs = new Date(d.due_at).getTime() - Date.now();
  const hours = diffMs / (1000 * 60 * 60);
  if (hours < 0) {
    const over = Math.abs(hours);
    const time = over < 24 ? `${Math.max(1, Math.round(over))}h` : `${Math.round(over / 24)}d`;
    return { label: t("disputes.mobileDueOverdue", { time }), tone: "critical" };
  }
  if (hours <= 24) {
    const time = `${Math.max(1, Math.round(hours))}h`;
    return { label: t("disputes.mobileDueToday", { time }), tone: "critical" };
  }
  const days = Math.round(hours / 24);
  if (days <= 7) {
    return { label: t("disputes.mobileDueInDays", { n: days }), tone: undefined };
  }
  return { label: formatDueDate(d.due_at, dateLocale), tone: "subdued" };
}

/**
 * Parse the dispute-list deep-link params (`?normalized_status=…`,
 * `?closed=…`) into the page's initial filter state. Dashboard tiles
 * deep-link with these (e.g. "Needs action" →
 * `?normalized_status=new,action_needed,needs_review`); the page MUST
 * honor them on the first fetch or the list renders unfiltered — which
 * showed resolved 2018 disputes under a "needs action" heading
 * (blume-box, 2026-07-22). A status deep-link implies the active
 * (open-only) tab so `closed=false` is sent and resolved rows are
 * excluded.
 */
export function parseListDeepLink(searchParams: {
  get(name: string): string | null;
} | null): { statuses: string[]; tab: TabId; attention: "" | "tasks" | "comm" } {
  const raw = searchParams?.get("normalized_status") ?? "";
  const statuses = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Attention deep-link (plan §11): the dashboard banner links
  // `?attention=tasks` (genuine merchant tasks only).
  const attentionRaw = searchParams?.get("attention");
  const attention: "" | "tasks" | "comm" =
    attentionRaw === "tasks" || attentionRaw === "comm" ? attentionRaw : "";
  const closedParam = searchParams?.get("closed");
  const tab: TabId =
    closedParam === "true"
      ? "closed"
      : statuses.length > 0 || attention !== "" || closedParam === "false"
        ? "active"
        : "all";
  return { statuses, tab, attention };
}

/**
 * Map sortMode + tab to the `sort` + `sort_dir` query params accepted by
 * /api/disputes. `default` mirrors the current tab-derived behavior so
 * desktop (where sortMode stays `default`) fetches identically to today.
 */
export function resolveSort(
  sortMode: SortMode,
  activeTab: TabId,
): { sort: string; sort_dir: "asc" | "desc" } {
  if (sortMode === "urgency") return { sort: "due_at", sort_dir: "asc" };
  if (sortMode === "amount") return { sort: "amount", sort_dir: "desc" };
  // "Newest" = the real Shopify dispute date (initiated_at), NOT created_at
  // (our DB import timestamp). A historical import gives every row a
  // near-identical created_at, so created_at sorting scrambled the order and
  // surfaced old 2024 disputes first. initiated_at is what the table displays.
  if (sortMode === "newest") return { sort: "initiated_at", sort_dir: "desc" };
  if (sortMode === "closed_desc") return { sort: "closed_at", sort_dir: "desc" };
  // Default per tab. On open/active/all views the merchant is triaging
  // against deadlines, so the natural order is soonest-due-first
  // (`due_at asc`) — the UI already labels the default pill "Most urgent",
  // and this makes the request match that label (previously it sent
  // `initiated_at desc`, so a dispute due today could land on page 3–4).
  // Rows with no due date sink to the end (API sets nullsFirst:false).
  if (activeTab === "closed") return { sort: "closed_at", sort_dir: "desc" };
  return { sort: "due_at", sort_dir: "asc" };
}

/* ── Figma list-page helpers (shopify-cases.tsx, 2026-04-28) ── *
 *
 * The new list page replaces the table-with-tabs layout with a
 * card-grid + KPI row + red urgency banner. These pure helpers
 * derive every field the new design needs from the existing
 * `Dispute` shape (no schema change) so the rendering components
 * stay declarative.
 */

export type FigmaStatus =
  | "action-needed"
  | "needs-review"
  | "under-review"
  | "submitted"
  | "closed";

export type FigmaCaseStrength = "strong" | "moderate" | "weak";
export type FigmaOutcome = "pending" | "won" | "lost" | "closed";
export type FigmaDueStatus = "past" | "today" | "upcoming" | "closed";

/** The "evidence is committed, awaiting an external outcome" status
 *  family. Single source of truth shared by the list's under-review
 *  collapse (below) and the dashboard's "Waiting on Issuer" card —
 *  the card must count every status the list renders as "Submitted",
 *  or a submitted dispute appears in the list but on no card
 *  (cay-collective #12121, 2026-07-14). */
export const UNDER_REVIEW_NORMALIZED_STATUSES = [
  "submitted",
  "submitted_to_shopify",
  "submitted_to_bank",
  "waiting_on_issuer",
] as const;

/** Map the persisted normalized_status (and closed_at) to the Figma
 *  status enum. `new`, `in_progress`, and `ready_to_submit` collapse to
 *  `action-needed` per scope decision: the merchant should treat
 *  unsynced / being-built / ready-to-submit all as "something to do". */
export function figmaStatus(d: Dispute): FigmaStatus {
  if (d.closed_at) return "closed";
  const ns = d.normalized_status;
  if (
    ns === "won" ||
    ns === "lost" ||
    ns === "accepted_not_contested" ||
    ns === "closed_other"
  ) {
    return "closed";
  }
  // Merchant review decisions (2026-07-23) take priority over the raw
  // status so approved/conceded rows leave the actionable views:
  //   conceded → "closed" (won't be defended; nothing more to do)
  //   approved → "under-review" (scheduled to submit on the deadline)
  // in_review stays actionable — it's work-in-progress — but carries its
  // own calmer chip via figmaReviewChip() rather than a red nag.
  if (d.review_state === "conceded") return "closed";
  if (d.review_state === "approved") return "under-review";
  if ((UNDER_REVIEW_NORMALIZED_STATUSES as readonly string[]).includes(ns ?? "")) {
    return "under-review";
  }
  if (ns === "needs_review" || d.needs_review) return "needs-review";
  // action_needed | new | in_progress | ready_to_submit | unknown → action-needed
  return "action-needed";
}

/** Review-lifecycle chip for the list/search rows. Returns null when the
 *  merchant hasn't made a decision (the row shows its normal status
 *  chip). When present, the chip is rendered ALONGSIDE the status pill so
 *  the merchant sees the standing decision at a glance:
 *    in_review → "In review" (+ optional countdown from review_due_at)
 *    approved  → "Scheduled"
 *    conceded  → "Not defended"
 *  Colors follow the list's soft-pill palette.
 *
 *  Also null once the decision has been CARRIED OUT — `review_state`
 *  outlives the save, so an already-filed row would keep wearing
 *  "Scheduled" (effectiveReviewDecision). */
export function figmaReviewChip(
  d: Dispute,
  t: Translate,
): { label: string; bg: string; color: string } | null {
  switch (effectiveReviewDecision(d.presentation?.lifecycle, d.review_state)) {
    case "in_review": {
      const days =
        d.review_due_at != null
          ? Math.ceil(
              (new Date(d.review_due_at).getTime() - Date.now()) / 86_400_000,
            )
          : null;
      const label =
        days != null && days >= 0
          ? t("disputes.reviewChip.inReviewDue", { days })
          : t("disputes.reviewChip.inReview");
      return { label, bg: "#FEF3C7", color: "#92400E" };
    }
    case "approved":
      return { label: t("disputes.reviewChip.scheduled"), bg: "#E0F2FE", color: "#075985" };
    case "conceded":
      return { label: t("disputes.reviewChip.notDefended"), bg: "#E1E3E5", color: "#6D7175" };
    default:
      return null;
  }
}

/** Map persisted case_strength.overall to the Figma 3-bucket pill.
 *  Returns null when no completed pack exists yet OR the pack scored
 *  `insufficient` (pre-assessment) — the UI renders an em-dash, matching
 *  the detail page's "Not yet assessed" rather than falsely showing a
 *  "Weak" pill for an unassessed case. Prefers the shared presentation
 *  strength when present (it distinguishes not_assessed from weak). */
export function figmaCaseStrength(d: Dispute): FigmaCaseStrength | null {
  const p = d.presentation?.strength;
  if (p) {
    if (p === "strong") return "strong";
    if (p === "moderate") return "moderate";
    if (p === "weak") return "weak";
    return null; // not_assessed → em-dash
  }
  const o = d.caseStrength?.overall;
  if (!o) return null;
  if (o === "strong") return "strong";
  if (o === "moderate") return "moderate";
  if (o === "insufficient") return null; // not assessed → em-dash, not "Weak"
  return "weak";
}

// figmaStrengthDetail and strengthSubtitle were both deleted: the Case
// strength column shows only the grade pill (Weak/Moderate/Strong). The
// arithmetic subtitle contradicted the grade, and the engine-explanation
// subtitle leaked raw i18n keys; the explanation lives on the detail
// page. The strengthDetailSignals/strengthDetailMixed keys are gone too.

/** Map final_outcome to the Figma 3-bucket outcome pill. Pre-decision
 *  rows render "Pending". */
export function figmaOutcome(d: Dispute): FigmaOutcome {
  const o = d.final_outcome;
  if (o === "won" || o === "partially_won") return "won";
  if (o === "lost" || o === "refunded" || o === "accepted") return "lost";
  // A terminal dispute with no won/lost outcome is CLOSED, not pending —
  // showing "Pending" implied it was still open (matches the detail
  // page's neutral "Closed" lifecycle). Prefer the presentation outcome.
  if (d.presentation?.outcome === "closed") return "closed";
  if (d.presentation?.lifecycle === "closed") return "closed";
  return "pending";
}

/** Natural-language due-date label + status enum for the Figma row.
 *  Closed disputes show "Resolved" (with closed_at). Transmission-
 *  confirmed rows show "Sent {date}" (from `submitted_at`) — NEVER the
 *  word "Submitted" as a deadline (plan §5.6; saved ≠ sent, and a
 *  status is not a date). Rows that are merely saved keep their real
 *  deadline. Otherwise the relative-time logic from `formatDueTiming`. */
export function figmaDueDate(
  d: Dispute,
  t: Translate,
  dateLocale: string,
): { label: string; status: FigmaDueStatus } {
  const status = figmaStatus(d);
  if (status === "closed") {
    return { label: t("disputes.dueResolved"), status: "closed" };
  }
  // "Sent {date}" only once transmission is externally confirmed
  // (submission_state / the under-review normalized family). Without a
  // usable sent date, fall back to a neutral em-dash — never a fake
  // deadline and never the word "Submitted".
  const transmissionConfirmed =
    d.presentation?.transmissionConfirmed ??
    (d.submission_state === "submitted_confirmed" ||
      d.normalized_status === "submitted_to_bank");
  // A merely SAVED-to-Shopify dispute (editable, not yet transmitted)
  // keeps its real deadline — it is NOT "sent". figmaStatus collapses
  // `submitted_to_shopify` into `under-review`, which previously dropped
  // the deadline to "—" and made the list look done while the detail
  // page still showed a live "Shopify response deadline". Trust the
  // presentation lifecycle: only genuinely-transmitted (or the legacy
  // under-review status WITHOUT a saved-editable presentation) collapses.
  const savedEditable =
    d.presentation?.lifecycle === "saved_to_shopify" ||
    d.presentation?.lifecycle === "pack_prepared" ||
    d.presentation?.lifecycle === "monitoring" ||
    d.presentation?.lifecycle === "building_evidence";
  if (
    transmissionConfirmed ||
    ((status === "under-review" || status === "submitted") && !savedEditable)
  ) {
    if (transmissionConfirmed && d.submitted_at) {
      return {
        label: t("disputes.dueSent", {
          date: formatDueDate(d.submitted_at, dateLocale),
        }),
        status: "closed",
      };
    }
    return { label: "—", status: "closed" };
  }
  if (!d.due_at) return { label: "—", status: "upcoming" };
  const hoursLeft = (new Date(d.due_at).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursLeft < 0) {
    return { label: formatDueDate(d.due_at, dateLocale), status: "past" };
  }
  if (hoursLeft <= 24) {
    return { label: t("disputes.dueToday"), status: "today" };
  }
  if (hoursLeft <= 48) {
    return { label: t("disputes.dueTomorrow"), status: "today" };
  }
  return { label: formatDueDate(d.due_at, dateLocale), status: "upcoming" };
}

/** Per-row CTA label keyed off (status, caseStrength). Same destination
 *  link in every case; the label is purely a prioritization signal. */
export function figmaNextAction(d: Dispute, t: Translate): string {
  const s = figmaStatus(d);
  const cs = figmaCaseStrength(d);
  if (s === "closed") return t("disputes.nextActionView");
  if (s === "under-review" || s === "submitted") {
    return t("disputes.nextActionWaiting");
  }
  if (s === "needs-review") return t("disputes.nextActionReview");
  // action-needed
  if (cs === "weak") return t("disputes.nextActionAddEvidence");
  return t("disputes.nextActionSubmitEvidence");
}

/** Boolean: due in <= 48h AND a GENUINE merchant task exists
 *  (attention blocking / requested / merchant-resolvable technical
 *  error). Deadline risk AMPLIFIES a required action — it never alarms
 *  on its own (plan §3.1/§5): a dispute DisputeDesk is handling
 *  autonomously is not "urgent" for the merchant regardless of its
 *  deadline. Drives the urgent banner + its count + the deep-link
 *  target, so all three share ONE definition. Legacy fallback for rows
 *  without a presentation keeps the old status heuristic. */
export function figmaIsUrgent(d: Dispute): boolean {
  if (!d.due_at) return false;
  const hoursLeft = (new Date(d.due_at).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursLeft > 48) return false;
  if (d.presentation) return d.presentation.needsMerchantAction;
  const s = figmaStatus(d);
  return s === "action-needed" || s === "needs-review";
}

/** Row chrome — left-edge stripe + bg tint + opacity. Three states
 *  per Figma `getRowClassName` (lines 72-83). */
export function figmaRowChrome(d: Dispute): {
  stripeColor: string | null;
  bgColor: string | null;
  opacity: number;
} {
  const due = figmaDueDate(d, (k) => k, "en-US"); // labels not needed here
  if (due.status === "past" || due.status === "today") {
    return { stripeColor: "#EF4444", bgColor: "#FEF2F2", opacity: 1 };
  }
  if (figmaStatus(d) === "action-needed") {
    return { stripeColor: "#F59E0B", bgColor: "#FFFBEB", opacity: 1 };
  }
  if (figmaStatus(d) === "closed") {
    return { stripeColor: null, bgColor: null, opacity: 0.6 };
  }
  return { stripeColor: null, bgColor: null, opacity: 1 };
}

/** Single-pass aggregation of every KPI the new header + banner need.
 *  `primaryCurrency` scopes the money sums to ONE currency so the banner
 *  never adds USD + EUR + GBP into a single figure it then labels with a
 *  single symbol (cross-currency raw sum — a real bug the KPIs elsewhere
 *  are careful to avoid). Rows in other currencies are excluded from the
 *  amounts (their COUNT still drives urgentCount). When null, the most-
 *  frequent currency among the disputes is used. */
export function figmaKpis(
  disputes: Dispute[],
  primaryCurrency?: string | null,
): {
  needsActionCount: number;
  urgentCount: number;
  urgentAmount: number;
  urgentAmountCurrency: string | null;
  totalAtRisk: number;
  strongCasesCount: number;
  awaitingResponseCount: number;
  earliestDueInDays: number | null;
  earliestOverdue: boolean;
} {
  // Resolve the primary currency: caller-supplied, else most-frequent.
  const primary =
    primaryCurrency ??
    (() => {
      const counts = new Map<string, number>();
      for (const d of disputes) {
        const c = d.currency_code ?? "USD";
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      let best: string | null = null;
      let bestN = -1;
      for (const [c, n] of counts) if (n > bestN) { best = c; bestN = n; }
      return best;
    })();

  let needsActionCount = 0;
  let urgentCount = 0;
  let urgentAmount = 0;
  let totalAtRisk = 0;
  let strongCasesCount = 0;
  let awaitingResponseCount = 0;
  let minHoursLeft: number | null = null;

  for (const d of disputes) {
    const s = figmaStatus(d);
    const cs = figmaCaseStrength(d);
    const isClosed = s === "closed";
    const isPrimaryCurrency = (d.currency_code ?? "USD") === primary;
    if (s === "action-needed" || s === "needs-review") needsActionCount += 1;
    if (cs === "strong" && (s === "action-needed" || s === "needs-review")) {
      strongCasesCount += 1;
    }
    if (s === "submitted" || s === "under-review") awaitingResponseCount += 1;
    // Money sums are primary-currency ONLY — never mix currencies.
    if (!isClosed && d.amount != null && isPrimaryCurrency) totalAtRisk += d.amount;
    if (figmaIsUrgent(d)) {
      urgentCount += 1;
      if (d.amount != null && isPrimaryCurrency) urgentAmount += d.amount;
      if (d.due_at) {
        const hoursLeft =
          (new Date(d.due_at).getTime() - Date.now()) / (1000 * 60 * 60);
        if (minHoursLeft === null || hoursLeft < minHoursLeft) {
          minHoursLeft = hoursLeft;
        }
      }
    }
  }

  // Overdue is reported as such (earliestOverdue), NOT clamped to
  // "due in 0 day(s)" — an overdue urgent dispute reading "0 days" looked
  // broken. Days is only meaningful for a future deadline.
  const earliestOverdue = minHoursLeft !== null && minHoursLeft < 0;
  const earliestDueInDays =
    minHoursLeft !== null && minHoursLeft >= 0
      ? Math.max(0, Math.ceil(minHoursLeft / 24))
      : null;

  return {
    needsActionCount,
    urgentCount,
    urgentAmount,
    urgentAmountCurrency: primary,
    totalAtRisk,
    strongCasesCount,
    awaitingResponseCount,
    earliestDueInDays,
    earliestOverdue,
  };
}
