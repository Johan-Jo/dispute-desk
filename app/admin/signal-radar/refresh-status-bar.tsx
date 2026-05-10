"use client";

import { useEffect, useState } from "react";
import { Clock, CheckCircle2, RefreshCw, AlertCircle } from "lucide-react";

const REFRESH_KEY = "signal-radar-last-refresh";
const CLASSIFIER_INTERVAL_MS = 5 * 60 * 1000;
const CLASSIFIER_BUFFER_MS = 30 * 1000;
const POLL_INTERVAL_MS = 5_000;

interface RunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "done" | "error";
  trigger: "manual" | "cron";
  by_platform: Record<string, number> | null;
  fetched: number;
  inserted: number;
  errors: string[];
  error_message: string | null;
}

interface SessionEntry {
  run_id?: string;
  started_at?: string;
  status?: string;
  // Legacy synchronous-flow fields, preserved for back-compat with old
  // sessionStorage entries that predate the background-fire change.
  at?: number;
  fetched_submissions?: number;
  fetched_comments?: number;
  inserted?: number;
  errors?: string[];
  by_platform?: Record<string, number>;
}

function loadSession(): SessionEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(REFRESH_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionEntry;
  } catch {
    return null;
  }
}

function saveSession(entry: SessionEntry): void {
  try {
    window.sessionStorage.setItem(REFRESH_KEY, JSON.stringify(entry));
  } catch {}
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
  const [session, setSession] = useState<SessionEntry | null>(null);
  const [run, setRun] = useState<RunRow | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  // Initial load + listen for refresh-started events from the button.
  useEffect(() => {
    setSession(loadSession());
    const handler = () => setSession(loadSession());
    window.addEventListener("signal-radar-refresh-started", handler);
    return () =>
      window.removeEventListener("signal-radar-refresh-started", handler);
  }, []);

  // 1s tick for elapsed-time display.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Poll the status endpoint while a run is in flight.
  useEffect(() => {
    if (!session?.run_id) return;
    let stopped = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await fetch(
          `/api/admin/signal-radar/refresh-status?run_id=${session?.run_id}`
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = (await res.json()) as { run: RunRow | null };
        if (!stopped && json.run) {
          setRun(json.run);
          // When the run finishes, snapshot the result into sessionStorage in
          // the legacy shape (so the rest of the dashboard keeps working) and
          // stop polling.
          if (json.run.status !== "running") {
            saveSession({
              run_id: json.run.id,
              started_at: json.run.started_at,
              status: json.run.status,
              at: new Date(json.run.finished_at ?? json.run.started_at).getTime(),
              fetched_submissions: json.run.fetched,
              fetched_comments: 0,
              inserted: json.run.inserted,
              errors: json.run.errors ?? [],
              by_platform: json.run.by_platform ?? {},
            });
            return;
          }
        }
      } catch {
        // transient — try again on next tick
      }
      if (!stopped) timeout = setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
    return () => {
      stopped = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [session?.run_id]);

  if (!session && !run) return null;

  // Active run still in flight
  if (run?.status === "running" || (session?.run_id && !run)) {
    const startedAt = run?.started_at ?? session?.started_at;
    const elapsed = startedAt ? now - new Date(startedAt).getTime() : 0;
    return (
      <div className="rounded-md border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-xs text-[#1E40AF] flex items-center gap-3">
        <RefreshCw className="w-4 h-4 flex-shrink-0 animate-spin" />
        <div className="flex-1">
          Ingest running for <strong>{formatDuration(elapsed)}</strong> — typically 1–2 min. Fresh
          dashboard data appears after the next classifier tick (every 5 min).
        </div>
      </div>
    );
  }

  // Completed run — same display the synchronous flow used to render.
  const finishedAt = run?.finished_at
    ? new Date(run.finished_at).getTime()
    : session?.at ?? null;
  if (!finishedAt) return null;
  const elapsed = now - finishedAt;
  const tickAt = nextClassifierTickAt(finishedAt);
  const remaining = tickAt - now;
  const tickReady = remaining <= 0;
  const errors = run?.errors ?? session?.errors ?? [];
  const hasErrors =
    errors.length > 0 || run?.status === "error" || !!run?.error_message;
  const inserted = run?.inserted ?? session?.inserted ?? 0;
  const fetched = run?.fetched ?? session?.fetched_submissions ?? 0;
  const platforms = Object.entries(
    run?.by_platform ?? session?.by_platform ?? {}
  ).filter(([, n]) => n > 0);

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
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
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
            ingested <strong>{fetched}</strong> items (
            <strong>{inserted}</strong> new)
          </span>
          {platforms.length > 0 && (
            <>
              <span className="opacity-70">·</span>
              <span>{platforms.map(([p, n]) => `${p}: ${n}`).join(", ")}</span>
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
                  next classifier tick in{" "}
                  <strong>{formatDuration(remaining)}</strong>
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
            Ingest issues ({errors.length || (run?.error_message ? 1 : 0)}):
          </div>
          <ul className="list-disc list-inside space-y-0.5">
            {errors.map((e, i) => (
              <li key={i} className="break-all">
                {e}
              </li>
            ))}
            {run?.error_message && (
              <li className="break-all">{run.error_message}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
