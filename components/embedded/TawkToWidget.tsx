"use client";

import { useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";

const TAWK_PROPERTY_ID = "69dc1d426161b11c33210737";
const TAWK_WIDGET_ID = "1jm1t4isv";

/**
 * Floating chat button that opens Tawk.to in a popup window.
 * Tawk.to's inline widget cannot render inside Shopify Admin's iframe
 * due to CSP / nested-iframe restrictions, so we open it externally.
 */
export function TawkToWidget() {
  const locale = useLocale();
  const t = useTranslations("embeddedShell");
  const lang = locale.split("-")[0];

  const openChat = useCallback(() => {
    const url = `https://tawk.to/chat/${TAWK_PROPERTY_ID}/${TAWK_WIDGET_ID}`;
    window.open(
      url,
      "tawk_chat",
      "width=400,height=600,scrollbars=yes,resizable=yes"
    );
  }, []);

  return (
    <button
      onClick={openChat}
      aria-label={t("chatWithUs")}
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 9999,
        width: 48,
        height: 48,
        borderRadius: 24,
        border: "none",
        background: "#1C1C1C",
        color: "#fff",
        cursor: "pointer",
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}
