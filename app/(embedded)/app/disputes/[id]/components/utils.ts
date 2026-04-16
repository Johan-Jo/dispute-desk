import type { useTranslations } from "next-intl";

/* ── Shared types for dispute detail tier components ── */

export interface Dispute {
  id: string;
  dispute_gid: string;
  dispute_evidence_gid: string | null;
  order_gid: string | null;
  status: string | null;
  reason: string | null;
  phase: string | null;
  family?: string;
  handling_mode?: string;
  amount: number | null;
  currency_code: string | null;
  initiated_at: string | null;
  due_at: string | null;
  last_synced_at: string | null;
  needs_review: boolean;
}

export interface ProfileAddress {
  name?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
}

export interface DisputeProfile {
  orderName: string | null;
  orderId: string | null;
  createdAt: string | null;
  total?: { amount: string; currencyCode: string } | null;
  customerName: string | null;
  email: string | null;
  phone: string | null;
  displayAddress: ProfileAddress | null;
  shippingAddress: ProfileAddress | null;
  billingAddress: ProfileAddress | null;
  fulfillments: Array<{
    id: string;
    status: string;
    trackingInfo: Array<{ number: string; url: string; company: string }>;
    createdAt: string;
  }>;
  orderEvents: Array<{
    id: string;
    createdAt: string;
    message: string;
    appTitle: string | null;
  }>;
}

export interface Pack {
  id: string;
  status: string;
  completeness_score: number | null;
  blockers: string[] | null;
  recommended_actions: string[] | null;
  saved_to_shopify_at: string | null;
  created_at: string;
}

export interface MatchedRule {
  name: string;
  mode: string;
}

/* ── Formatting helpers ── */

export function formatCurrency(
  amount: number | null,
  code: string | null,
): string {
  if (amount == null) return "\u2014";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code ?? "USD",
  }).format(amount);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatAddress(
  addr: ProfileAddress | null | undefined,
): string {
  if (!addr) return "\u2014";
  return (
    [addr.address1, addr.city, addr.province, addr.zip, addr.country]
      .filter(Boolean)
      .join(", ") ||
    addr.name ||
    "\u2014"
  );
}

export function statusTone(
  status: string | null,
): "success" | "warning" | "critical" | "info" | undefined {
  switch (status) {
    case "won":
      return "success";
    case "needs_response":
      return "warning";
    case "lost":
      return "critical";
    case "under_review":
      return "info";
    default:
      return undefined;
  }
}

export function statusLabel(
  status: string | null,
  t: ReturnType<typeof useTranslations>,
): string {
  switch (status) {
    case "needs_response":
      return t("disputes.statusNeedsResponse");
    case "under_review":
      return t("disputes.statusUnderReview");
    case "won":
      return t("disputes.statusWon");
    case "lost":
      return t("disputes.statusLost");
    default:
      return status?.replace(/_/g, " ") ?? t("status.unknown");
  }
}

export function packStatusTone(
  status: string,
): "success" | "warning" | "critical" | "info" | undefined {
  switch (status) {
    case "saved_to_shopify":
      return "success";
    case "ready":
      return "warning";
    case "blocked":
    case "failed":
      return "critical";
    case "building":
    case "queued":
      return "info";
    default:
      return undefined;
  }
}

export interface DeadlineInfo {
  text: string;
  urgent: boolean;
}

export function daysUntilInfo(
  iso: string | null,
  t: ReturnType<typeof useTranslations>,
): DeadlineInfo {
  if (!iso) return { text: "\u2014", urgent: false };
  const diff = Math.ceil(
    (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  if (diff < 0)
    return {
      text: t("disputes.daysOverdue", { count: Math.abs(diff) }),
      urgent: true,
    };
  if (diff === 0) return { text: t("disputes.dueToday"), urgent: true };
  return { text: t("disputes.daysRemaining", { count: diff }), urgent: diff <= 3 };
}
