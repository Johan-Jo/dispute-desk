"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

const REFRESH_KEY = "signal-radar-last-refresh";

interface InflightRun {
  run_id: string;
  started_at: string;
  status: "running";
}

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
            ? "Vercel edge timeout. Try again."
            : `Server returned non-JSON: ${snippet}`
        );
        return;
      }
      if (!res.ok && res.status !== 202) {
        setError(
          (json as { error?: string }).error ?? res.statusText ?? "request failed"
        );
        return;
      }

      // 202: ingest is running in the background. Stash the run_id so the
      // RefreshStatusBar can poll for completion. We do NOT reload the
      // page — RefreshStatusBar handles live progress.
      const j = json as { run_id?: string; started_at?: string };
      if (j.run_id && j.started_at) {
        const inflight: InflightRun = {
          run_id: j.run_id,
          started_at: j.started_at,
          status: "running",
        };
        try {
          window.sessionStorage.setItem(REFRESH_KEY, JSON.stringify(inflight));
        } catch {}
        // Notify any RefreshStatusBar instance currently mounted that an
        // in-flight run started, so it picks up the run_id without a reload.
        window.dispatchEvent(new CustomEvent("signal-radar-refresh-started"));
      }
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
        {refreshing ? "Starting…" : "Refresh now"}
      </button>
      {error && <span className="text-[10px] text-[#DC2626]">{error}</span>}
    </div>
  );
}
