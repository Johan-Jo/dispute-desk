"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  RefreshCw,
  Shield,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Clock,
} from "lucide-react";

interface TimelineEvent {
  id: string;
  event_type: string;
  description: string | null;
  event_at: string;
  actor_type: string;
  source_type: string;
  visibility: string;
  metadata_json: Record<string, unknown>;
  dedupe_key: string | null;
}

interface Summary {
  normalizedStatus: string | null;
  statusReason: string | null;
  submissionState: string | null;
  finalOutcome: string | null;
  submittedAt: string | null;
  closedAt: string | null;
  amount: number | null;
  currencyCode: string | null;
  needsAttention: boolean;
  syncHealth: string;
}

interface Note {
  id: string;
  note_body: string;
  author_type: string;
  author_ref: string | null;
  visibility: string;
  created_at: string;
}

const DOT_COLORS: Record<string, string> = {
  dispute_opened: "bg-blue-500",
  pack_created: "bg-blue-500",
  evidence_saved_to_shopify: "bg-green-500",
  submission_confirmed: "bg-green-500",
  outcome_detected: "bg-green-500",
  dispute_closed: "bg-gray-500",
  status_changed: "bg-blue-500",
  pack_blocked: "bg-amber-500",
  parked_for_review: "bg-amber-500",
  sync_failed: "bg-red-500",
  pack_build_failed: "bg-red-500",
  evidence_save_failed: "bg-red-500",
  admin_override: "bg-purple-500",
  support_note_added: "bg-indigo-500",
  dispute_resynced: "bg-teal-500",
};

