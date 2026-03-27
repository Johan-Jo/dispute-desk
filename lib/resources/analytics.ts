"use client";

export type ResourceAnalyticsPayload = {
  event: string;
  contentId?: string;
  locale?: string;
  ctaId?: string;
};

/**
 * Thin layer for Resources Hub events. Wire to Segment/GA when env is set.
 */
export function trackResourceEvent(payload: ResourceAnalyticsPayload): void {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV === "development") {
    console.debug("[resources]", payload);
  }
  const w = window as unknown as {
    dataLayer?: Record<string, unknown>[];
  };
  if (w.dataLayer) {
    w.dataLayer.push({ resourceEvent: payload.event, ...payload });
  }
}
