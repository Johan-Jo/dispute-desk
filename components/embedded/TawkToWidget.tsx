"use client";

import { useState, useCallback } from "react";
import { useLocale } from "next-intl";

/**
 * Tawk.to live chat for the embedded Shopify app.
 *
 * Tawk.to's widget script detects iframe contexts and won't initialize.
 * Workaround: load /api/chat (a lightweight HTML page on our own domain)
 * in a sub-iframe. That page sets Tawk_API.language from the ?lang= param
 * and loads the Tawk.to script. From Tawk.to's perspective it's a regular
 * page, so the widget renders normally in the merchant's language.
 */
export function TawkToWidget() {
  const locale = useLocale();
  const lang = locale.split("-")[0];
  const chatUrl = `/api/chat?lang=${lang}`;
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <>
      {/* Chat iframe — lazy-loaded on first open */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 76,
            right: 20,
            width: 380,
            height: 520,
            zIndex: 10000,
            borderRadius: 12,
            overflow: "hidden",
            background: "#fff",
            border: "1px solid #E5E7EB",
            boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
          }}
        >
          <iframe
            src={chatUrl}
            style={{
              width: "100%",
              height: "100%",
              border: "none",
            }}
            allow="microphone; camera"
            title="Live Chat"
          />
        </div>
      )}

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
