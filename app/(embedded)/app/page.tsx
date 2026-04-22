"use client";

import { Suspense, useEffect, useState } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Spinner,
} from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { SetupStateResponse } from "@/lib/setup/types";
import { withShopParams } from "@/lib/withShopParams";
import { useSearchParams, useRouter } from "next/navigation";
import {
  DEFAULT_STATS,
  type DashboardStats,
  type PeriodKey,
} from "./dashboardHelpers";
import { DashboardSummaryRow } from "./DashboardSummaryRow";
import { DashboardNeedsAttentionTable } from "./DashboardNeedsAttentionTable";
import { DashboardInProgressTable } from "./DashboardInProgressTable";
import { DashboardKpis } from "./DashboardKpis";
import { DashboardCategories } from "./DashboardCategories";
import { DashboardHelpCard } from "./DashboardHelpCard";

export default function EmbeddedDashboardPage() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [statsLoading, setStatsLoading] = useState(true);
  const [setupDone, setSetupDone] = useState<boolean | null>(null);
  const [redirecting, setRedirecting] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return new URL(window.location.href).searchParams.has("ddredirect");
  });

  useEffect(() => {
    const raw = searchParams.get("ddredirect");
    if (!raw) return;
    let target: string;
    try {
      target = decodeURIComponent(raw);
    } catch {
      target = raw;
    }
    if (!target.startsWith("/") || target.startsWith("//")) {
      setRedirecting(false);
      return;
    }
    const prefix =
      target.startsWith("/app/") || target === "/app" ? "" : "/app";
    const full = `${prefix}${target}`;
    const carry = new URLSearchParams();
    for (const key of ["host", "shop", "embedded", "locale", "id_token"]) {
      const v = searchParams.get(key);
      if (v) carry.set(key, v);
    }
    const sep = full.includes("?") ? "&" : "?";
    const qs = carry.toString();
    const next = qs ? `${full}${sep}${qs}` : full;
    router.replace(next);
  }, [router, searchParams]);

  useEffect(() => {
    if (redirecting) return;
    let cancelled = false;
    fetch("/api/setup/state")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SetupStateResponse | null) => {
        if (cancelled) return;
        if (!data || data.allDone) {
          setSetupDone(true);
        } else {
          router.replace(
            withShopParams(
              "/app/setup",
              searchParams ?? new URLSearchParams(),
            ),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router, searchParams, redirecting]);

  useEffect(() => {
    if (!setupDone) return;
    let cancelled = false;
    setStatsLoading(true);
    fetch(`/api/dashboard/stats?period=${period}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setStats(data);
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, setupDone]);

  if (redirecting || !setupDone) {
    return (
      <Page title="DisputeDesk">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="small" />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  // Derive counts for conditional section logic
  const ob = stats.operationalBreakdown;
  const actionNeededCount =
    (ob["new"] ?? 0) + (ob["action_needed"] ?? 0) + (ob["needs_review"] ?? 0);
  const inProgressCount =
    (ob["in_progress"] ?? 0) +
    (ob["ready_to_submit"] ?? 0) +
    (ob["submitted"] ?? 0) +
    (ob["submitted_to_shopify"] ?? 0) +
    (ob["waiting_on_issuer"] ?? 0) +
    (ob["submitted_to_bank"] ?? 0);

  return (
    <Page
      title={t("dashboard.pageTitle")}
      subtitle={t("dashboard.pageSubtitle")}
      secondaryActions={[
        {
          content: t("nav.help"),
          url: withShopParams(
            "/app/help",
            searchParams ?? new URLSearchParams(),
          ),
        },
      ]}
    >
      <Layout>
        {/* 1. Summary row — 4 tiles */}
        <Layout.Section>
          <DashboardSummaryRow stats={stats} loading={statsLoading} />
        </Layout.Section>

        {/* 3. Primary section — conditional */}
        {actionNeededCount > 0 && (
          <Layout.Section>
            <Suspense
              fallback={
                <Card>
                  <BlockStack gap="400" inlineAlign="center">
                    <Spinner size="small" />
                  </BlockStack>
                </Card>
              }
            >
              <DashboardNeedsAttentionTable />
            </Suspense>
          </Layout.Section>
        )}

        {/* 4. In Progress section */}
        {inProgressCount > 0 ? (
          <Layout.Section>
            <Suspense
              fallback={
                <Card>
                  <BlockStack gap="400" inlineAlign="center">
                    <Spinner size="small" />
                  </BlockStack>
                </Card>
              }
            >
              <DashboardInProgressTable />
            </Suspense>
          </Layout.Section>
        ) : !statsLoading && actionNeededCount === 0 ? (
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  {t("dashboard.noActiveDisputes")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("dashboard.noActiveDisputesDesc")}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        ) : null}

        {/* 5. Performance overview — secondary, compact */}
        <Layout.Section>
          <DashboardKpis
            stats={stats}
            loading={statsLoading}
            period={period}
            onPeriodChange={setPeriod}
          />
        </Layout.Section>

        {/* 6. Dispute categories */}
        <Layout.Section>
          <DashboardCategories stats={stats} loading={statsLoading} />
        </Layout.Section>

        {/* 7. Help card */}
        <Layout.Section>
          <DashboardHelpCard />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
