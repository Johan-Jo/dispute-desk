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

/** Turn `review_approved` into `Review approved`. */
function humanEvent(t: string): string {
  const s = t.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function ShopActivity({ shopId }: { shopId: string }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [cutoff, setCutoff] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    fetch(`/api/admin/shops/${shopId}/activity${showAll ? "?actors=all" : ""}`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        setRows(d.events ?? []);
        setCutoff(d.attributionTrustworthyFrom ?? null);
      })
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [shopId, showAll]);

  const cutoffMs = cutoff ? Date.parse(cutoff) : null;

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
            const ts = Date.parse(r.created_at);
            const preAttribution =
              cutoffMs !== null && ts < cutoffMs && r.actor_type === "merchant";
            return (
              <div key={r.id} className="py-2.5 flex items-start gap-3 text-sm">
                <span className="text-[#64748B] tabular-nums whitespace-nowrap">
                  {new Date(r.created_at).toLocaleDateString()}{" "}
                  {new Date(r.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span
                  className={`px-2 py-0.5 ${ACTOR_STYLE[r.actor_type]} text-xs font-semibold rounded-full whitespace-nowrap`}
                  title={r.actor_id ?? undefined}
                >
                  {ACTOR_LABEL[r.actor_type]}
                </span>
                <span className="text-[#0F172A] flex-1">
                  {humanEvent(r.event_type)}
                  {preAttribution && (
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
