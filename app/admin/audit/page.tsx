"use client";

import { useState, useEffect, useCallback } from "react";
import { ScrollText, Download, Calendar } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminFilterBar } from "@/components/admin/AdminFilterBar";
import { AdminTable } from "@/components/admin/AdminTable";
import { AdminMerchant } from "@/components/admin/AdminMerchant";

interface AuditEvent {
  id: string;
  shop_id: string | null;
  shop?: { shop_domain: string; primary_domain: string | null } | null;
  event_type: string;
  actor_type: string | null;
  /** Who acted: an operator's email for admin actions, a script name, etc. */
  actor_id: string | null;
  created_at: string;
  event_payload: Record<string, unknown>;
  scope?: "shop" | "global";
}

/** Wait for typing to pause before querying — each keystroke used to fire a request. */
function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function AdminAuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [shopFilter, setShopFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const shop = useDebounced(shopFilter.trim());
  const type = useDebounced(typeFilter.trim());

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (shop) params.set("shop", shop);
      if (type) params.set("event_type", type);
      const res = await fetch(`/api/admin/audit?${params}`);
      if (!res.ok) {
        let detail = "";
        try {
          detail = (await res.json())?.error ?? "";
        } catch {
          /* non-JSON */
        }
        throw new Error(`Loading the audit log failed (${res.status})${detail ? `: ${detail}` : ""}`);
      }
      const data = await res.json();
      setEvents(Array.isArray(data.events) ? data.events : []);
      setTruncated(Boolean(data.truncated));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the audit log");
    } finally {
      setLoading(false);
    }
  }, [shop, type]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const exportCsv = () => {
    const params = new URLSearchParams({ format: "csv" });
    if (shop) params.set("shop", shop);
    if (type) params.set("event_type", type);
    window.open(`/api/admin/audit?${params}`, "_blank");
  };

  const getEventColor = (event: string) => {
    if (event.includes("created") || event.includes("installed") || event.includes("added"))
      return "text-[#22C55E]";
    if (event.includes("failed") || event.includes("deprecated") || event.includes("deleted"))
      return "text-[#EF4444]";
    if (event.includes("updated")) return "text-[#3B82F6]";
    return "text-[#64748B]";
  };

  return (
    <div className="p-8">
      <AdminPageHeader
        title="Audit Log"
        subtitle="Shop-level events and platform-wide admin actions (templates, reason mappings)"
        icon={ScrollText}
        iconGradient="from-[#6366F1] to-[#8B5CF6]"
        actions={
          <button
            onClick={exportCsv}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#1D4ED8] text-white text-sm font-semibold rounded-lg hover:bg-[#1E40AF] transition-colors"
          >
            <Download className="w-4 h-4" />
            Export Log
          </button>
        }
      />

      <AdminFilterBar searchPlaceholder="Filter by shop or event type">
        <div className="flex flex-col md:flex-row gap-4 w-full">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Filter by shop (domain or id)..."
              value={shopFilter}
              onChange={(e) => setShopFilter(e.target.value)}
              className="w-full px-4 py-2.5 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
            />
          </div>
          <div className="flex-1">
            <input
              type="text"
              placeholder="Filter by event type..."
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full px-4 py-2.5 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
            />
          </div>
        </div>
      </AdminFilterBar>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
          {error}
        </div>
      )}

      {truncated && !error && (
        <p className="mb-3 text-xs text-[#64748B]">
          Showing the 500 most recent events. Narrow the filters or export to see how far back this goes.
        </p>
      )}

      <AdminTable
        headers={["Timestamp", "Event", "Actor", "Shop", "Payload"]}
        loading={loading}
        isEmpty={!loading && events.length === 0}
        emptyTitle={error ? "Could not load events" : "No events found"}
        emptyMessage={error ? "See the error above" : "Try adjusting your filters"}
      >
        {events.map((ev) => (
          <tr key={ev.id} className="hover:bg-[#F8FAFC] transition-colors">
            <td className="px-6 py-4">
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-[#64748B]" />
                <span className="text-xs font-mono text-[#64748B]">
                  {new Date(ev.created_at).toLocaleString()}
                </span>
              </div>
            </td>
            <td className="px-6 py-4">
              <span className={`text-sm font-mono ${getEventColor(ev.event_type)}`}>
                {ev.event_type}
              </span>
            </td>
            <td className="px-6 py-4">
              <div className="flex flex-col">
                <span
                  className={`text-sm ${ev.actor_type === "system" ? "text-[#8B5CF6] font-mono" : "text-[#0F172A]"}`}
                >
                  {ev.actor_type ?? "—"}
                </span>
                {ev.actor_id && (
                  <span className="text-xs text-[#64748B] break-all">{ev.actor_id}</span>
                )}
              </div>
            </td>
            <td className="px-6 py-4 max-w-[240px]">
              {ev.shop ? (
                <span className="text-sm font-medium text-[#0F172A]">
                  <AdminMerchant shopDomain={ev.shop.shop_domain} primaryDomain={ev.shop.primary_domain} />
                </span>
              ) : ev.shop_id ? (
                <span className="text-xs font-mono text-[#64748B]">{ev.shop_id}</span>
              ) : (
                <span className="text-xs text-[#94A3B8] italic">
                  {ev.scope === "global" ? "platform-wide" : "—"}
                </span>
              )}
            </td>
            <td className="px-6 py-4">
              <button
                onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                className="text-sm text-[#1D4ED8] font-semibold hover:text-[#1E40AF]"
              >
                {expanded === ev.id ? "Hide" : "View"}
              </button>
              {expanded === ev.id && (
                <pre className="mt-2 text-xs bg-[#F8FAFC] border border-[#E2E8F0] p-3 rounded-lg max-w-md overflow-auto">
                  {JSON.stringify(ev.event_payload, null, 2)}
                </pre>
              )}
            </td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
