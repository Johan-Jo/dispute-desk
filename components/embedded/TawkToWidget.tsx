"use client";

import { useEffect, useState, useCallback } from "react";
import { useLocale } from "next-intl";

const TAWK_PROPERTY_ID = "69dc1d426161b11c33210737";
const TAWK_WIDGET_ID = "1jm1t4isv";

/**
 * Tawk.to live chat for the embedded Shopify app.
 *
 * The standard floating widget doesn't appear inside Shopify's iframe because
 * Tawk.to detects the iframe context and suppresses it. Workaround: render
 * the widget in "embedded" mode inside a container div, and toggle visibility
 * with a custom floating button.
 */
export function TawkToWidget() {
  const locale = useLocale();
  const lang = locale.split("-")[0];
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (document.getElementById("tawk-script")) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.Tawk_API = w.Tawk_API || {};
    w.Tawk_API.language = lang;
    w.Tawk_API.embedded = "tawk-container";
    w.Tawk_API.onLoad = () => setLoaded(true);
    w.Tawk_LoadStart = new Date();

    const s = document.createElement("script");
    s.id = "tawk-script";
    s.async = true;
    s.src = `https://embed.tawk.to/${TAWK_PROPERTY_ID}/${TAWK_WIDGET_ID}`;
    s.charset = "UTF-8";
    s.setAttribute("crossorigin", "*");
    document.head.appendChild(s);
  }, [lang]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <>
      {/* Chat container — shown/hidden via the button */}
      <div
        id="tawk-container"
        style={{
          position: "fixed",
          bottom: 76,
          right: 20,
          width: 376,
          height: 500,
          zIndex: 10000,
          borderRadius: 12,
          overflow: "hidden",
          background: "#fff",
          border: "1px solid #E5E7EB",
          boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
          display: open ? "block" : "none",
        }}
      />

      {/* Floating toggle button */}
      <button
        onClick={toggle}
        aria-label="Chat"
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 10001,
          width: 48,
          height: 48,
          borderRadius: 24,
          border: "none",
          background: open ? "#374151" : "#1C1C1C",
          color: "#fff",
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background 200ms",
        }}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M15 5L5 15M5 5l10 10" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>
    </>
  );
}
