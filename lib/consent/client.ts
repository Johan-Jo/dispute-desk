"use client";

import {
  CONSENT_COOKIE_NAME,
  CONSENT_STORAGE_KEY,
  CONSENT_VALUE_ANALYTICS,
  CONSENT_VALUE_ESSENTIAL,
} from "@/lib/consent/constants";

export function readStoredConsent(): string | null {
  try {
    const fromStorage = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (fromStorage === CONSENT_VALUE_ANALYTICS || fromStorage === CONSENT_VALUE_ESSENTIAL) {
      return fromStorage;
    }
  } catch {
    /* ignore */
  }
  try {
    const parts = document.cookie.split(";");
    for (const part of parts) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      const name = part.slice(0, idx).trim();
      if (name !== CONSENT_COOKIE_NAME) continue;
      const raw = part.slice(idx + 1).trim();
      const value = decodeURIComponent(raw);
      if (value === CONSENT_VALUE_ANALYTICS || value === CONSENT_VALUE_ESSENTIAL) {
        return value;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function persistConsent(value: typeof CONSENT_VALUE_ANALYTICS | typeof CONSENT_VALUE_ESSENTIAL) {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, value);
  } catch {
    /* ignore */
  }
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(value)};path=/;max-age=${maxAge};samesite=lax`;
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function grantAnalyticsConsentViaGtag() {
  if (typeof window.gtag !== "function") return;
  window.gtag("consent", "update", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
}
