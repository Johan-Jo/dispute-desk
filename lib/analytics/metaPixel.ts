"use client";

import { CONSENT_VALUE_ANALYTICS } from "@/lib/consent/constants";
import { readStoredConsent } from "@/lib/consent/client";

/** Public identifier (not a secret). Env override lets dev/prod use separate pixels. */
export const META_PIXEL_ID =
  (process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "").trim() || "1075321878435262";

/** Dispatched by the consent bar when the visitor accepts analytics. */
export const META_CONSENT_EVENT = "dd:consent-granted";

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[];
  push?: unknown;
  loaded?: boolean;
  version?: string;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export function hasMetaConsent(): boolean {
  return readStoredConsent() === CONSENT_VALUE_ANALYTICS;
}

/** Standard Meta Pixel base code, run only after the visitor has consented. */
export function loadMetaPixel(): void {
  if (typeof window === "undefined" || window.fbq) return;
  const n = function (...args: unknown[]) {
    if (n.callMethod) n.callMethod(...args);
    else n.queue!.push(args);
  } as Fbq;
  window.fbq = n;
  if (!window._fbq) window._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
  n("init", META_PIXEL_ID);
  n("track", "PageView");
}

/**
 * Fire the browser-side `Lead` event. The same `eventId` is sent to the server so the
 * Conversions API copy deduplicates against this one.
 */
export function trackLead(eventId: string): void {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  window.fbq("track", "Lead", {}, { eventID: eventId });
}

export function newEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
