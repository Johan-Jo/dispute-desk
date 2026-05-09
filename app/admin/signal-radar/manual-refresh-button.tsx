"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

export function ManualRefreshButton() {
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setMsg(null);
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
      const platforms = j.by_platform ?? {};
      const breakdown = Object.entries(platforms)
        .map(([p, n]) => `${p}: ${n}`)
        .join(", ");
      setMsg(
        `Ingested ${j.fetched_submissions ?? 0} posts + ${j.fetched_comments ?? 0} comments (${j.inserted ?? 0} new)${breakdown ? ` · ${breakdown}` : ""}`
      );
      if (j.errors && j.errors.length > 0) {
        setError(`Issues: ${j.errors.slice(0, 2).join("; ")}`);
      }
      // Reload after a beat so the streams pick up classified items as they
      // come through the next 5-min drain tick.
      setTimeout(() => {
        window.location.reload();
      }, 1500);
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
      {msg && <span className="text-[10px] text-[#64748B]">{msg}</span>}
      {error && <span className="text-[10px] text-[#DC2626]">{error}</span>}
    </div>
  );
}
