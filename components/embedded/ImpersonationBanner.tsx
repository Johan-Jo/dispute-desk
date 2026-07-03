"use client";

import { useCallback, useState } from "react";

export interface ImpersonationNavItem {
  href: string;
  label: string;
}

/**
 * Sticky, unmissable banner shown at the top of the embedded app while a
 * SuperAdmin is impersonating a merchant ("View as merchant"). Rendered only
 * when the middleware set `x-dd-impersonation-mode` — the embedded shell passes
 * that state down as props (see app/(embedded)/layout.tsx).
 *
 * Because impersonation runs in a plain top-level tab (no Shopify Admin iframe),
 * App Bridge never initializes and `<s-app-nav>` doesn't upgrade — the merchant
 * nav would otherwise render as raw unstyled text. So this component ALSO renders
 * a real fallback nav strip (plain <a> links) beneath the banner, giving the
 * admin working navigation. The nav items come from the server layout so labels
 * stay i18n-correct.
 *
 * The server (middleware) is the source of truth for read/write enforcement;
 * this banner is the human-visible signal + the exit control.
 */
export function ImpersonationBanner({
  shopDomain,
  mode,
  navItems = [],
}: {
  shopDomain: string;
  mode: "read" | "write";
  navItems?: ImpersonationNavItem[];
}) {
  const [exiting, setExiting] = useState(false);
  const isWrite = mode === "write";
  const accent = isWrite ? "#B91C1C" : "#1D4ED8";

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
    <div style={{ position: "sticky", top: 0, zIndex: 2147483647 }}>
      <div
        role="alert"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "8px 16px",
          fontSize: 13,
          fontWeight: 600,
          color: "#fff",
          background: accent,
          borderBottom: isWrite ? "2px solid #7F1D1D" : "2px solid #1E3A8A",
        }}
      >
        <span>
          Viewing{" "}
          <span style={{ textDecoration: "underline" }}>{shopDomain}</span> as
          admin — {isWrite ? "WRITE ENABLED" : "READ ONLY"}
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
            color: accent,
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

      {navItems.length > 0 ? (
        <nav
          aria-label="Merchant app navigation (admin preview)"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            padding: "6px 12px",
            background: "#fff",
            borderBottom: "1px solid #E2E8F0",
          }}
        >
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              style={{
                padding: "5px 10px",
                fontSize: 13,
                fontWeight: 500,
                color: "#334155",
                textDecoration: "none",
                borderRadius: 6,
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
