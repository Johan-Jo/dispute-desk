"use client";

/**
 * Re-OAuth nudge for existing installs that pre-date the
 * `read_all_orders` scope rollout. Shopify granted DisputeDesk the
 * scope on 2026-05-10; installs from before that date kept the
 * default 60-day scope grant and need to re-authorize for the wider
 * historical-import window to apply.
 *
 * Render conditions:
 *   - Historical import has already completed (we don't pile a
 *     re-auth ask on top of an active backfill).
 *   - Live offline session scopes do NOT include `read_all_orders`.
 *
 * Dismissal: localStorage flag, per-device. Functionally a "remind
 * me later" — does not write server state, so a re-login on another
 * device still shows the nudge.
 *
 * Clicking the CTA navigates the top frame to `/api/auth/shopify`
 * (offline phase). The merchant goes through Shopify's consent
 * screen, the OAuth callback updates the offline session, and our
 * `resetBackfillIfScopeUpgraded` helper resets `historical_import_status`
 * so the standard re-enqueue path runs a fresh wider-window backfill.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Banner, BlockStack, Text, Button, InlineStack } from "@shopify/polaris";

const STORAGE_KEY = "dd_scope_upgrade_banner_dismissed";

interface ScopeStatePayload {
  historicalImportStatus:
    | "not_started"
    | "in_progress"
    | "complete"
    | "failed";
  currentScopeGrant: "default_window" | "read_all_orders";
}

export function DashboardScopeUpgradeBanner() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const [state, setState] = useState<ScopeStatePayload | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState<boolean>(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/insights/initial-analysis")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setState({
          historicalImportStatus: d.historicalImportStatus,
          currentScopeGrant: d.currentScopeGrant,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!hydrated || dismissed || !state) return null;
  if (state.historicalImportStatus !== "complete") return null;
  if (state.currentScopeGrant === "read_all_orders") return null;

  const onDismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
    setDismissed(true);
  };

  const onReauth = () => {
    const shop = searchParams.get("shop");
    if (!shop) return;
    const url = `/api/auth/shopify?phase=offline&shop=${encodeURIComponent(shop)}`;
    // Break out of the Shopify Admin iframe — the consent screen is
    // top-level and will be blocked by X-Frame-Options otherwise.
    if (typeof window !== "undefined" && window.top) {
      window.top.location.href = url;
    } else {
      window.location.href = url;
    }
  };

  return (
    <Banner
      tone="info"
      onDismiss={onDismiss}
      title={t("fraudIntel.scopeUpgradeTitle")}
    >
      <BlockStack gap="200">
        <Text as="p">{t("fraudIntel.scopeUpgradeBody")}</Text>
        <InlineStack gap="200">
          <Button variant="primary" onClick={onReauth}>
            {t("fraudIntel.scopeUpgradeCta")}
          </Button>
        </InlineStack>
      </BlockStack>
    </Banner>
  );
}
