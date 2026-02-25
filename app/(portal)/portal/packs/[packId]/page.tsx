"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Upload,
  Clock,
  Shield,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoBanner } from "@/components/ui/info-banner";

interface ChecklistItem {
  field: string;
  label: string;
  required: boolean;
  present: boolean;
}

interface EvidenceItem {
  id: string;
  type: string;
  label: string;
  source: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface AuditEvent {
  id: string;
  event_type: string;
  event_payload: Record<string, unknown>;
  actor_type: string;
  created_at: string;
}

interface PackData {
  id: string;
  shop_id: string;
  dispute_id: string;
  status: string;
  completeness_score: number | null;
  checklist: ChecklistItem[] | null;
  blockers: string[] | null;
  recommended_actions: string[] | null;
  pack_json: Record<string, unknown> | null;
  saved_to_shopify_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  evidence_items: EvidenceItem[];
  audit_events: AuditEvent[];
  active_build_job: { id: string; status: string } | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusConfig(status: string) {
  const map: Record<string, { variant: "success" | "warning" | "danger" | "info" | "default"; label: string }> = {
    saved_to_shopify: { variant: "success", label: "Saved to Shopify" },
    ready: { variant: "info", label: "Ready" },
    blocked: { variant: "danger", label: "Blocked" },
    building: { variant: "info", label: "Building..." },
    queued: { variant: "default", label: "Queued" },
    failed: { variant: "danger", label: "Failed" },
    draft: { variant: "default", label: "Draft" },
  };
  return map[status] ?? { variant: "default" as const, label: status };
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-[#22C55E]";
  if (score >= 50) return "text-[#F59E0B]";
  return "text-[#EF4444]";
}

function scoreBarColor(score: number): string {
  if (score >= 80) return "bg-[#22C55E]";
  if (score >= 50) return "bg-[#F59E0B]";
  return "bg-[#EF4444]";
}

export default function PackPreviewPage() {
  const { packId } = useParams<{ packId: string }>();
  const [pack, setPack] = useState<PackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const fetchPack = useCallback(async () => {
    const res = await fetch(`/api/packs/${packId}`);
    if (res.ok) {
      const data = await res.json();
      setPack(data);
      if (data.status !== "queued" && data.status !== "building") {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }
    setLoading(false);
  }, [packId]);

  useEffect(() => {
    fetchPack();
    pollRef.current = setInterval(fetchPack, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchPack]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      form.append("label", file.name);
      await fetch(`/api/packs/${packId}/upload`, { method: "POST", body: form });
    }
    await fetchPack();
    setUploading(false);
    e.target.value = "";
  };

  const handleApprove = async () => {
    await fetch(`/api/packs/${packId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await fetchPack();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-[#1D4ED8] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!pack) {
    return (
      <div className="text-center py-20">
        <p className="text-[#667085]">Pack not found.</p>
        <a href="/portal/disputes" className="text-[#1D4ED8] hover:underline text-sm mt-2 inline-block">
          Back to disputes
        </a>
      </div>
    );
  }

  const isBuilding = pack.status === "queued" || pack.status === "building";
  const score = pack.completeness_score ?? 0;
  const cfg = statusConfig(pack.status);

  return (
    <div>
      <a
        href={`/portal/disputes/${pack.dispute_id}`}
        className="inline-flex items-center gap-1 text-sm text-[#667085] hover:text-[#0B1220] mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to dispute
      </a>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">
            Evidence Pack {pack.id.slice(0, 8)}
          </h1>
          <p className="text-sm text-[#667085]">
            Created {formatDate(pack.created_at)} by {pack.created_by ?? "system"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={cfg.variant}>{cfg.label}</Badge>
          {pack.status === "ready" && (
            <Button variant="primary" size="sm" onClick={handleApprove}>
              <CheckCircle className="w-4 h-4 mr-1" />
              Approve &amp; Save
            </Button>
          )}
        </div>
      </div>

      {isBuilding && (
        <div className="mb-4">
          <InfoBanner variant="info">
            Building evidence pack... This page refreshes automatically.
          </InfoBanner>
        </div>
      )}

      {/* Score + Blockers */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-[#0B1220]">Completeness Score</h3>
          <span className={`text-2xl font-bold ${scoreColor(score)}`}>{score}%</span>
        </div>
        <div className="w-full h-2 bg-[#E5E7EB] rounded-full overflow-hidden mb-4">
          <div
            className={`h-full rounded-full transition-all ${scoreBarColor(score)}`}
            style={{ width: `${score}%` }}
          />
        </div>

        {pack.blockers && pack.blockers.length > 0 && (
          <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-md p-3 mb-3">
            <p className="text-sm font-medium text-[#DC2626]">
              {pack.blockers.length} blocker(s): {pack.blockers.join(", ")}
            </p>
          </div>
        )}
        {pack.recommended_actions && pack.recommended_actions.length > 0 && (
          <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-md p-3">
            <p className="text-sm text-[#92400E]">
              Recommended: {pack.recommended_actions.join(", ")}
            </p>
          </div>
        )}
      </div>

      {/* Checklist */}
      {pack.checklist && pack.checklist.length > 0 && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 mb-6">
          <h3 className="font-semibold text-[#0B1220] mb-4">Evidence Checklist</h3>
          <div className="space-y-2">
            {pack.checklist.map((item) => (
              <div key={item.field} className="flex items-center gap-3">
                {item.present ? (
                  <CheckCircle className="w-5 h-5 text-[#22C55E] shrink-0" />
                ) : (
                  <XCircle className={`w-5 h-5 shrink-0 ${item.required ? "text-[#EF4444]" : "text-[#94A3B8]"}`} />
                )}
                <span className="text-sm text-[#0B1220]">{item.label}</span>
                {item.required && !item.present && (
                  <Badge variant="danger">required</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Evidence Sections */}
      {pack.evidence_items.length > 0 && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] mb-6">
          <div className="p-5 border-b border-[#E5E7EB]">
            <h3 className="font-semibold text-[#0B1220]">
              Evidence Items ({pack.evidence_items.length})
            </h3>
          </div>
          {pack.evidence_items.map((item) => (
            <div key={item.id} className="border-b border-[#E5E7EB] last:border-0">
              <button
                onClick={() => toggle(item.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-[#F7F8FA] transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="default">{item.type}</Badge>
                  <span className="text-sm font-medium text-[#0B1220]">{item.label}</span>
                </div>
                {expanded.has(item.id) ? (
                  <ChevronUp className="w-4 h-4 text-[#667085]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#667085]" />
                )}
              </button>
              {expanded.has(item.id) && (
                <div className="px-4 pb-4">
                  <pre className="text-xs bg-[#F7F8FA] rounded-md p-3 overflow-auto max-h-64">
                    {JSON.stringify(item.payload, null, 2)}
                  </pre>
                  <p className="text-xs text-[#667085] mt-2">
                    Source: {item.source} · Added {formatDate(item.created_at)}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* File Upload */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 mb-6">
        <h3 className="font-semibold text-[#0B1220] mb-2">Upload Evidence</h3>
        <p className="text-sm text-[#667085] mb-4">
          Add supporting files (images, PDFs, up to 10 MB each).
        </p>
        <label className="flex items-center justify-center border-2 border-dashed border-[#CBD5E1] rounded-lg p-6 cursor-pointer hover:border-[#1D4ED8] transition-colors">
          <input
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv"
            onChange={handleUpload}
            disabled={uploading}
          />
          <div className="text-center">
            <Upload className="w-8 h-8 text-[#94A3B8] mx-auto mb-2" />
            <p className="text-sm text-[#667085]">
              {uploading ? "Uploading..." : "Click to upload or drag files here"}
            </p>
          </div>
        </label>
      </div>

      {/* Audit Log */}
      {pack.audit_events.length > 0 && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 mb-6">
          <h3 className="font-semibold text-[#0B1220] mb-4">Audit Log</h3>
          <div className="space-y-3">
            {pack.audit_events.map((evt) => (
              <div key={evt.id} className="flex items-start gap-3">
                <Clock className="w-4 h-4 text-[#94A3B8] mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm text-[#0B1220]">
                    {evt.event_type.replace(/_/g, " ")}
                    <span className="text-[#667085]"> ({evt.actor_type})</span>
                  </p>
                  <p className="text-xs text-[#667085]">{formatDate(evt.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Compliance */}
      <InfoBanner variant="info">
        <Shield className="w-4 h-4 mr-2 inline" />
        Evidence is saved to Shopify via API. Submission to the card network
        happens in Shopify Admin, or Shopify auto-submits on the due date.
      </InfoBanner>
    </div>
  );
}
