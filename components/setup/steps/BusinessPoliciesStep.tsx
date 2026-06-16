"use client";

import { useEffect, useState, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CheckCircle2,
  AlertCircle,
  MinusCircle,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Truck,
  Undo2,
  Lock,
  ScrollText,
  FileText,
  Store,
  Info,
} from "lucide-react";
import { redirectTopLevel } from "@/lib/shopify/redirectTopLevel";
import type { StepId } from "@/lib/setup/types";

type PolicyKey = "refunds" | "shipping" | "privacy" | "terms";

/** The 4 core policies, in the design's row order. */
const POLICY_ORDER: PolicyKey[] = ["refunds", "shipping", "privacy", "terms"];

const POLICY_ICON: Record<PolicyKey, typeof Truck> = {
  refunds: Undo2,
  shipping: Truck,
  privacy: Lock,
  terms: ScrollText,
};

/** Required policies are the two banks ask for most (shipping + refunds). */
const REQUIRED: Record<PolicyKey, boolean> = {
  refunds: true,
  shipping: true,
  privacy: false,
  terms: false,
};

interface BusinessPoliciesStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

interface PolicyRow {
  policy_type: string;
  source: string;
  published_url: string | null;
  captured_at: string | null;
}

/** Localized "x ago" via Intl.RelativeTimeFormat — no hardcoded English. */
function relativeTime(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const diffSec = Math.round((then - Date.now()) / 1000); // negative = past
  const mins = Math.round(diffSec / 60);
  if (mins > -1) return rtf.format(0, "minute"); // "now"
  if (mins > -60) return rtf.format(mins, "minute");
  const hrs = Math.round(mins / 60);
  if (hrs > -24) return rtf.format(hrs, "hour");
  return rtf.format(Math.round(hrs / 24), "day");
}

