"use client";

import { useCallback, useEffect, useState } from "react";
import { Webhook } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatsRow } from "@/components/admin/AdminStatsRow";
import { AdminFilterBar } from "@/components/admin/AdminFilterBar";
import { AdminTable } from "@/components/admin/AdminTable";
import { StatusPill } from "@/components/admin/StatusPill";

interface WebhookRow {
  id: string;
  shop_id: string | null;
  event_id: string;
  topic: string;
  shopify_object_id: string | null;
  received_at: string;
  processed_at: string | null;
  outcome: string | null;
  error_message: string | null;
  processing_ms: number | null;
}

interface Aggregate {
  total: number;
  byOutcome: Record<string, number>;
  byTopic: Record<string, number>;
  p50: number | null;
  p95: number | null;
  cronOnlyReconciliations: number;
}

const OUTCOME_FILTERS: Array<{ label: string; value: string }> = [
  { label: "All", value: "all" },
  { label: "Applied", value: "applied" },
  { label: "Skipped (unchanged)", value: "skipped_unchanged" },
  { label: "Duplicate", value: "duplicate_event" },
  { label: "Error", value: "error" },
  { label: "Schema-validation", value: "error_schema_validation" },
];

export default function AdminWebhooksPage() {
  const [rows, setRows] = useState<WebhookRow[]>([]);
  const [agg, setAgg] = useState<Aggregate | null>(null);
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [topicFilter, setTopicFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (outcomeFilter !== "all") params.set("outcome", outcomeFilter);
    if (topicFilter !== "all") params.set("topic", topicFilter);
    if (search) params.set("q", search);
    params.set("limit", "100");

    const [rowsRes, aggRes] = await Promise.all([
      fetch(`/api/admin/webhooks?${params}`),
      fetch(`/api/admin/webhooks?aggregate=1`),
    ]);
    const rowsJson = await rowsRes.json();
    setRows(rowsJson.rows ?? []);
    setAgg(await aggRes.json());
    setLoading(false);
  }, [outcomeFilter, topicFilter, search]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <div className="p-8">
      <AdminPageHeader
        title="Webhook Deliveries"
        subtitle="Shopify dispute webhooks — Layer A delivery health (24h)"
        icon={Webhook}
      />

      <AdminStatsRow
        cards={[
          { label: "Total (24h)", value: agg?.total ?? 0, valueColor: "text-[#0F172A]" },
          {
            label: "Applied",
            value: agg?.byOutcome?.applied ?? 0,
            valueColor: "text-[#22C55E]",
          },
          {
            label: "Errors",
            value:
              (agg?.byOutcome?.error ?? 0) +
              (agg?.byOutcome?.error_schema_validation ?? 0),
            valueColor: "text-[#EF4444]",
          },
          {
            label: "Duplicates",
            value: agg?.byOutcome?.duplicate_event ?? 0,
            valueColor: "text-[#64748B]",
          },
          {
            label: "p50 latency",
            value: agg?.p50 != null ? `${agg.p50}ms` : "—",
            valueColor: "text-[#0F172A]",
          },
          {
            label: "p95 latency",
            value: agg?.p95 != null ? `${agg.p95}ms` : "—",
            valueColor: "text-[#0F172A]",
          },
          {
            label: "Cron-only catch-ups",
            value: agg?.cronOnlyReconciliations ?? 0,
            valueColor:
              (agg?.cronOnlyReconciliations ?? 0) > 0
                ? "text-[#EF4444]"
                : "text-[#22C55E]",
          },
        ]}
      />

      <div className="my-4 flex items-center gap-4">
        <AdminFilterBar
          filters={OUTCOME_FILTERS}
          activeFilter={outcomeFilter}
          onFilterChange={setOutcomeFilter}
        />
        <AdminFilterBar
          filters={[
            { label: "All topics", value: "all" },
            { label: "disputes/create", value: "disputes/create" },
            { label: "disputes/update", value: "disputes/update" },
          ]}
          activeFilter={topicFilter}
          onFilterChange={setTopicFilter}
        />
        <input
          type="text"
          placeholder="Search by Shopify object id…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-sm focus:border-[#3B82F6] focus:outline-none"
        />
      </div>

      <AdminTable
        headers={[
          "Received",
          "Topic",
          "Shopify Object",
          "Outcome",
          "Latency",
          "Error",
        ]}
        loading={loading}
        isEmpty={!loading && rows.length === 0}
        emptyTitle="No webhook deliveries"
        emptyMessage="Adjust the filters above or wait for the next Shopify delivery."
      >
        {rows.map((r) => (
          <tr key={r.id} className="transition-colors hover:bg-[#F8FAFC]">
            <td className="px-6 py-4 text-sm text-[#64748B]" title={r.received_at}>
              {new Date(r.received_at).toLocaleString()}
            </td>
            <td className="px-6 py-4 font-mono text-sm text-[#0F172A]">{r.topic}</td>
            <td className="px-6 py-4 font-mono text-xs text-[#475569]">
              {r.shopify_object_id ?? "—"}
            </td>
            <td className="px-6 py-4">
              <StatusPill status={r.outcome ?? "pending"} />
            </td>
            <td className="px-6 py-4 text-sm text-[#64748B]">
              {r.processing_ms != null
                ? `${r.processing_ms}ms`
                : r.processed_at == null
                  ? "in-flight"
                  : "—"}
            </td>
            <td className="px-6 py-4 max-w-md text-sm text-[#EF4444] truncate" title={r.error_message ?? ""}>
              {r.error_message ?? "—"}
            </td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
