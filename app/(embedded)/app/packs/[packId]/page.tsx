"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

interface PackData {
  id: string;
  status: string;
  completeness_score: number | null;
  checklist: { items: unknown[] } | null;
  pack_json: unknown;
  pdf_path: string | null;
  last_saved_to_shopify_at: string | null;
}

interface JobStatus {
  id: string;
  status: string;
  last_error: string | null;
}

/**
 * Pack preview page with job-based polling.
 *
 * After "Generate Pack" or "Render PDF", the UI polls the job endpoint
 * until succeeded/failed, then refreshes pack data.
 */
export default function PackDetailPage() {
  const params = useParams<{ packId: string }>();
  const packId = params.packId;

  const [pack, setPack] = useState<PackData | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPack = useCallback(async () => {
    const res = await fetch(`/api/packs/${packId}`);
    if (res.ok) {
      setPack(await res.json());
    }
  }, [packId]);

  useEffect(() => {
    if (!activeJobId) return;

    const interval = setInterval(async () => {
      const res = await fetch(`/api/jobs/${activeJobId}`);
      if (!res.ok) return;
      const job: JobStatus = await res.json();
      setJobStatus(job);

      if (job.status === "succeeded" || job.status === "failed") {
        clearInterval(interval);
        setActiveJobId(null);
        if (job.status === "failed") {
          setError(job.last_error ?? "Job failed");
        }
        await fetchPack();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [activeJobId, fetchPack]);

  useEffect(() => {
    fetchPack();
  }, [fetchPack]);

  const handleRenderPdf = async () => {
    setError(null);
    const res = await fetch(`/api/packs/${packId}/render-pdf`, {
      method: "POST",
    });
    if (res.ok) {
      const { jobId } = await res.json();
      setActiveJobId(jobId);
      setJobStatus({ id: jobId, status: "queued", last_error: null });
    } else {
      setError("Failed to start PDF render");
    }
  };

  const handleDownload = async () => {
    const res = await fetch(`/api/packs/${packId}/download`);
    if (res.ok) {
      const { url } = await res.json();
      window.open(url, "_blank");
    }
  };

  if (!pack) return <div>Loading pack...</div>;

  const isBuilding = pack.status === "queued" || pack.status === "building";
  const isJobRunning = activeJobId !== null;

  return (
    <div style={{ padding: "1rem" }}>
      <h1>Evidence Pack</h1>
      <p>Status: {pack.status}</p>

      {isBuilding && <p>Building evidence pack...</p>}

      {pack.completeness_score !== null && (
        <p>Completeness: {pack.completeness_score}%</p>
      )}

      {error && (
        <div style={{ color: "red", margin: "1rem 0" }}>Error: {error}</div>
      )}

      {isJobRunning && jobStatus && (
        <p>
          Job: {jobStatus.status}
          {jobStatus.status === "running" && " (processing...)"}
        </p>
      )}

      {pack.status === "ready" && !pack.pdf_path && (
        <button onClick={handleRenderPdf} disabled={isJobRunning}>
          {isJobRunning ? "Rendering PDF..." : "Render PDF"}
        </button>
      )}

      {pack.pdf_path && (
        <button onClick={handleDownload}>Download PDF</button>
      )}

      {pack.status === "ready" && (
        <p style={{ marginTop: "1rem", fontSize: "0.875rem" }}>
          When ready, open Shopify Admin to review and finalize your dispute
          response. Shopify will handle submission by the due date.
        </p>
      )}
    </div>
  );
}
