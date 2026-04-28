import { DISPUTE_REASON_FAMILIES, type AllDisputeReasonCode } from "@/lib/rules/disputeReasons";

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
  } | null;
}

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
  const key = `disputeReasons.${reason}`;
  const translated = t(key);
  if (translated === key) {
    return reason.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return translated;
}

export function translateFamily(reason: string | null, t: Translate): string {
  const family = DISPUTE_REASON_FAMILIES[reason as AllDisputeReasonCode];
  if (!family) return "";
  const key = `disputeFamilies.${family}`;
  const translated = t(key);
  return translated === key ? family : translated;
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
  if (sortMode === "newest") return { sort: "created_at", sort_dir: "desc" };
  if (sortMode === "closed_desc") return { sort: "closed_at", sort_dir: "desc" };
  if (activeTab === "active") return { sort: "created_at", sort_dir: "desc" };
  if (activeTab === "closed") return { sort: "closed_at", sort_dir: "desc" };
  return { sort: "created_at", sort_dir: "desc" };
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
export type FigmaOutcome = "pending" | "won" | "lost";
export type FigmaDueStatus = "past" | "today" | "upcoming" | "closed";

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
  if (
    ns === "submitted" ||
    ns === "submitted_to_shopify" ||
    ns === "submitted_to_bank" ||
    ns === "waiting_on_issuer"
  ) {
    return "under-review";
  }
  if (ns === "needs_review" || d.needs_review) return "needs-review";
  // action_needed | new | in_progress | ready_to_submit | unknown → action-needed
  return "action-needed";
}

/** Map persisted case_strength.overall to the Figma 3-bucket pill.
 *  Returns null when no completed pack exists yet (UI renders em-dash). */
export function figmaCaseStrength(d: Dispute): FigmaCaseStrength | null {
  const o = d.caseStrength?.overall;
  if (!o) return null;
  if (o === "strong") return "strong";
  if (o === "moderate") return "moderate";
  return "weak"; // weak + insufficient
}

/** Compose the Figma strength subtitle ("2 strong signals", "1 strong
 *  + 2 moderate", "Insufficient evidence") from the persisted counts.
 *  Returns null when no pack — the UI shows nothing under the pill. */
export function figmaStrengthDetail(d: Dispute, t: Translate): string | null {
  const cs = d.caseStrength;
  if (!cs) return null;
  const { overall, strongCount, moderateCount } = cs;
  if (overall === "insufficient" || (strongCount === 0 && moderateCount === 0)) {
    return t("disputes.strengthDetailInsufficient");
  }
  if (strongCount > 0 && moderateCount === 0) {
    return t("disputes.strengthDetailSignals", { count: strongCount });
  }
  if (strongCount === 0 && moderateCount > 0) {
    return t("disputes.strengthDetailMixed", {
      strong: 0,
      moderate: moderateCount,
    });
  }
  return t("disputes.strengthDetailMixed", {
    strong: strongCount,
    moderate: moderateCount,
  });
}

/** Map final_outcome to the Figma 3-bucket outcome pill. Pre-decision
 *  rows render "Pending". */
export function figmaOutcome(d: Dispute): FigmaOutcome {
  const o = d.final_outcome;
  if (o === "won" || o === "partially_won") return "won";
  if (o === "lost" || o === "refunded" || o === "accepted") return "lost";
  return "pending";
}

/** Natural-language due-date label + status enum for the Figma row.
 *  Closed disputes show "Resolved" (with closed_at); under-review/
 *  submitted rows show "Submitted"; otherwise the relative-time logic
 *  from `formatDueTiming`. */
export function figmaDueDate(
  d: Dispute,
  t: Translate,
  dateLocale: string,
): { label: string; status: FigmaDueStatus } {
  const status = figmaStatus(d);
  if (status === "closed") {
    return { label: t("disputes.dueResolved"), status: "closed" };
  }
  if (status === "under-review" || status === "submitted") {
    return { label: t("disputes.dueSubmitted"), status: "closed" };
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

/** Boolean: due in <= 48h and not closed. Drives the urgent banner
 *  count + the row-edge red stripe. */
export function figmaIsUrgent(d: Dispute): boolean {
  if (figmaStatus(d) === "closed") return false;
  if (!d.due_at) return false;
  const hoursLeft = (new Date(d.due_at).getTime() - Date.now()) / (1000 * 60 * 60);
  return hoursLeft <= 48;
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

/** Single-pass aggregation of every KPI the new header + banner need. */
export function figmaKpis(disputes: Dispute[]): {
  needsActionCount: number;
  urgentCount: number;
  urgentAmount: number;
  totalAtRisk: number;
  strongCasesCount: number;
  awaitingResponseCount: number;
  earliestDueInDays: number | null;
} {
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
    if (s === "action-needed" || s === "needs-review") needsActionCount += 1;
    if (cs === "strong" && (s === "action-needed" || s === "needs-review")) {
      strongCasesCount += 1;
    }
    if (s === "submitted" || s === "under-review") awaitingResponseCount += 1;
    if (!isClosed && d.amount != null) totalAtRisk += d.amount;
    if (figmaIsUrgent(d)) {
      urgentCount += 1;
      if (d.amount != null) urgentAmount += d.amount;
      if (d.due_at) {
        const hoursLeft =
          (new Date(d.due_at).getTime() - Date.now()) / (1000 * 60 * 60);
        if (minHoursLeft === null || hoursLeft < minHoursLeft) {
          minHoursLeft = hoursLeft;
        }
      }
    }
  }

  const earliestDueInDays =
    minHoursLeft !== null
      ? Math.max(0, Math.ceil(minHoursLeft / 24))
      : null;

  return {
    needsActionCount,
    urgentCount,
    urgentAmount,
    totalAtRisk,
    strongCasesCount,
    awaitingResponseCount,
    earliestDueInDays,
  };
}
