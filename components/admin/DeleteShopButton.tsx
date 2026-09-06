"use client";

/**
 * Permanently purge a shop from the admin Shops list.
 *
 * This is a real delete, not an uninstall flag — every row belonging to the
 * shop goes, and the merchant has to install the app again. Nothing is
 * recoverable, so the dialog makes the caller TYPE the shop's myshopify
 * domain: the list is full of near-identical names (`6mjjvm-tc`, `xxda51-v1`,
 * `isj-153`), and a plain "Are you sure?" on a row you might have mis-clicked
 * is not a real check. The typed value is also what the API requires as
 * `?confirm=`, so the guard is enforced server-side too, not just here.
 */

import { useState } from "react";
import { Trash2 } from "lucide-react";

interface Props {
  shopId: string;
  /** The myshopify alias — what the user must type, and what the API checks. */
  shopDomain: string;
  /** Real storefront domain, shown for recognition when it differs. */
  displayName?: string;
  disputeCount: number;
  packCount: number;
  onDeleted: () => void;
}

export function DeleteShopButton({
  shopId,
  shopDomain,
  displayName,
  disputeCount,
  packCount,
  onDeleted,
}: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = typed.trim() === shopDomain;

  async function handleDelete() {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/shops/${shopId}?confirm=${encodeURIComponent(shopDomain)}`,
        { method: "DELETE" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail ?? body.error ?? `Failed (${res.status})`);
        setBusy(false);
        return;
      }
      setOpen(false);
      setTyped("");
      setBusy(false);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      setBusy(false);
    }
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setTyped("");
    setError(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Delete shop permanently"
        aria-label={`Delete ${shopDomain}`}
        className="inline-flex items-center justify-center p-2 text-[#94A3B8] rounded-lg hover:bg-[#FEE2E2] hover:text-[#B91C1C] transition-colors"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={close}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-[#0F172A] mb-1">Delete this shop?</h2>
            <p className="text-sm text-[#475569] mb-4">
              {displayName && displayName !== shopDomain ? (
                <>
                  <span className="font-semibold text-[#0F172A]">{displayName}</span>{" "}
                  <span className="text-[#94A3B8]">({shopDomain})</span>
                </>
              ) : (
                <span className="font-semibold text-[#0F172A]">{shopDomain}</span>
              )}
            </p>

            <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-lg p-3 mb-4">
              <p className="text-sm text-[#991B1B] font-semibold mb-1">
                This cannot be undone.
              </p>
              <p className="text-sm text-[#B91C1C]">
                Permanently deletes {disputeCount} dispute{disputeCount === 1 ? "" : "s"},{" "}
                {packCount} pack{packCount === 1 ? "" : "s"}, and all sessions, jobs,
                orders and audit history. The merchant must install the app again.
              </p>
            </div>

            <label className="block text-sm text-[#475569] mb-2">
              Type <span className="font-mono font-semibold text-[#0F172A]">{shopDomain}</span> to
              confirm:
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm font-mono mb-4 focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/30"
            />

            {error && (
              <p className="text-sm text-[#B91C1C] mb-3" role="alert">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="px-4 py-2 border border-[#E2E8F0] text-[#0F172A] text-sm font-semibold rounded-lg hover:bg-[#F8FAFC] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!confirmed || busy}
                className="px-4 py-2 bg-[#B91C1C] text-white text-sm font-semibold rounded-lg hover:bg-[#991B1B] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
