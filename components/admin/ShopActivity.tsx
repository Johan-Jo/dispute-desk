"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";

/**
 * "Who did what" for /admin/shops/[id].
 *
 * WHY THIS EXISTS. Asked what a merchant did after logging in, `audit_events`
 * could not answer: every request-scoped write recorded `actor_type:
 * "merchant"`, so our own View-as-merchant actions and operator scripts were
 * indistinguishable from the merchant's. Shop ea035a1b showed 14 "merchant"
 * rows, 8 of which were `scripts/build-one-pack.mjs`. Fixed 2026-09-15
 * (migration 20260915120000 + lib/audit/resolveActor.ts).
 *
 * PEOPLE ONLY by default. System rows are automation heartbeat — hourly
 * `disputes_synced`, job-lock reclaims — and outnumber real actions by an
 * order of magnitude. The toggle reveals them rather than pretending they
 * don't exist.
 */

interface AuditRow {
  id: string;
  created_at: string;
  actor_type: "merchant" | "admin" | "script" | "system";
  actor_id: string | null;
  event_type: string;
  event_payload: Record<string, unknown> | null;
  dispute_id: string | null;
}

interface PageViewRow {
  id: string;
  viewed_at: string;
  actor_type: "merchant" | "admin";
  actor_id: string | null;
  path: string;
  route: string;
  dispute_id: string | null;
}

/** One timeline entry, from either source. */
interface Entry {
  id: string;
  at: string;
  actor: AuditRow["actor_type"];
  kind: "action" | "view";
  label: string;
  actorId: string | null;
  /** Raw path for a view row — shown so "which page" is answerable. */
  path?: string;
}

const ACTOR_STYLE: Record<AuditRow["actor_type"], string> = {
  merchant: "bg-[#DBEAFE] text-[#1E40AF]",
  admin: "bg-[#FEF3C7] text-[#92400E]",
  script: "bg-[#EDE9FE] text-[#6B21A8]",
  system: "bg-[#F1F5F9] text-[#475569]",
};

const ACTOR_LABEL: Record<AuditRow["actor_type"], string> = {
  merchant: "Merchant",
  admin: "Admin",
  script: "Script",
  system: "System",
};

/** Human label for a visited route. */
function friendlyPath(route: string): string | null {
  const NAMES: Record<string, string> = {
    "/app": "Dashboard",
    "/app/disputes": "Disputes list",
    "/app/disputes/[id]": "Dispute",
    "/app/settings": "Settings",
    "/app/billing": "Billing",
    "/app/insights/initial-analysis": "Insights",
    "/app/help": "Help",
    "/app/coverage": "Coverage",
  };
  return NAMES[route] ?? null;
}

/**
 * What a view row shows for the page that was visited.
 *
 * EVERY row is openable, and every one opens the MERCHANT's own page under
 * View-as-merchant — not an admin equivalent. The point of clicking a row in
 * this timeline is to see what the merchant saw; our admin view of a dispute is
 * a different page showing different things, and for most routes (Coverage,
 * Help, Insights, Settings) no admin equivalent exists at all.
 *
 * An earlier version linked only dispute detail, and linked it to
 * `/admin/disputes/<id>`. That made every other row look deliberately inert,
 * and sent the one working link to the wrong place.
 */
export function viewTarget(
  route: string,
  path: string,
): { label: string; path: string } {
  const name = friendlyPath(route);
  return { label: name ? `Viewed ${name}` : "Viewed", path };
}

