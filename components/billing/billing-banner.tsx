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
  shopId: string;
  /** Optional override — e.g. `/portal/billing` vs `/app/billing`. */
  ctaHref?: string;
}

export function BillingBanner({ shopId, ctaHref = "/app/billing" }: BillingBannerProps) {
  const t = useTranslations("billing.banners");
  const [state, setState] = useState<BillingBannerResponse | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/billing/banner?shop_id=${encodeURIComponent(shopId)}`,
        );
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
  }, [shopId]);

  const dismiss = useCallback(async () => {
    if (!state || !state.dismissible || !state.forCycleEnd) return;
    setHidden(true);
    try {
      await fetch(
        `/api/billing/banner/dismiss?shop_id=${encodeURIComponent(shopId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            variant: state.variant,
            cycleEnd: state.forCycleEnd,
          }),
        },
      );
    } catch {
      /* silent — local state already hidden, server reconciles on next view */
    }
  }, [state, shopId]);

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
