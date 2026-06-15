"use client";

/**
 * Generic re-auth banner for the installed base.
 *
 * When the app adds a new OAuth scope, already-installed shops keep
 * their old grant until an OAuth flow re-runs (Shopify only re-prompts
 * on a scope mismatch). This banner reads `needsReauth` from
 * /api/setup/readiness — the one endpoint middleware already resolves
 * correctly for the embedded iframe (via the /api/setup/* shop-domain
 * resolution; a plain fetch from the iframe carries no x-shop-id, and
 * portal cookies aren't set here, so a generic /api/shop/* route 401s).
 * When a required scope is missing it shows an "approve new permissions"
 * CTA that breaks out of the Admin iframe into the Shopify consent
 * screen. The merchant approves once — no uninstall.
 *
 * Unlike the legacy read_all_orders-specific banner, this is scope-
 * agnostic: every future scope addition surfaces here automatically.
 * It is intentionally NOT dismissible — a missing required scope leaves
 * a feature broken (e.g. policy ingest needs read_legal_policies), so
 * the nudge should persist until the merchant re-authorizes.
 *
 * Rendered app-wide from the embedded layout.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Banner, BlockStack, Text, Button, InlineStack } from "@shopify/polaris";

export function ScopeReauthBanner() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const [needsReauth, setNeedsReauth] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const shop = searchParams.get("shop");
    const host = searchParams.get("host");
    // Pass through whatever Shopify-asserted identity the iframe URL
    // carries so /api/setup/* middleware can resolve the shop server-side.
    const params = new URLSearchParams();
    if (shop) params.set("shop", shop);
    if (host) params.set("host", host);
    const qs = params.toString() ? `?${params.toString()}` : "";
    fetch(`/api/setup/readiness${qs}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setNeedsReauth(Boolean(d.needsReauth));
      })
      .catch(() => {
        /* network blip — don't nag on an inconclusive check */
      });
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  if (!needsReauth) return null;

  const onReauth = () => {
    const shop = searchParams.get("shop");
    if (!shop) return;
    const url = `/api/auth/shopify?phase=offline&shop=${encodeURIComponent(shop)}`;
    // Break out of the Shopify Admin iframe — the consent screen is
    // top-level and would be blocked by X-Frame-Options otherwise.
    if (typeof window !== "undefined" && window.top) {
      window.top.location.href = url;
    } else {
      window.location.href = url;
    }
  };

  return (
    <Banner tone="warning" title={t("scopeReauth.title")}>
      <BlockStack gap="200">
        <Text as="p">{t("scopeReauth.body")}</Text>
        <InlineStack gap="200">
          <Button variant="primary" onClick={onReauth}>
            {t("scopeReauth.cta")}
          </Button>
        </InlineStack>
      </BlockStack>
    </Banner>
  );
}
