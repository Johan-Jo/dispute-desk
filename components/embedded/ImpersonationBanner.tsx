"use client";

import { useCallback, useState } from "react";

/**
 * Sticky, unmissable banner shown at the top of the embedded app while a
 * SuperAdmin is impersonating a merchant ("View as merchant"). Rendered only
 * when the middleware set `x-dd-impersonation-mode` — the embedded shell passes
 * that state down as props (see app/(embedded)/layout.tsx).
 *
 * The server (middleware) is the source of truth for read/write enforcement;
 * this banner is the human-visible signal + the exit control.
 */
export function ImpersonationBanner({
  shopDomain,
  mode,
}: {
  shopDomain: string;
  mode: "read" | "write";
}) {
  const [exiting, setExiting] = useState(false);
  const isWrite = mode === "write";

  const exit = useCallback(async () => {
    setExiting(true);
    try {
      await fetch("/api/admin/impersonate", { method: "DELETE" });
    } catch {
      /* ignore — navigate away regardless */
    }
    // Leave the embedded surface entirely and return to the admin shops list.
    window.location.href = "/admin/shops";
  }, []);

  return (
    <div
      role="alert"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 2147483647,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 16px",
        fontSize: 13,
        fontWeight: 600,
        color: "#fff",
        background: isWrite ? "#B91C1C" : "#1D4ED8",
        borderBottom: isWrite ? "2px solid #7F1D1D" : "2px solid #1E3A8A",
      }}
    >
      <span>
        Viewing <span style={{ textDecoration: "underline" }}>{shopDomain}</span>{" "}
        as admin — {isWrite ? "WRITE ENABLED" : "READ ONLY"}
      </span>
      <button
        type="button"
        onClick={exit}
        disabled={exiting}
        style={{
          flexShrink: 0,
          padding: "4px 12px",
          fontSize: 12,
          fontWeight: 700,
          color: isWrite ? "#B91C1C" : "#1D4ED8",
          background: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: exiting ? "default" : "pointer",
          opacity: exiting ? 0.7 : 1,
        }}
      >
        {exiting ? "Exiting…" : "Exit impersonation"}
      </button>
    </div>
  );
}
