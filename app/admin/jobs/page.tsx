"use client";

import { useState, useEffect, useCallback } from "react";

interface Job {
  id: string;
  job_type: string;
  status: string;
  shop_id: string;
  created_at: string;
  error: string | null;
  stale: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-[#FFF7ED] text-[#C2410C]",
  running: "bg-[#EFF6FF] text-[#1D4ED8]",
  completed: "bg-[#ECFDF5] text-[#059669]",
  failed: "bg-[#FEF2F2] text-[#DC2626]",
  cancelled: "bg-[#F3F4F6] text-[#6B7280]",
};

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter) params.set("status", filter);
    const res = await fetch(`/api/admin/jobs?${params}`);
    setJobs(await res.json());
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const handleAction = async (jobId: string, action: string) => {
    await fetch(`/api/admin/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    fetchJobs();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#0B1220] mb-6">Job Monitor</h1>

      <div className="flex gap-2 mb-4">
        {["", "queued", "running", "failed", "completed"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 text-sm rounded-lg border ${
              filter === s ? "bg-[#0B1220] text-white border-[#0B1220]" : "bg-white text-[#667085] border-[#E5E7EB] hover:bg-[#F7F8FA]"
            }`}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#F7F8FA]">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Type</th>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Status</th>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Created</th>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Error</th>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[#667085]">Loading...</td></tr>
            ) : jobs.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[#667085]">No jobs found</td></tr>
            ) : jobs.map((j) => (
              <tr key={j.id} className={`border-t border-[#E5E7EB] ${j.stale ? "bg-[#FFFBEB]" : "hover:bg-[#F7F8FA]"}`}>
                <td className="px-4 py-3 font-mono text-xs">{j.job_type}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[j.status] ?? ""}`}>
                    {j.status}
                    {j.stale && " ⚠️ stale"}
                  </span>
                </td>
                <td className="px-4 py-3 text-[#667085]">{new Date(j.created_at).toLocaleString()}</td>
                <td className="px-4 py-3 text-xs text-[#DC2626] max-w-xs truncate">{j.error ?? "—"}</td>
                <td className="px-4 py-3">
                  {j.status === "failed" && (
                    <button onClick={() => handleAction(j.id, "retry")} className="text-xs text-[#1D4ED8] hover:underline mr-2">
                      Retry
                    </button>
                  )}
                  {(j.status === "queued" || j.status === "running") && (
                    <button onClick={() => handleAction(j.id, "cancel")} className="text-xs text-[#DC2626] hover:underline">
                      Cancel
                    </button>
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
