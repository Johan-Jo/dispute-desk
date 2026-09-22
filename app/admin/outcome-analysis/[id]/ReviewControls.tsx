"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Review controls (plan §15.5).
 *
 * Confirm / Edit / Reject / Indeterminate, append-only. The note field is
 * REQUIRED for Edit and Reject and the button stays disabled without one —
 * the same rule the API and a database check constraint both enforce. Three
 * layers sounds excessive for a text box, but this note is the only record of
 * why a reviewer disagreed with the analyzer, and a rejection with no reason
 * is indistinguishable afterwards from a mis-click.
 */

const DISPOSITIONS = [
  { value: "CONFIRMED", label: "Confirm", needsNote: false },
  { value: "EDITED", label: "Edit", needsNote: true },
  { value: "REJECTED", label: "Reject", needsNote: true },
  { value: "INDETERMINATE", label: "Indeterminate", needsNote: false },
] as const;

export function ReviewControls({
  analysisId,
  currentState,
  reviewCount,
}: {
  analysisId: string;
  currentState: string;
  reviewCount: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>("CONFIRMED");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsNote = DISPOSITIONS.find((d) => d.value === selected)?.needsNote ?? false;
  const blocked = busy || (needsNote && notes.trim().length === 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/outcome-analysis/${analysisId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disposition: selected, notes: notes.trim() || null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Review failed (${res.status})`);
        return;
      }
      setNotes("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-[#E5E7EB] bg-white p-4">
      <h2 className="font-semibold text-[#0F172A] mb-1">Review</h2>
      <p className="text-xs text-[#64748B] mb-3">
        Current state: <strong>{currentState}</strong>
        {reviewCount > 0 ? ` · ${reviewCount} decision(s) recorded` : " · not yet reviewed"}.
        Reviews are append-only; an earlier decision is never overwritten.
      </p>

      <div className="flex flex-wrap gap-2 mb-3">
        {DISPOSITIONS.map((d) => (
          <button
            key={d.value}
            type="button"
            onClick={() => setSelected(d.value)}
            className={`px-3 py-1.5 rounded border text-sm ${
              selected === d.value
                ? "border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]"
                : "border-[#E5E7EB] text-[#334155] hover:bg-[#F8FAFC]"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder={
          needsNote
            ? "Required — why does this finding need changing or rejecting?"
            : "Optional note"
        }
        className="w-full text-sm border border-[#E5E7EB] rounded px-3 py-2"
      />

      {error && <p className="text-sm text-[#B91C1C] mt-2">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={blocked}
        className="mt-3 px-4 py-2 rounded bg-[#0F172A] text-white text-sm disabled:opacity-40"
      >
        {busy ? "Recording…" : "Record review"}
      </button>
      {needsNote && notes.trim().length === 0 && (
        <span className="ml-3 text-xs text-[#64748B]">
          A note is required to {selected === "EDITED" ? "edit" : "reject"}.
        </span>
      )}
    </section>
  );
}
