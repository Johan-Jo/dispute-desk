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
 *   - Server-side dismissal flag for banner_id `scope_upgrade` is
 *     not set on this shop.
 *
 * Dismissal: server-side via POST /api/dashboard/banners/dismiss.
 * Replaces the previous localStorage flag (which was per-device,
 * so merchants saw the banner on every other browser/device they
 * signed in from). Persisted in `shops.dismissed_banners` JSONB.
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

const BANNER_ID = "scope_upgrade";

interface ScopeStatePayload {
  historicalImportStatus:
    | "not_started"
    | "in_progress"
    | "complete"
    | "failed";
  currentScopeGrant: "default_window" | "read_all_orders";
  dismissed: boolean;
}

export function DashboardScopeUpgradeBanner() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const [state, setState] = useState<ScopeStatePayload | null>(null);
  // Local optimistic dismissal — flips immediately on click so the
  // banner disappears without waiting for the POST round-trip. The
  // server state catches up shortly after and the dashboard's next
  // poll reflects it everywhere.
  const [optimisticDismissed, setOptimisticDismissed] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/insights/initial-analysis")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const dismissed = !!(d.dismissedBanners ?? {})[BANNER_ID];
        setState({
          historicalImportStatus: d.historicalImportStatus,
          currentScopeGrant: d.currentScopeGrant,
          dismissed,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state) return null;
  if (state.dismissed || optimisticDismissed) return null;
  if (state.historicalImportStatus !== "complete") return null;
  if (state.currentScopeGrant === "read_all_orders") return null;

  const onDismiss = () => {
    setOptimisticDismissed(true);
    // Fire-and-forget — if the POST fails the banner will re-appear
    // on the next dashboard load, which is the right behaviour
    // (don't lose the nudge silently).
    fetch("/api/dashboard/banners/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bannerId: BANNER_ID }),
    }).catch(() => {
      /* swallow — next page load will retry the dismissal naturally */
    });
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
