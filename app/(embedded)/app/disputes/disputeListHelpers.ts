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
