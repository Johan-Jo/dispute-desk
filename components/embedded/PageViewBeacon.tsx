"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Reports embedded-app page views from the client.
 *
 * WHY THIS EXISTS. The server layout records views too, and for full page loads
 * that is enough. But the embedded app navigates client-side — clicking a row
 * in the disputes list is a router transition — and Next can serve such a
 * transition from the router cache with no server round-trip, in which case the
 * layout never runs and nothing is recorded. On 2026-09-15 that produced zero
 * rows for dispute detail pages while every scripted server-side variant
 * recorded correctly, which is what made the cause so hard to see.
 *
 * DOUBLE-COUNTING. When a navigation DOES reach the server, both this and the
 * layout fire for the same path. `lastSent` suppresses the immediate repeat,
 * and the server drops a duplicate of the same (shop, path) within a few
 * seconds — see `recordPageView`. Belt and braces, because an over-count is a
 * quieter lie than a missing row but still a lie.
 */
export function PageViewBeacon() {
  const pathname = usePathname();
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || !pathname.startsWith("/app")) return;
    if (lastSent.current === pathname) return;
    lastSent.current = pathname;

    // Fire-and-forget: a failed beacon must never surface to the merchant.
    // keepalive so a view still reports if they navigate away immediately.
    void fetch("/api/page-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname }),
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);

  return null;
}