export function BusinessPoliciesStep({ stepId, onSaveRef }: BusinessPoliciesStepProps) {
  const t = useTranslations("setup.policies");
  const locale = useLocale();

  // Onboarding renders the condensed variant; the standalone Policies page
  // renders the full one. Detected from the URL so the generic step-component
  // map in app/(embedded)/app/setup/[step]/page.tsx needs no prop plumbing.
  const [isOnboarding, setIsOnboarding] = useState(false);
  useEffect(() => {
    setIsOnboarding(window.location.pathname.includes("/setup"));
  }, []);

  const [resolvedShopId, setResolvedShopId] = useState<string | null>(null);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<PolicyKey, PolicyRow | null>>({
    refunds: null,
    shipping: null,
    privacy: null,
    terms: null,
  });
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<PolicyKey | null>(null);

  const applyPolicies = useCallback((policies: PolicyRow[]) => {
    const next: Record<PolicyKey, PolicyRow | null> = {
      refunds: null,
      shipping: null,
      privacy: null,
      terms: null,
    };
    for (const p of policies) {
      if ((POLICY_ORDER as string[]).includes(p.policy_type)) {
        next[p.policy_type as PolicyKey] = p;
      }
    }
    setRows(next);
  }, []);

  const loadPolicies = useCallback(
    async (shopId: string) => {
      const r = await fetch(`/api/policies?shop_id=${shopId}`);
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data?.policies)) applyPolicies(data.policies);
    },
    [applyPolicies],
  );

  const refresh = useCallback(async () => {
    if (!resolvedShopId || refreshing) return;
    setRefreshing(true);
    try {
      await fetch("/api/policies/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: resolvedShopId }),
      });
      await loadPolicies(resolvedShopId);
      setLastSynced(new Date().toISOString());
    } catch {
      /* graceful — keep current state */
    } finally {
      setRefreshing(false);
    }
  }, [resolvedShopId, refreshing, loadPolicies]);

  // Initial load: resolve the shop, auto-sync from Shopify on mount, then read.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/setup/state")
      .then((r) => (r.ok ? r.json() : null))
      .then(async (data) => {
        if (cancelled || !data?.shopId) return;
        setResolvedShopId(data.shopId);
        try {
          await fetch("/api/policies/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shop_id: data.shopId }),
          });
        } catch {
          /* refresh is best-effort; fall through to read whatever exists */
        }
        if (cancelled) return;
        await loadPolicies(data.shopId);
        if (!cancelled) setLastSynced(new Date().toISOString());

        fetch(`/api/shop/details?shop_id=${data.shopId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((details) => {
            if (cancelled || !details?.primaryDomain) return;
            setShopDomain(
              details.primaryDomain.replace(/^https?:\/\//, "").replace(/\/$/, ""),
            );
          })
          .catch(() => {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loadPolicies]);

  // Nothing to persist — this surface is a read-only status view whose only
  // actions forward to Shopify. The save callback marks the step reviewed so
  // the wizard "Save & Continue" / page "Save" buttons resolve cleanly. The
  // policies step never blocks onboarding (merchants can finish later).
  useEffect(() => {
    onSaveRef.current = async () => {
      try {
        const res = await fetch("/api/setup/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepId, payload: { reviewed: true } }),
        });
        return res.ok;
      } catch {
        return false;
      }
    };
  }, [stepId, onSaveRef]);

  // Open Shopify's policy editor (the only place a policy becomes valid
  // evidence). MUST be an ABSOLUTE admin URL via redirectTopLevel — a
  // relative path resolves against this app's origin (→ 404), and
  // window.open(_blank) of an absolute admin URL gets doubled by App Bridge.
  // Correct path is /settings/legal (confirmed against a live store).
  const openShopifyPolicyEditor = useCallback(() => {
    let handle: string | null = null;
    const host = new URLSearchParams(window.location.search).get("host");
    if (host) {
      try {
        handle = atob(host).split("/store/")[1]?.split(/[/?#]/)[0] ?? null;
      } catch {
        /* malformed host */
      }
    }
    if (!handle) {
      const raw =
        document.cookie.match(/shopify_shop=([^;]+)/)?.[1] ??
        new URLSearchParams(window.location.search).get("shop");
      const domain = raw ? decodeURIComponent(raw) : null;
      handle = domain
        ? domain.replace(/^https?:\/\//, "").replace(".myshopify.com", "")
        : null;
    }
    if (!handle) return;
    redirectTopLevel(`https://admin.shopify.com/store/${handle}/settings/legal`);
  }, []);

  const liveCount = POLICY_ORDER.filter(
    (k) => rows[k]?.source === "shopify_published",
  ).length;
  const total = POLICY_ORDER.length;
  const pct = Math.round((liveCount / total) * 100);
  const displayDomain = shopDomain ?? t("yourStore");
  const syncedLabel = relativeTime(lastSynced, locale);

  const meta = (k: PolicyKey) => ({
    title: t(`row.${k}.title`),
    desc: t(`row.${k}.desc`),
  });

  // ── Condensed onboarding variant ──────────────────────────────────────
  if (isOnboarding) {
    return (
      <div className="max-w-[600px] mx-auto">
        <div className="flex flex-col items-center text-center mb-[22px]">
          <span className="inline-flex items-center justify-center w-[54px] h-[54px] rounded-[13px] bg-[#D89A2B] text-white mb-[14px]">
            <FileText className="w-6 h-6" />
          </span>
          <h2 className="text-[#202223] mb-1.5" style={{ fontWeight: 700, fontSize: 22 }}>
            {t("onboardingTitle")}
          </h2>
          <p className="text-[#6D7175] max-w-[420px]" style={{ fontSize: 14, lineHeight: 1.55 }}>
            {t.rich("onboardingSubtitle", {
              store: () => <strong className="text-[#43474A]">{displayDomain}</strong>,
            })}
          </p>
        </div>

        {/* status band */}
        <div className="bg-[#F8F8F9] border border-[#ECEDEE] rounded-[11px] px-[18px] py-4 mb-4">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[#202223]" style={{ fontWeight: 700, fontSize: 14 }}>
              {t("liveOfTotal", { live: liveCount, total })}
            </span>
            <span className="text-[#8C9196]" style={{ fontSize: 12 }}>
              {refreshing ? t("syncing") : syncedLabel ? t("syncedAgo", { time: syncedLabel }) : ""}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[#E7E8EA] overflow-hidden">
            <div className="h-full bg-[#1D4ED8] rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* compact list */}
        <div className="flex flex-col gap-2 mb-[18px]">
          {POLICY_ORDER.map((k) => {
            const Icon = POLICY_ICON[k];
            const isLive = rows[k]?.source === "shopify_published";
            const required = REQUIRED[k];
            return (
              <div
                key={k}
                className={`flex items-center gap-[11px] px-[14px] py-[11px] rounded-[9px] border ${
                  !isLive && required ? "border-[#FBE6C8] bg-[#FFFCF7]" : "border-[#EDEEEF]"
                }`}
              >
                <span
                  className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-[7px]"
                  style={{
                    background: isLive ? "#FBF1DF" : required ? "#FBEEDD" : "#F1F2F4",
                    color: isLive ? "#B5821C" : required ? "#C2791B" : "#8C9196",
                  }}
                >
                  <Icon className="w-[15px] h-[15px]" />
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-[#202223]" style={{ fontSize: 13.5, fontWeight: 500 }}>
                    {meta(k).title}
                  </span>
                  {!isLive && required && (
                    <span
                      className="ml-1.5 text-[#B45309] bg-[#FBEAD3] px-1.5 rounded-[5px]"
                      style={{ fontSize: 10.5, fontWeight: 600 }}
                    >
                      {t("required")}
                    </span>
                  )}
                </div>
                {isLive ? (
                  <span className="inline-flex items-center gap-1.5 text-[#15803D]" style={{ fontSize: 12, fontWeight: 600 }}>
                    <CheckCircle2 className="w-4 h-4" />
                    {t("live")}
                  </span>
                ) : required ? (
                  <span className="inline-flex items-center gap-1.5 text-[#B45309]" style={{ fontSize: 12, fontWeight: 600 }}>
                    <AlertCircle className="w-4 h-4" />
                    {t("notPublished")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[#8C9196]" style={{ fontSize: 12, fontWeight: 600 }}>
                    <MinusCircle className="w-4 h-4" />
                    {t("notPublished")}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* actions */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={openShopifyPolicyEditor}
            className="inline-flex items-center justify-center gap-1.5 flex-1 py-3 bg-[#1D4ED8] hover:bg-[#1e40af] border-none rounded-[9px] text-white transition-colors"
            style={{ fontSize: 14, fontWeight: 600 }}
          >
            <ExternalLink className="w-4 h-4" />
            {t("publishMissing")}
          </button>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing || !resolvedShopId}
            className="inline-flex items-center gap-1.5 px-[18px] py-3 bg-white border border-[#DADCE0] rounded-[9px] text-[#43474A] hover:bg-[#F7F8FA] disabled:opacity-50 transition-colors"
            style={{ fontSize: 14, fontWeight: 600 }}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            {t("refreshFromStore")}
          </button>
        </div>
        <p className="mt-3.5 text-center text-[#A4A8AB]" style={{ fontSize: 12 }}>
          {t.rich("onboardingFooter", {
            strong: (c) => <strong className="text-[#8C9196]">{c}</strong>,
          })}
        </p>
      </div>
    );
  }

  // ── Full Policies page variant ────────────────────────────────────────
  return (
    <div className="max-w-[740px] mx-auto">
      {/* Summary / sync card */}
      <div className="bg-white border border-[#E1E3E5] rounded-[12px] px-[22px] py-5 mb-4" style={{ boxShadow: "0 1px 2px rgba(13,16,20,0.04)" }}>
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-[#F1F1F2]">
          <div className="flex items-center gap-[11px]">
            <span className="inline-flex items-center justify-center w-[38px] h-[38px] rounded-[9px] bg-[#F0FDF4] text-[#16A34A]">
              <Store className="w-[19px] h-[19px]" />
            </span>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[#202223]" style={{ fontSize: 14, fontWeight: 600 }}>{displayDomain}</span>
                <span className="inline-flex items-center gap-1 text-[#15803D]" style={{ fontSize: 12, fontWeight: 600 }}>
                  <span className="w-[7px] h-[7px] rounded-full bg-[#22C55E]" />
                  {t("connected")}
                </span>
              </div>
              <span className="text-[#8C9196]" style={{ fontSize: 12.5 }}>
                {refreshing ? t("syncing") : syncedLabel ? t("lastSynced", { time: syncedLabel }) : t("notSyncedYet")}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing || !resolvedShopId}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-[#DADCE0] bg-white rounded-[8px] text-[#43474A] hover:bg-[#F7F8FA] disabled:opacity-50 transition-colors"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {t("refreshFromStore")}
          </button>
        </div>

        <div className="pt-4">
          <h2 className="text-[#202223] mb-1.5" style={{ fontSize: 18, fontWeight: 700 }}>
            {t("liveSummaryTitle", { live: liveCount, total })}
          </h2>
          <p className="text-[#6D7175] max-w-[560px] mb-3.5" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            {t.rich("liveSummaryDesc", {
              strong: (c) => <strong className="text-[#43474A]">{c}</strong>,
            })}
          </p>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-[#EDEEEF] overflow-hidden max-w-[380px]">
              <div className="h-full bg-[#1D4ED8] rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[#6D7175]" style={{ fontSize: 12.5, fontWeight: 600 }}>
              {t("liveOfTotalShort", { live: liveCount, total })}
            </span>
          </div>
        </div>
      </div>

      {/* Policy status list */}
      <div className="bg-white border border-[#E1E3E5] rounded-[12px] overflow-hidden" style={{ boxShadow: "0 1px 2px rgba(13,16,20,0.04)" }}>
        <div className="flex items-center justify-between px-[22px] py-3.5 border-b border-[#F1F1F2]">
          <span className="text-[#202223]" style={{ fontSize: 13, fontWeight: 700 }}>{t("storePolicies")}</span>
          <span className="text-[#8C9196]" style={{ fontSize: 12 }}>{t("capturedFromShopify")}</span>
        </div>

        {POLICY_ORDER.map((k, i) => {
          const Icon = POLICY_ICON[k];
          const row = rows[k];
          const isLive = row?.source === "shopify_published";
          const required = REQUIRED[k];
          const last = i === POLICY_ORDER.length - 1;
          const isExpanded = expanded === k;
          return (
            <div key={k}>
              <div
                className={`flex items-center justify-between gap-4 px-[22px] py-[18px] ${last && !isExpanded ? "" : "border-b border-[#F4F4F5]"}`}
                style={!isLive && required ? { background: "#FEFBF6" } : undefined}
              >
                <div className="flex items-start gap-[13px] min-w-0">
                  <span
                    className="inline-flex items-center justify-center w-10 h-10 rounded-[9px] flex-shrink-0"
                    style={{
                      background: isLive ? "#FBF1DF" : required ? "#FBEEDD" : "#F1F2F4",
                      color: isLive ? "#B5821C" : required ? "#C2791B" : "#8C9196",
                    }}
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[#202223]" style={{ fontSize: 14.5, fontWeight: 600 }}>{meta(k).title}</span>
                      <span className="text-[#6D7175] bg-[#F1F2F4] px-[7px] rounded-[5px]" style={{ fontSize: 11, fontWeight: 600 }}>
                        {required ? t("required") : t("optional")}
                      </span>
                    </div>
                    <p className="text-[#8C9196] m-0" style={{ fontSize: 12.5 }}>{meta(k).desc}</p>
                    {isLive && row?.published_url && (
                      <a
                        href={row.published_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[#1D4ED8] mt-1.5 no-underline hover:underline"
                        style={{ fontSize: 12.5, fontWeight: 500 }}
                      >
                        {row.published_url.replace(/^https?:\/\//, "")}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3.5 flex-shrink-0">
                  {isLive ? (
                    <>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E7F6EC] text-[#15803D]" style={{ fontSize: 12, fontWeight: 600 }}>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {t("liveOnStore")}
                      </span>
                      <ChevronRight className="w-[15px] h-[15px] text-[#B5B8BB]" />
                    </>
                  ) : (
                    <>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FBEFE2] text-[#B45309]" style={{ fontSize: 12, fontWeight: 600 }}>
                        <AlertCircle className="w-3.5 h-3.5" />
                        {t("notPublished")}
                      </span>
                      <button
                        type="button"
                        onClick={() => setExpanded(isExpanded ? null : k)}
                        className={`inline-flex items-center gap-1.5 px-[13px] py-2 rounded-[8px] transition-colors ${
                          required
                            ? "bg-[#1D4ED8] hover:bg-[#1e40af] border-none text-white"
                            : "bg-white border border-[#1D4ED8] text-[#1D4ED8] hover:bg-[#EFF6FF]"
                        }`}
                        style={{ fontSize: 13, fontWeight: 600 }}
                      >
                        {required && <ExternalLink className="w-3.5 h-3.5" />}
                        {t("publishInShopify")}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Expanded publish flow (forward-to-Shopify only) */}
              {isExpanded && !isLive && (
                <div className={`bg-[#FAFAFB] ${last ? "" : "border-b border-[#F4F4F5]"}`}>
                  <div className="flex items-center gap-0 px-[22px] py-4 border-b border-[#F1F1F2]">
                    <div className="flex items-center gap-2">
                      <span className="w-[22px] h-[22px] rounded-full bg-[#1D4ED8] text-white flex items-center justify-center" style={{ fontSize: 12, fontWeight: 700 }}>1</span>
                      <span className="text-[#202223]" style={{ fontSize: 12.5, fontWeight: 600 }}>{t("step1")}</span>
                    </div>
                    <div className="flex-1 h-px bg-[#E1E3E5] mx-4" />
                    <div className="flex items-center gap-2">
                      <span className="w-[22px] h-[22px] rounded-full bg-white text-[#8C9196] flex items-center justify-center" style={{ fontSize: 12, fontWeight: 700, border: "1.5px solid #C9CCCF" }}>2</span>
                      <span className="text-[#8C9196]" style={{ fontSize: 12.5, fontWeight: 500 }}>{t("step2")}</span>
                    </div>
                  </div>
                  <div className="px-[22px] py-5">
                    <p className="text-[#43474A] max-w-[560px] mb-4" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                      {t("publishFlowBody")}
                    </p>
                    <button
                      type="button"
                      onClick={openShopifyPolicyEditor}
                      className="inline-flex items-center gap-1.5 px-[18px] py-2.5 bg-[#1D4ED8] hover:bg-[#1e40af] border-none rounded-[8px] text-white transition-colors"
                      style={{ fontSize: 14, fontWeight: 600 }}
                    >
                      <ExternalLink className="w-4 h-4" />
                      {t("openShopifyEditor")}
                    </button>
                  </div>
                  <div className="flex items-start gap-2.5 px-[22px] py-3 bg-[#FFF8EE] border-t border-[#FBE6C8]">
                    <RefreshCw className="w-[15px] h-[15px] text-[#B45309] mt-0.5" />
                    <p className="text-[#92591A] m-0" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                      {t.rich("publishFlowNote", {
                        strong: (c) => <strong>{c}</strong>,
                      })}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      <div className="flex items-start gap-2.5 mt-3.5 px-4 py-3.5 border border-[#EDEEEF] rounded-[10px] bg-[#FAFAFB]">
        <Info className="w-[17px] h-[17px] text-[#8C9196] mt-0.5" />
        <p className="text-[#6D7175] m-0" style={{ fontSize: 12.5, lineHeight: 1.55 }}>{t("footerNote")}</p>
      </div>
    </div>
  );
}
