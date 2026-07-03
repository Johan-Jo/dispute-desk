"use client";

import { useState } from "react";
import { Eye } from "lucide-react";

/**
 * SuperAdmin "View as merchant" control. Mints an impersonation cookie via
 * POST /api/admin/impersonate (grant-gated) and opens the real embedded app
 * in a NEW top-level tab — not inside the admin iframe — so there's no nested
 * App Bridge confusion. Read-only is the default; the caller can flip the
 * selector to enable write access.
 */
export function ViewAsMerchant({
  shopId,
  variant = "compact",
}: {
  shopId: string;
  /** "compact" = row action (icon + selector); "prominent" = detail-page header button. */
  variant?: "compact" | "prominent";
}) {
  const [mode, setMode] = useState<"read" | "write">("read");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopId, mode }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.targetUrl) {
        setError(data?.error ?? "Could not start impersonation.");
        setLoading(false);
        return;
      }
      // New top-level tab: real embedded UI, no Shopify Admin iframe.
      window.open(data.targetUrl, "_blank", "noopener");
      setLoading(false);
    } catch {
      setError("Could not start impersonation.");
      setLoading(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <div className="inline-flex items-center gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "read" | "write")}
          aria-label="Impersonation mode"
          className="text-xs font-semibold text-[#334155] border border-[#CBD5E1] rounded-md px-2 py-1.5 bg-white"
        >
          <option value="read">Read only</option>
          <option value="write">Write access</option>
        </select>
        <button
          type="button"
          onClick={open}
          disabled={loading}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
            mode === "write"
              ? "bg-[#FEF2F2] text-[#B91C1C] hover:bg-[#FEE2E2]"
              : "bg-[#F1F5F9] text-[#334155] hover:bg-[#E2E8F0]"
          } ${variant === "prominent" ? "" : ""}`}
        >
          <Eye className="w-3.5 h-3.5" />
          {loading ? "Opening…" : "View as merchant"}
        </button>
      </div>
      {error ? <span className="text-xs text-[#B91C1C]">{error}</span> : null}
    </div>
  );
}
