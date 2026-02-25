"use client";

import { useState, useEffect, useCallback } from "react";

interface AuditEvent {
  id: string;
  shop_id: string;
  event_type: string;
  actor_type: string;
  created_at: string;
  event_payload: Record<string, unknown>;
}

export default function AdminAuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [shopFilter, setShopFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (shopFilter) params.set("shop_id", shopFilter);
    if (typeFilter) params.set("event_type", typeFilter);
    const res = await fetch(`/api/admin/audit?${params}`);
    setEvents(await res.json());
    setLoading(false);
  }, [shopFilter, typeFilter]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const exportCsv = () => {
    const params = new URLSearchParams({ format: "csv" });
    if (shopFilter) params.set("shop_id", shopFilter);
    if (typeFilter) params.set("event_type", typeFilter);
    window.open(`/api/admin/audit?${params}`, "_blank");
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#0B1220]">Audit Log</h1>
        <button onClick={exportCsv} className="h-9 px-4 text-sm bg-white border border-[#E5E7EB] rounded-lg hover:bg-[#F7F8FA]">
          Export CSV
        </button>
      </div>

      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Filter by Shop ID"
          value={shopFilter}
          onChange={(e) => setShopFilter(e.target.value)}
          className="h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm w-64"
        />
        <input
          type="text"
          placeholder="Event type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm w-48"
        />
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#F7F8FA]">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Time</th>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Event</th>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Actor</th>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Shop</th>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Payload</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[#667085]">Loading...</td></tr>
            ) : events.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[#667085]">No events found</td></tr>
            ) : events.map((ev) => (
              <tr key={ev.id} className="border-t border-[#E5E7EB] hover:bg-[#F7F8FA]">
                <td className="px-4 py-3 text-[#667085] whitespace-nowrap">{new Date(ev.created_at).toLocaleString()}</td>
                <td className="px-4 py-3 font-mono text-xs">{ev.event_type}</td>
                <td className="px-4 py-3 text-xs capitalize">{ev.actor_type}</td>
                <td className="px-4 py-3 text-xs font-mono truncate max-w-[120px]">{ev.shop_id}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                    className="text-xs text-[#1D4ED8] hover:underline"
                  >
                    {expanded === ev.id ? "Hide" : "View"}
                  </button>
                  {expanded === ev.id && (
                    <pre className="mt-2 text-xs bg-[#F7F8FA] p-2 rounded max-w-md overflow-auto">
                      {JSON.stringify(ev.event_payload, null, 2)}
                    </pre>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
