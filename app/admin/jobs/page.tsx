"use client";

import { useState, useEffect, useCallback } from "react";
import { Cog } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatsRow } from "@/components/admin/AdminStatsRow";
import { AdminFilterBar } from "@/components/admin/AdminFilterBar";
import { AdminTable } from "@/components/admin/AdminTable";
import { StatusPill } from "@/components/admin/StatusPill";

interface Job {
  id: string;
  job_type: string;
  status: string;
  shop_id: string;
  created_at: string;
  error: string | null;
  stale: boolean;
}

interface JobTotals {
  queued: number;
  running: number;
  failed: number;
  succeeded: number;
}

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [totals, setTotals] = useState<JobTotals>({ queued: 0, running: 0, failed: 0, succeeded: 0 });
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    const [jobsRes, metricsRes] = await Promise.all([
      fetch(`/api/admin/jobs?${params}`),
      fetch(`/api/admin/metrics`),
    ]);
    setJobs(await jobsRes.json());
    const metrics = await metricsRes.json();
    if (metrics?.jobs) setTotals(metrics.jobs);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const handleAction = async (jobId: string, action: string) => {
    await fetch(`/api/admin/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    fetchJobs();
  };

  const counts = totals;

  return (
    <div className="p-8">
      <AdminPageHeader
        title="Job Monitor"
        subtitle="Background job operations and health"
        icon={Cog}
      />

      <AdminStatsRow
        cards={[
          { label: "Queued", value: counts.queued, valueColor: "text-[#3B82F6]" },
          { label: "Running", value: counts.running, valueColor: "text-[#3B82F6]" },
          { label: "Failed", value: counts.failed, valueColor: "text-[#EF4444]" },
          { label: "Succeeded", value: counts.succeeded, valueColor: "text-[#22C55E]" },
        ]}
      />

      <AdminFilterBar
        filters={[
          { label: "All", value: "all" },
          { label: "Queued", value: "queued" },
          { label: "Running", value: "running" },
          { label: "Failed", value: "failed" },
          { label: "Succeeded", value: "succeeded" },
        ]}
        activeFilter={filter}
        onFilterChange={setFilter}
      />

      <AdminTable
        headers={["Type", "Status", "Created", "Error", "Actions"]}
        headerAlign={{ 4: "right" }}
        loading={loading}
        isEmpty={!loading && jobs.length === 0}
        emptyTitle="No jobs found"
        emptyMessage="Try adjusting your status filter"
      >
        {jobs.map((j) => (
          <tr
            key={j.id}
            className={`transition-colors ${j.stale ? "bg-[#FEF3C7]/40" : "hover:bg-[#F8FAFC]"}`}
          >
            <td className="px-6 py-4">
              <span className="text-sm font-mono text-[#64748B]">{j.job_type}</span>
            </td>
            <td className="px-6 py-4">
              <div className="flex items-center gap-2">
                <StatusPill status={j.status} />
                {j.stale && (
                  <span className="px-2 py-0.5 bg-[#FEF3C7] text-[#92400E] text-xs font-semibold rounded">
                    Stale
                  </span>
                )}
              </div>
            </td>
            <td className="px-6 py-4">
              <span className="text-sm text-[#64748B]">
                {new Date(j.created_at).toLocaleString()}
              </span>
            </td>
            <td className="px-6 py-4">
              <span className="text-sm text-[#EF4444] max-w-xs truncate block">
                {j.error ?? "—"}
              </span>
            </td>
            <td className="px-6 py-4 text-right">
              <div className="flex items-center justify-end gap-2">
                {j.status === "failed" && (
                  <button
                    onClick={() => handleAction(j.id, "retry")}
                    className="px-3 py-1.5 bg-[#EFF6FF] text-[#1D4ED8] text-sm font-semibold rounded-lg hover:bg-[#DBEAFE] transition-colors"
                  >
                    Retry
                  </button>
                )}
                {(j.status === "queued" || j.status === "running") && (
                  <button
                    onClick={() => handleAction(j.id, "cancel")}
                    className="px-3 py-1.5 bg-[#FEE2E2] text-[#991B1B] text-sm font-semibold rounded-lg hover:bg-[#FECACA] transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
