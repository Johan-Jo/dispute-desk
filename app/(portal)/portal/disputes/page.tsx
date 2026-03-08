"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Search, Filter, RefreshCw, Loader2, ExternalLink } from "lucide-react";
import { useCompleteSetupStep } from "@/lib/setup/useCompleteSetupStep";
import { useActiveShopId } from "@/lib/portal/activeShopContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDemoMode, useDemoData } from "@/lib/demo-mode";
import { DemoNotice } from "@/components/ui/demo-notice";

interface Dispute {
  id: string;
  dispute_gid: string;
  order_gid: string | null;
  order_name: string | null;
  customer_display_name: string | null;
  status: string | null;
  reason: string | null;
  amount: number | null;
  currency_code: string | null;
  due_at: string | null;
  needs_review: boolean;
  last_synced_at: string | null;
}

const DEMO_DISPUTES = [
  { id: "DP-2401", dispute_gid: "DP-2401", order_gid: "#1234", status: "needs_response", reason: "fraudulent", amount: 145.00, currency_code: "USD", due_at: "2026-03-05", needs_review: false, last_synced_at: "2026-02-20", customer: "John Smith", email: "john@example.com" },
  { id: "DP-2402", dispute_gid: "DP-2402", order_gid: "#1235", status: "under_review", reason: "productNotReceived", amount: 89.50, currency_code: "USD", due_at: "2026-03-06", needs_review: true, last_synced_at: "2026-02-21", customer: "Sarah Johnson", email: "sarah@example.com" },
  { id: "DP-2403", dispute_gid: "DP-2403", order_gid: "#1236", status: "needs_response", reason: "productUnacceptable", amount: 234.00, currency_code: "USD", due_at: "2026-03-07", needs_review: false, last_synced_at: "2026-02-22", customer: "Mike Davis", email: "mike@example.com" },
  { id: "DP-2404", dispute_gid: "DP-2404", order_gid: "#1237", status: "won", reason: "creditNotProcessed", amount: 167.25, currency_code: "USD", due_at: "2026-03-08", needs_review: false, last_synced_at: "2026-02-23", customer: "Emma Wilson", email: "emma@example.com" },
  { id: "DP-2405", dispute_gid: "DP-2405", order_gid: "#1238", status: "under_review", reason: "fraudulent", amount: 299.99, currency_code: "USD", due_at: "2026-03-08", needs_review: true, last_synced_at: "2026-02-23", customer: "Alex Brown", email: "alex@example.com" },
  { id: "DP-2406", dispute_gid: "DP-2406", order_gid: "#1239", status: "lost", reason: "subscriptionCanceled", amount: 75.00, currency_code: "USD", due_at: "2026-03-09", needs_review: false, last_synced_at: "2026-02-24", customer: "Lisa Anderson", email: "lisa@example.com" },
];

const STATUS_VARIANTS: Record<string, "success" | "warning" | "danger" | "info" | "default"> = {
  saved_to_shopify: "success",
  needs_response: "warning",
  needs_review: "warning",
  under_review: "info",
  building: "info",
  blocked: "danger",
  ready: "info",
  won: "success",
  lost: "danger",
};

function isSyntheticDispute(disputeGid: string): boolean {
  return disputeGid?.includes("/seed-") ?? false;
}

/** Extract numeric ID from dispute GID (e.g. gid://shopify/ShopifyPaymentsDispute/123 -> 123). */
function disputeGidToShortId(disputeGid: string): string {
  if (!disputeGid) return "—";
  const last = disputeGid.split("/").pop();
  return last ?? disputeGid;
}

const STATUS_KEYS: Record<string, string> = {
  saved_to_shopify: "savedToShopify",
  needs_response: "needsResponse",
  needs_review: "needsReview",
  under_review: "underReview",
  building: "building",
  blocked: "blocked",
  ready: "readyToSave",
  won: "won",
  lost: "lost",
};

function formatCurrency(amount: number | null, code: string | null, locale: string): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code ?? "USD",
  }).format(amount);
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, { month: "short", day: "numeric" });
}

