"use client";

/**
 * BillingBanner — Phase 4b client component.
 *
 * Fetches `GET /api/billing/banner`, renders one of the three banner
 * variants (subscription_expired / grace / low_credits), and POSTs
 * to `/api/billing/banner/dismiss` when the merchant clicks the
 * dismiss control on a dismissible variant.
 *
 * The component is `null` while loading and on `variant === "none"`
 * so embedding it in any page is safe — no flash of empty container,
 * no layout shift.
 *
 * i18n: every visible string comes from `billing.banners.*` in
 * `messages/{locale}.json`. The fallback English strings are
 * inlined as a last-resort guard against missing translations; they
 * should never render in practice.
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { InfoBanner } from "@/components/ui/info-banner";
import { Button } from "@/components/ui/button";

interface BillingBannerResponse {
  variant: "subscription_expired" | "grace" | "low_credits" | "none";
  dismissible: boolean;
  forCycleEnd: string | null;
  context: Record<string, unknown>;
}

interface BillingBannerProps {
  /** Optional — when omitted the API resolves shop_id from the
   *  `x-shop-id` header that middleware injects from the Shopify
   *  embedded session. Pass an explicit value for portal contexts
   *  where the session source differs. */
  shopId?: string;
  /** Optional override — e.g. `/portal/billing` vs `/app/billing`. */
  ctaHref?: string;
  /** Visual-verification only. Set to `grace`, `subscription_expired`,
   *  or `low_credits` to force the API to return that variant
   *  regardless of DB state. The API logs an audit row when a preview
   *  variant is requested, so leaking this into a production code
   *  path is visible. Driven from the URL `?banner_preview=…` so the
   *  user can verify without code changes. */
  preview?: "grace" | "subscription_expired" | "low_credits";
}

export function BillingBanner({
  shopId,
  ctaHref = "/app/billing",
  preview,
}: BillingBannerProps) {
  const t = useTranslations("billing.banners");
  const [state, setState] = useState<BillingBannerResponse | null>(null);
  const [hidden, setHidden] = useState(false);

  const apiUrl = useCallback(
    (path: string) => {
      const params = new URLSearchParams();
      if (shopId) params.set("shop_id", shopId);
      if (preview) params.set("preview", preview);
      const qs = params.toString();
      return qs ? `${path}?${qs}` : path;
    },
    [shopId, preview],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/billing/banner"));
        if (!res.ok) return;
        const json = (await res.json()) as BillingBannerResponse;
        if (!cancelled) setState(json);
      } catch {
        /* fail silent — banner is informational */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  const dismiss = useCallback(async () => {
    if (!state || !state.dismissible || !state.forCycleEnd) return;
    setHidden(true);
    try {
      await fetch(apiUrl("/api/billing/banner/dismiss"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          variant: state.variant,
          cycleEnd: state.forCycleEnd,
        }),
      });
    } catch {
      /* silent — local state already hidden, server reconciles on next view */
    }
  }, [state, apiUrl]);

  if (!state || state.variant === "none" || hidden) return null;

  const variantUiMap = {
    subscription_expired: { ui: "danger", key: "expired" },
    grace: { ui: "warning", key: "grace" },
    low_credits: { ui: "info", key: "lowCredits" },
  } as const;
  const v = variantUiMap[state.variant];

  return (
    <InfoBanner
      variant={v.ui}
      title={safeT(t, `${v.key}.title`)}
      onDismiss={state.dismissible ? dismiss : undefined}
    >
      <p>{safeT(t, `${v.key}.body`)}</p>
      <p className="mt-3">
        <a href={ctaHref}>
          <Button variant="primary" size="sm">
            {safeT(t, `${v.key}.cta`)}
          </Button>
        </a>
      </p>
    </InfoBanner>
  );
}

/** Tiny shim so a missing translation falls back to the key path
 *  instead of throwing. Real translations live in messages/{locale}.json. */
function safeT(
  t: ReturnType<typeof useTranslations>,
  key: string,
): string {
  try {
    return t(key);
  } catch {
    return key;
  }
}
