"use client";

import { useEffect, useState } from "react";
import { Clock, CheckCircle2, RefreshCw } from "lucide-react";

interface RefreshSnapshot {
  at: number;
  fetched_submissions: number;
  fetched_comments: number;
  inserted: number;
  errors: string[];
  by_platform: Record<string, number>;
}

const REFRESH_KEY = "signal-radar-last-refresh";
const CLASSIFIER_INTERVAL_MS = 5 * 60 * 1000;
const CLASSIFIER_BUFFER_MS = 30 * 1000;

function loadLastRefresh(): RefreshSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(REFRESH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RefreshSnapshot>;
    if (typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > 60 * 60 * 1000) return null;
    return {
      at: parsed.at,
      fetched_submissions: parsed.fetched_submissions ?? 0,
      fetched_comments: parsed.fetched_comments ?? 0,
      inserted: parsed.inserted ?? 0,
      errors: Array.isArray(parsed.errors) ? parsed.errors : [],
      by_platform:
        typeof parsed.by_platform === "object" && parsed.by_platform !== null
          ? (parsed.by_platform as Record<string, number>)
          : {},
    };
  } catch {
    return null;
  }
}

function nextClassifierTickAt(refreshAt: number): number {
  const minutes = Math.ceil(
    (refreshAt + CLASSIFIER_BUFFER_MS) / CLASSIFIER_INTERVAL_MS
  );
  return minutes * CLASSIFIER_INTERVAL_MS + CLASSIFIER_BUFFER_MS;
}

function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export function RefreshStatusBar() {
  const [snap, setSnap] = useState<RefreshSnapshot | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    setSnap(loadLastRefresh());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!snap) return null;

  const elapsed = now - snap.at;
  const tickAt = nextClassifierTickAt(snap.at);
  const remaining = tickAt - now;
  const tickReady = remaining <= 0;
  const errors = snap.errors ?? [];
  const hasErrors = errors.length > 0;
  const platforms = Object.entries(snap.by_platform).filter(([, n]) => n > 0);

  return (
    <div className="space-y-2">
      <div
        className={`rounded-md border px-3 py-2 text-xs flex items-center gap-3 ${
          hasErrors
            ? "bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]"
            : tickReady
              ? "bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]"
              : "bg-[#EFF6FF] border-[#BFDBFE] text-[#1E40AF]"
        }`}
      >
        {hasErrors ? (
          <Clock className="w-4 h-4 flex-shrink-0" />
        ) : tickReady ? (
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
        ) : (
          <Clock className="w-4 h-4 flex-shrink-0" />
        )}
        <div className="flex-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            Last refresh <strong>{formatDuration(elapsed)}</strong> ago
          </span>
          <span className="opacity-70">·</span>
          <span>
            ingested <strong>{snap.fetched_submissions}</strong> posts +{" "}
            <strong>{snap.fetched_comments}</strong> comments (
            <strong>{snap.inserted}</strong> new)
          </span>
          {platforms.length > 0 && (
            <>
              <span className="opacity-70">·</span>
              <span>
                {platforms.map(([p, n]) => `${p}: ${n}`).join(", ")}
              </span>
            </>
          )}
          {!hasErrors && (
            <>
              <span className="opacity-70">·</span>
              {tickReady ? (
                <span>
                  classifier should have run — <strong>reload</strong> for results
                </span>
              ) : (
                <span>
                  next classifier tick in <strong>{formatDuration(remaining)}</strong>
                </span>
              )}
            </>
          )}
        </div>
        {tickReady && !hasErrors && (
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#10B981] text-white font-medium hover:bg-[#059669]"
          >
            <RefreshCw className="w-3 h-3" />
            Reload
          </button>
        )}
      </div>
      {hasErrors && (
        <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">
          <div className="font-semibold mb-1">
            Ingest issues ({errors.length}):
          </div>
          <ul className="list-disc list-inside space-y-0.5">
            {errors.map((e, i) => (
              <li key={i} className="break-all">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