/** Turn `review_approved` into `Review approved`. */
function humanEvent(t: string): string {
  const s = t.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function ShopActivity({ shopId }: { shopId: string }) {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [cutoff, setCutoff] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    fetch(`/api/admin/shops/${shopId}/activity${showAll ? "?actors=all" : ""}`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        const actions: Entry[] = (d.events ?? []).map((r: AuditRow) => ({
          id: r.id,
          at: r.created_at,
          actor: r.actor_type,
          kind: "action" as const,
          label: humanEvent(r.event_type),
          actorId: r.actor_id,
        }));
        const views: Entry[] = (d.pageViews ?? []).map((v: PageViewRow) => {
          const t = viewTarget(v.route, v.path);
          return {
            id: v.id,
            at: v.viewed_at,
            actor: v.actor_type,
            kind: "view" as const,
            label: t.label,
            actorId: v.actor_id,
            path: t.path,
          };
        });
        setRows(
          [...actions, ...views].sort(
            (a, b) => Date.parse(b.at) - Date.parse(a.at),
          ),
        );
        setCutoff(d.attributionTrustworthyFrom ?? null);
      })
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [shopId, showAll]);

  const cutoffMs = cutoff ? Date.parse(cutoff) : null;

  /**
   * Open a visited page as the merchant sees it.
   *
   * Mints a READ-mode impersonation session for this shop and lands directly on
   * the path from the row. Read mode deliberately: opening a page to see what
   * someone looked at must never be able to change anything. The window is
   * opened synchronously and its location set after the request resolves —
   * popup blockers reject a window.open that happens inside an await.
   */
  async function openAsMerchant(path: string) {
    const w = window.open("", "_blank", "noopener");
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopId, mode: "read", targetPath: path }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.targetUrl) {
        w?.close();
        setOpenError(data?.error ?? "Could not open the merchant view.");
        return;
      }
      if (w) w.location.href = data.targetUrl;
    } catch {
      w?.close();
      setOpenError("Could not open the merchant view.");
    }
  }

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-[#64748B]" />
          <h2 className="text-base font-semibold text-[#0F172A]">Activity</h2>
        </div>
        <label className="flex items-center gap-2 text-sm text-[#64748B] cursor-pointer">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
            className="rounded border-[#CBD5E1]"
          />
          Include automation
        </label>
      </div>

      {openError && (
        <div className="mb-3 text-sm text-[#991B1B] bg-[#FEE2E2] rounded-md px-3 py-2">
          {openError}
        </div>
      )}

      {rows === null ? (
        <div className="text-sm text-[#64748B]">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-[#64748B]">
          {showAll
            ? "No recorded activity for this shop."
            : "No merchant or admin actions recorded. Tick “Include automation” to see system activity."}
        </div>
      ) : (
        <div className="divide-y divide-[#F1F5F9]">
          {rows.map((r) => {
            const ts = Date.parse(r.at);
            const preAttribution =
              cutoffMs !== null && ts < cutoffMs && r.actor === "merchant";
            return (
              <div key={r.id} className="py-2.5 flex items-start gap-3 text-sm">
                <span className="text-[#64748B] tabular-nums whitespace-nowrap">
                  {new Date(r.at).toLocaleDateString()}{" "}
                  {new Date(r.at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span
                  className={`px-2 py-0.5 ${ACTOR_STYLE[r.actor]} text-xs font-semibold rounded-full whitespace-nowrap`}
                  title={r.actorId ?? undefined}
                >
                  {ACTOR_LABEL[r.actor]}
                </span>
                <span
                  className={`flex-1 ${r.kind === "view" ? "text-[#64748B]" : "text-[#0F172A]"}`}
                >
                  {r.label}
                  {/* The URL itself. "Viewed a dispute" does not say WHICH,
                      and which page they opened is the whole question this
                      log exists to answer. Dispute paths link through to the
                      internal dispute view. */}
                  {r.kind === "view" && r.path && (
                    <>
                      {" "}
                      <button
                        type="button"
                        onClick={() => openAsMerchant(r.path!)}
                        title="Open this page as the merchant sees it (read-only)"
                        className="font-mono text-xs text-[#1D4ED8] hover:underline break-all cursor-pointer bg-transparent border-0 p-0"
                      >
                        {r.path}
                      </button>
                    </>
                  )}
                  {preAttribution && r.kind === "action" && (
                    <span
                      className="ml-2 text-xs text-[#94A3B8]"
                      title="Before 2026-09-15 every request-scoped write was recorded as 'merchant', including admin actions under View-as-merchant. This row's actor is not reliable."
                    >
                      (actor unverified)
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