export default function DisputesPage() {
  useCompleteSetupStep("sync_disputes");
  const t = useTranslations("disputes");
  const tc = useTranslations("common");
  const tt = useTranslations("table");
  const ts = useTranslations("status");
  const tr = useTranslations("reasons");
  const locale = useLocale();
  const isDemo = useDemoMode();
  const useDemoDataForList = useDemoData();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncErrorCode, setSyncErrorCode] = useState<string | null>(null);
  const [syncErrorShopDomain, setSyncErrorShopDomain] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "review">("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  const shopId = useActiveShopId() ?? "";

  const fetchDisputes = useCallback(async () => {
    if (useDemoDataForList || !shopId) { setLoading(false); return; }
    setLoading(true);
    const params = new URLSearchParams({
      shop_id: shopId,
      page: String(page),
      per_page: "25",
    });
    if (tab === "review") params.set("needs_review", "true");
    const res = await fetch(`/api/disputes?${params}`);
    const json = await res.json();
    setDisputes(json.disputes ?? []);
    setTotalPages(json.pagination?.total_pages ?? 0);
    setLoading(false);
  }, [shopId, page, tab, useDemoDataForList]);

  useEffect(() => { fetchDisputes(); }, [fetchDisputes]);

  const handleSync = async () => {
    if (!shopId) return;
    setSyncing(true);
    setSyncError(null);
    setSyncErrorCode(null);
    setSyncErrorShopDomain(null);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/disputes/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncError(data?.error ?? `Sync failed (${res.status})`);
        setSyncErrorCode(data?.code ?? null);
        setSyncErrorShopDomain(data?.shop_domain ?? null);
        return;
      }
      const synced = data?.synced ?? 0;
      const syncErrors: string[] = data?.errors ?? [];
      const debug = data?.debug as { shop_domain?: string; first_page_edges?: number } | undefined;
      if (syncErrors.length > 0) {
        setSyncError(`Sync errors: ${syncErrors.join("; ")}`);
        return;
      }
      if (synced === 0) {
        const shopDomain = debug?.shop_domain;
        setSyncMessage(
          shopDomain
            ? `Sync complete. Shopify returned 0 disputes for this store (${shopDomain}). If you expect disputes, confirm the store above is correct and check Payments → Disputes in Shopify Admin.`
            : "Sync complete. No disputes in Shopify for this store."
        );
      } else {
        setSyncMessage(`Synced ${synced} dispute(s) from Shopify.`);
      }
      await fetchDisputes();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
      setSyncErrorCode(null);
      setSyncErrorShopDomain(null);
    } finally {
      setSyncing(false);
    }
  };

  const demoDisputes = DEMO_DISPUTES as (typeof DEMO_DISPUTES[number] & Dispute)[];
  const rows = useDemoDataForList ? demoDisputes : disputes;

  const filtered = search
    ? rows.filter(
        (d) =>
          (d.reason && tr.has(d.reason) ? tr(d.reason) : d.reason ?? "").toLowerCase().includes(search.toLowerCase()) ||
          d.dispute_gid.toLowerCase().includes(search.toLowerCase()) ||
          ("customer" in d && (d as { customer?: string }).customer?.toLowerCase().includes(search.toLowerCase())) ||
          d.customer_display_name?.toLowerCase().includes(search.toLowerCase()) ||
          d.order_name?.toLowerCase().includes(search.toLowerCase())
      )
    : rows;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">{t("title")}</h1>
          <p className="text-sm text-[#667085]">{t("manageSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {!isDemo && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleSync}
              disabled={syncing}
              aria-busy={syncing}
              className={syncing ? "cursor-wait" : undefined}
            >
              {syncing ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="w-4 h-4 mr-1" />
              )}
              {syncing ? t("syncing") : t("syncNow")}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            title={isDemo ? tc("demoOnly") : undefined}
            onClick={() => {
              if (isDemo) { alert(tc("demoOnly")); return; }
              window.open("https://admin.shopify.com/store/", "_blank");
            }}
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            {t("openInShopify")}
          </Button>
        </div>
      </div>

      {isDemo && <DemoNotice />}

      {syncError && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm space-y-2">
          <p>
            {syncErrorCode === "NO_OFFLINE_SESSION"
              ? "This store isn’t connected for syncing. Reconnect it so we can fetch disputes from Shopify."
              : syncError}
          </p>
          {syncErrorCode === "NO_OFFLINE_SESSION" && (
            <p>
              <a
                href={
                  syncErrorShopDomain
                    ? `/api/auth/shopify?shop=${encodeURIComponent(syncErrorShopDomain)}&source=portal&return_to=${encodeURIComponent("/portal/disputes")}`
                    : "/api/portal/clear-shop"
                }
                className="font-medium underline hover:no-underline"
              >
                {syncErrorShopDomain ? "Reconnect this store" : "Clear shop & reconnect"}
              </a>
            </p>
          )}
        </div>
      )}
      {syncMessage && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm">
          {syncMessage}
        </div>
      )}

      <div className="flex items-center gap-2 mb-4" data-onboarding="disputes-tabs">
        <Button
          variant={tab === "all" ? "primary" : "secondary"}
          size="sm"
          onClick={() => { setTab("all"); setPage(1); }}
        >
          {t("allDisputes")}
        </Button>
        <Button
          variant={tab === "review" ? "primary" : "secondary"}
          size="sm"
          onClick={() => { setTab("review"); setPage(1); }}
        >
          {t("reviewQueue")}
        </Button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-[50%] -translate-y-[50%] text-[#64748B]" />
          <input
            type="text"
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          title={isDemo ? tc("demoOnly") : undefined}
          onClick={() => { if (isDemo) alert(tc("demoOnly")); }}
        >
          <Filter className="w-4 h-4 mr-1" />
          {tc("filter")}
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden" data-onboarding="disputes-table">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#F7F8FA]">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">{tt("id")}</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">{tt("order")}</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">{tt("customer")}</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">{tt("amount")}</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">{tt("reason")}</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">{tt("status")}</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">{tt("deadline")}</th>
                <th className="text-right px-4 py-3 font-medium text-[#667085]">{tt("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {!isDemo && loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-[#667085]">
                    {tc("loading")}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-[#667085]">
                    <p className="mb-1">{t("noDisputes")}</p>
                    {!isDemo && shopId && (
                      <p className="text-xs mt-2 max-w-md mx-auto">{t("noDisputesHint")}</p>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map((d, idx) => (
                  <tr key={d.id} className="border-t border-[#E5E7EB] hover:bg-[#F7F8FA] transition-colors" {...(idx === 0 ? { "data-onboarding": "dispute-row" } : {})}>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <a
                          href={`/portal/disputes/${d.id}`}
                          className="font-medium text-[#4F46E5] hover:underline"
                          title={d.dispute_gid}
                        >
                          {isDemo ? d.dispute_gid : disputeGidToShortId(d.dispute_gid)}
                        </a>
                        {!isDemo && isSyntheticDispute(d.dispute_gid) && (
                          <Badge variant="info">Synthetic</Badge>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#0B1220]">
                      {d.order_name ?? (d.order_gid ? `#${d.order_gid.split("/").pop() ?? ""}` : "—")}
                    </td>
                    <td className="px-4 py-3">
                      {"customer" in d ? (
                        <div>
                          <div className="font-medium text-[#0B1220]">{(d as { customer?: string }).customer ?? "—"}</div>
                          <div className="text-xs text-[#667085]">{(d as { email?: string }).email ?? ""}</div>
                        </div>
                      ) : (
                        <span className="text-[#0B1220]">{d.customer_display_name ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-[#0B1220]">
                      {formatCurrency(d.amount, d.currency_code, locale)}
                    </td>
                    <td className="px-4 py-3 text-[#667085]">{d.reason ? tr.has(d.reason) ? tr(d.reason) : d.reason : ts("unknown")}</td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANTS[d.status ?? ""] ?? "default"}>
                        {ts(STATUS_KEYS[d.status ?? ""] ?? "unknown")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-[#667085]">{formatDate(d.due_at, locale)}</td>
                    <td className="px-4 py-3 text-right">
                      <a href={`/portal/disputes/${d.id}`}>
                        <Button variant="ghost" size="sm">{t("viewDetails")}</Button>
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!isDemo && totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 p-3 border-t border-[#E5E7EB]">
            <Button variant="ghost" size="sm" onClick={() => setPage(page - 1)} disabled={page <= 1}>
              {tc("previous")}
            </Button>
            <span className="text-sm text-[#667085]">{tc("page", { page, total: totalPages })}</span>
            <Button variant="ghost" size="sm" onClick={() => setPage(page + 1)} disabled={page >= totalPages}>
              {tc("next")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
