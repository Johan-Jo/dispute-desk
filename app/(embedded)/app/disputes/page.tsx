/**
 * Embedded disputes list — pixel-exact Figma match (shopify-disputes.tsx).
 * Separate header, actions-bar card, table card — no Polaris Page/Layout/Card wrappers.
 */
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { withShopParams } from "@/lib/withShopParams";
import { shopifyOrderAdminUrl } from "@/lib/embedded/shopifyOrderUrl";
import {
  ChoiceList,
  Popover,
  ActionList,
  Box,
  Spinner,
  Button,
} from "@shopify/polaris";
import { RefreshIcon, MenuHorizontalIcon } from "@shopify/polaris-icons";
import styles from "./disputes-list.module.css";

interface Dispute {
  id: string;
  dispute_gid: string;
  order_gid: string | null;
  order_name?: string | null;
  customer_display_name?: string | null;
  status: string | null;
  reason: string | null;
  amount: number | null;
  currency_code: string | null;
  due_at: string | null;
  needs_review: boolean;
  last_synced_at: string | null;
}

interface DisputesResponse {
  disputes: Dispute[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

function isSyntheticDispute(disputeGid: string): boolean {
  return disputeGid?.includes("/seed-") ?? false;
}

function formatReasonTitleCase(reason: string | null): string {
  if (!reason) return "—";
  return reason
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCurrency(
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

function formatListDisputeId(id: string): string {
  const hex = id.replace(/-/g, "").slice(0, 4).toUpperCase();
  return `DP-${hex}`;
}

function orderLabel(d: Dispute): string {
  return (
    d.order_name ?? (d.order_gid ? `#${String(d.order_gid).slice(-4)}` : "—")
  );
}

export default function DisputesListPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations();
  const locale = useLocale();

  const dateLocale = useMemo(() => {
    if (locale.startsWith("pt")) return "pt-BR";
    if (locale.startsWith("de")) return "de-DE";
    if (locale.startsWith("sv")) return "sv-SE";
    if (locale.startsWith("es")) return "es-ES";
    if (locale.startsWith("fr")) return "fr-FR";
    return "en-US";
  }, [locale]);

  const numberLocale = dateLocale;

  const formatDueDate = useCallback(
    (iso: string | null) => {
      if (!iso) return "—";
      return new Date(iso).toLocaleDateString(dateLocale, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    },
    [dateLocale],
  );

  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [queryValue, setQueryValue] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    total: 0,
    total_pages: 0,
  });
  const [filterPopoverActive, setFilterPopoverActive] = useState(false);
  const [moreMenuActive, setMoreMenuActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/billing/usage")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { shop_domain?: string | null }) => {
        if (!cancelled) setShopDomain(d.shop_domain ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: "25",
      });
      if (statusFilter.length > 0)
        params.set("status", statusFilter.join(","));
      const res = await fetch(`/api/disputes?${params}`);
      const json: DisputesResponse = await res.json();
      setDisputes(json.disputes ?? []);
      setPagination(json.pagination ?? { total: 0, total_pages: 0 });
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  const handleSync = async () => {
    setSyncing(true);
    await fetch("/api/disputes/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await fetchDisputes();
    setSyncing(false);
  };

  const goToDispute = useCallback(
    (id: string) => {
      router.push(withShopParams(`/app/disputes/${id}`, searchParams));
    },
    [router, searchParams],
  );

  const statusLabelForCsv = (status: string | null): string => {
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
  };

  const badgeClass = (status: string | null): string => {
    switch (status) {
      case "needs_response":
        return styles.badgeOpen;
      case "under_review":
        return styles.badgeReview;
      case "charge_refunded":
      case "won":
        return styles.badgeWon;
      case "lost":
        return styles.badgeLost;
      default:
        return styles.badgeOpen;
    }
  };

  const badgeLabel = (status: string | null): string => {
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
  };

  const visibleDisputes = queryValue
    ? disputes.filter((d) => {
        const q = queryValue.toLowerCase();
        const dp = formatListDisputeId(d.id).toLowerCase();
        return (
          d.dispute_gid.toLowerCase().includes(q) ||
          d.id.toLowerCase().includes(q) ||
          dp.includes(q) ||
          (d.reason ?? "").toLowerCase().includes(q) ||
          (d.order_gid ?? "").toLowerCase().includes(q) ||
          (d.order_name ?? "").toLowerCase().includes(q) ||
          (d.customer_display_name ?? "").toLowerCase().includes(q)
        );
      })
    : disputes;

  const exportCsv = () => {
    const rows = visibleDisputes.map((d) =>
      [
        formatListDisputeId(d.id),
        orderLabel(d),
        formatReasonTitleCase(d.reason),
        formatCurrency(d.amount, d.currency_code, numberLocale),
        statusLabelForCsv(d.status),
        formatDueDate(d.due_at),
      ].join(","),
    );
    const csv = [
      "Dispute ID,Order,Reason,Amount,Status,Due date",
      ...rows,
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    a.download = "disputes.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const filterActivator = (
    <button
      className={styles.actionBtn}
      onClick={() => setFilterPopoverActive((v) => !v)}
    >
      <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M3 4h14M5 8h10M7 12h6M9 16h2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      {t("common.filter")}
    </button>
  );

  const moreMenuActivator = (
    <Button
      variant="secondary"
      icon={MenuHorizontalIcon}
      onClick={() => setMoreMenuActive((a) => !a)}
      accessibilityLabel={t("disputes.moreActions")}
    />
  );

  return (
    <>
      {/* Set Shopify Admin title bar (rendered outside iframe by App Bridge) */}
      <s-page heading={t("disputes.title")} />

      {/* Header — Figma line 22 */}
      <div className={styles.headerSection}>
        <h1 className={styles.pageTitle}>{t("disputes.title")}</h1>
        <p className={styles.pageSubtitle}>{t("disputes.manageSubtitle")}</p>
      </div>

      {/* Actions bar — Figma line 30 */}
      <div className={styles.actionsBar}>
        <div className={styles.searchWrap}>
          <svg
            className={styles.searchIcon}
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.45 4.39l3.08 3.08a.75.75 0 11-1.06 1.06l-3.08-3.08A7 7 0 012 9z"
              fill="currentColor"
            />
          </svg>
          <input
            type="text"
            className={styles.searchInput}
            placeholder={t("disputes.searchPlaceholder")}
            value={queryValue}
            onChange={(e) => setQueryValue(e.target.value)}
          />
        </div>

        <Popover
          active={filterPopoverActive}
          activator={filterActivator}
          onClose={() => setFilterPopoverActive(false)}
          autofocusTarget="none"
        >
          <Box padding="400" minWidth="240px">
            <ChoiceList
              title={t("table.status")}
              titleHidden
              choices={[
                {
                  label: t("status.needsResponse"),
                  value: "needs_response",
                },
                {
                  label: t("status.underReview"),
                  value: "under_review",
                },
                { label: t("status.won"), value: "won" },
                { label: t("status.lost"), value: "lost" },
              ]}
              selected={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              allowMultiple
            />
          </Box>
        </Popover>

        <button className={styles.actionBtn} onClick={exportCsv}>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M3 14v2a1 1 0 001 1h12a1 1 0 001-1v-2M10 3v10M6 10l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t("disputes.export")}
        </button>

        <Popover
          active={moreMenuActive}
          activator={moreMenuActivator}
          onClose={() => setMoreMenuActive(false)}
          preferredAlignment="right"
          autofocusTarget="first-node"
        >
          <ActionList
            actionRole="menuitem"
            items={[
              {
                content: syncing
                  ? t("disputes.syncing")
                  : t("disputes.syncNow"),
                icon: RefreshIcon,
                disabled: syncing,
                onAction: () => {
                  setMoreMenuActive(false);
                  void handleSync();
                },
              },
            ]}
          />
        </Popover>
      </div>

      {/* Table card — Figma line 54 */}
      <div className={styles.tableCard}>
        {loading ? (
          <div className={styles.loadingWrap}>
            <Spinner size="large" />
          </div>
        ) : visibleDisputes.length === 0 ? (
          <div className={styles.emptyState}>
            {disputes.length === 0
              ? t("disputes.noDisputes")
              : t("disputes.noMatchingDisputes")}
          </div>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.listTable}>
              <thead>
                <tr>
                  <th>{t("table.disputeId")}</th>
                  <th>{t("table.order")}</th>
                  <th>{t("table.reason")}</th>
                  <th>{t("table.amount")}</th>
                  <th>{t("table.status")}</th>
                  <th>{t("table.dueDateColumn")}</th>
                  <th className={styles.chevronCol} aria-hidden />
                </tr>
              </thead>
              <tbody>
                {visibleDisputes.map((d) => {
                  const orderUrl = shopifyOrderAdminUrl(
                    shopDomain,
                    d.order_gid,
                  );
                  const label = orderLabel(d);
                  return (
                    <tr
                      key={d.id}
                      role="link"
                      tabIndex={0}
                      aria-label={t("disputes.viewDetails")}
                      style={{ cursor: "pointer" }}
                      onClick={() => goToDispute(d.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          goToDispute(d.id);
                        }
                      }}
                    >
                      <td>
                        <span className={styles.cellId}>
                          {formatListDisputeId(d.id)}
                        </span>
                        {isSyntheticDispute(d.dispute_gid) && (
                          <span className={styles.syntheticBadge}>
                            Synthetic
                          </span>
                        )}
                      </td>
                      <td>
                        {orderUrl ? (
                          <a
                            href={orderUrl}
                            target="_top"
                            rel="noopener noreferrer"
                            className={styles.cellOrder}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            {label}
                          </a>
                        ) : (
                          <span className={styles.cellId}>{label}</span>
                        )}
                      </td>
                      <td>
                        <span className={styles.cellMuted}>
                          {formatReasonTitleCase(d.reason)}
                        </span>
                      </td>
                      <td>
                        <span className={styles.cellAmount}>
                          {formatCurrency(
                            d.amount,
                            d.currency_code,
                            numberLocale,
                          )}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`${styles.badge} ${badgeClass(d.status)}`}
                        >
                          {badgeLabel(d.status)}
                        </span>
                      </td>
                      <td>
                        <span className={styles.cellMuted}>
                          {formatDueDate(d.due_at)}
                        </span>
                      </td>
                      <td className={styles.chevronCol}>
                        <span className={styles.chevronBtn}>
                          <svg
                            viewBox="0 0 20 20"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M7.5 4.5l5.5 5.5-5.5 5.5"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination.total_pages > 1 && (
        <div className={styles.paginationWrap}>
          <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t("common.previous")}
          </Button>
          <span className={styles.paginationText}>
            {t("common.page", { page, total: pagination.total_pages })}
          </span>
          <Button
            disabled={page >= pagination.total_pages}
            onClick={() => setPage(page + 1)}
          >
            {t("common.next")}
          </Button>
        </div>
      )}
    </>
  );
}