export default function AdminDisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [resyncing, setResyncing] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  // Override form
  const [overrideField, setOverrideField] = useState("final_outcome");
  const [overrideValue, setOverrideValue] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [timelineRes, notesRes] = await Promise.all([
        fetch(`/api/disputes/${id}/timeline`),
        fetch(`/api/disputes/${id}/notes`),
      ]);
      if (timelineRes.ok) {
        const data = await timelineRes.json();
        setEvents(data.events ?? []);
        setSummary(data.summary ?? null);
      }
      if (notesRes.ok) {
        const data = await notesRes.json();
        setNotes(data.notes ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleResync = async () => {
    setResyncing(true);
    try {
      await fetch(`/api/disputes/${id}/resync`, { method: "POST" });
      await fetchAll();
    } finally {
      setResyncing(false);
    }
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    await fetch(`/api/disputes/${id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noteBody: noteText.trim() }),
    });
    setNoteText("");
    await fetchAll();
  };

  const handleOverride = async () => {
    if (!overrideValue || !overrideReason) return;
    await fetch(`/api/admin/disputes/${id}/override`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        field: overrideField,
        value: overrideValue,
        reason: overrideReason,
      }),
    });
    setOverrideValue("");
    setOverrideReason("");
    await fetchAll();
  };

  if (loading) {
    return <div className="p-12 text-center text-[#64748B]">Loading...</div>;
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin/disputes" className="text-[#64748B] hover:text-[#0F172A]">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[#0F172A]">Dispute Detail</h1>
          <p className="text-sm text-[#64748B] font-mono">{id}</p>
        </div>
        <button
          onClick={handleResync}
          disabled={resyncing}
          className="flex items-center gap-2 px-4 py-2 bg-[#1D4ED8] text-white rounded-lg text-sm font-medium hover:bg-[#1E40AF] disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${resyncing ? "animate-spin" : ""}`} />
          Resync
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Timeline + Summary */}
        <div className="lg:col-span-2 space-y-6">
          {/* Summary card */}
          {summary && (
            <div className="bg-white rounded-xl border border-[#E2E8F0] p-6">
              <h2 className="text-lg font-semibold text-[#0F172A] mb-4">Summary</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-[#64748B]">Status</p>
                  <p className="text-sm font-medium text-[#0F172A]">
                    {summary.normalizedStatus?.replace(/_/g, " ") ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#64748B]">Submission</p>
                  <p className="text-sm font-medium text-[#0F172A]">
                    {summary.submissionState?.replace(/_/g, " ") ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#64748B]">Outcome</p>
                  <p className="text-sm font-medium text-[#0F172A]">
                    {summary.finalOutcome ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#64748B]">Amount</p>
                  <p className="text-sm font-medium text-[#0F172A]">
                    {summary.amount != null
                      ? new Intl.NumberFormat("en-US", { style: "currency", currency: summary.currencyCode ?? "USD" }).format(summary.amount)
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#64748B]">Submitted At</p>
                  <p className="text-sm text-[#0F172A]">
                    {summary.submittedAt ? new Date(summary.submittedAt).toLocaleDateString() : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#64748B]">Closed At</p>
                  <p className="text-sm text-[#0F172A]">
                    {summary.closedAt ? new Date(summary.closedAt).toLocaleDateString() : "—"}
                  </p>
                </div>
              </div>
              {summary.needsAttention && (
                <div className="mt-4 flex items-center gap-2 text-amber-600 text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  Needs attention — {summary.statusReason}
                </div>
              )}
            </div>
          )}

          {/* Timeline */}
          <div className="bg-white rounded-xl border border-[#E2E8F0] p-6">
            <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
              Timeline ({events.length} events)
            </h2>
            {events.length === 0 ? (
              <p className="text-sm text-[#64748B]">No events.</p>
            ) : (
              <div className="space-y-0">
                {events.map((e) => {
                  const isInternal = e.visibility === "internal_only";
                  const isExpanded = expandedEvent === e.id;
                  return (
                    <div key={e.id} className="flex gap-3 pb-4">
                      <div className="flex flex-col items-center">
                        <div className={`w-2.5 h-2.5 rounded-full mt-1.5 ${DOT_COLORS[e.event_type] ?? "bg-gray-400"}`} />
                        <div className="w-px flex-1 bg-[#E2E8F0]" />
                      </div>
                      <div className="flex-1 min-w-0 pb-2">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-[#0F172A]">
                            {e.event_type.replace(/_/g, " ")}
                          </p>
                          {isInternal && (
                            <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-[10px] rounded font-medium">
                              INTERNAL
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
                          <Clock className="w-3 h-3" />
                          {new Date(e.event_at).toLocaleString()}
                          <span>·</span>
                          <span>{e.actor_type.replace(/_/g, " ")}</span>
                        </div>
                        {e.description && (
                          <p className="text-sm text-[#64748B] mt-1">{e.description}</p>
                        )}
                        {/* Expandable metadata */}
                        {Object.keys(e.metadata_json).length > 0 && (
                          <button
                            onClick={() => setExpandedEvent(isExpanded ? null : e.id)}
                            className="mt-1 text-xs text-[#1D4ED8] hover:underline flex items-center gap-1"
                          >
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            {isExpanded ? "Hide" : "Show"} metadata
                          </button>
                        )}
                        {isExpanded && (
                          <pre className="mt-2 p-3 bg-[#F8FAFC] rounded-lg text-xs text-[#334155] overflow-x-auto">
                            {JSON.stringify(e.metadata_json, null, 2)}
                            {e.dedupe_key && `\n\ndedupe_key: ${e.dedupe_key}`}
                          </pre>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: Notes + Override */}
        <div className="space-y-6">
          {/* Notes */}
          <div className="bg-white rounded-xl border border-[#E2E8F0] p-6">
            <h2 className="text-lg font-semibold text-[#0F172A] mb-4 flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              Support Notes ({notes.length})
            </h2>
            <div className="space-y-3 mb-4 max-h-[300px] overflow-y-auto">
              {notes.map((n) => (
                <div key={n.id} className="p-3 bg-[#F8FAFC] rounded-lg">
                  <p className="text-sm text-[#0F172A]">{n.note_body}</p>
                  <p className="text-xs text-[#94A3B8] mt-1">
                    {n.author_type} · {n.author_ref ?? "—"} · {new Date(n.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
              {notes.length === 0 && (
                <p className="text-sm text-[#94A3B8]">No notes yet.</p>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note..."
                className="flex-1 px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm"
                onKeyDown={(e) => { if (e.key === "Enter") handleAddNote(); }}
              />
              <button
                onClick={handleAddNote}
                disabled={!noteText.trim()}
                className="px-4 py-2 bg-[#1D4ED8] text-white rounded-lg text-sm font-medium hover:bg-[#1E40AF] disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {/* Override */}
          <div className="bg-white rounded-xl border border-[#E2E8F0] p-6">
            <h2 className="text-lg font-semibold text-[#0F172A] mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Override
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-[#64748B]">Field</label>
                <select
                  value={overrideField}
                  onChange={(e) => setOverrideField(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm mt-1"
                >
                  <option value="final_outcome">Final Outcome</option>
                  <option value="submission_state">Submission State</option>
                  <option value="submitted_at">Submitted At</option>
                  <option value="closed_at">Closed At</option>
                  <option value="needs_attention">Needs Attention</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[#64748B]">Value</label>
                <input
                  type="text"
                  value={overrideValue}
                  onChange={(e) => setOverrideValue(e.target.value)}
                  placeholder="e.g. won, submitted_confirmed, 2026-04-13"
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#64748B]">Reason</label>
                <input
                  type="text"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Why this override is needed"
                  className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm mt-1"
                />
              </div>
              <button
                onClick={handleOverride}
                disabled={!overrideValue || !overrideReason}
                className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
              >
                Apply Override
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
