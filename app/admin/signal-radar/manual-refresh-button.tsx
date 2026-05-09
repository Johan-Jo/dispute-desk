"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

const REFRESH_KEY = "signal-radar-last-refresh";

export function ManualRefreshButton() {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/signal-radar/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        const snippet = text.slice(0, 200).replace(/\s+/g, " ").trim();
        setError(
          res.status === 504
            ? "Request timed out (Vercel 504). Try again."
            : `Server returned non-JSON: ${snippet}`
        );
        return;
      }
      if (!res.ok) {
        setError(
          (json as { error?: string }).error ?? res.statusText ?? "request failed"
        );
        return;
      }
      const j = json as {
        fetched_submissions?: number;
        fetched_comments?: number;
        inserted?: number;
        errors?: string[];
        by_platform?: Record<string, number>;
      };
      try {
        window.sessionStorage.setItem(
          REFRESH_KEY,
          JSON.stringify({
            at: Date.now(),
            fetched_submissions: j.fetched_submissions ?? 0,
            fetched_comments: j.fetched_comments ?? 0,
            inserted: j.inserted ?? 0,
            errors: Array.isArray(j.errors) ? j.errors : [],
            by_platform: j.by_platform ?? {},
          })
        );
      } catch {}
      // Reload so the page-level RefreshStatusBar picks up the new sessionStorage
      // value and starts the countdown. Streams won't update yet (classifier
      // runs every 5 min) — the banner explains the wait.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={refresh}
        disabled={refreshing}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50"
      >
        <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
        {refreshing ? "Refreshing…" : "Refresh now"}
      </button>
      {error && <span className="text-[10px] text-[#DC2626]">{error}</span>}
    </div>
  );
}
