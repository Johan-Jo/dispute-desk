"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";

const TAWK_PROPERTY_ID = "69dc1d426161b11c33210737";
const TAWK_WIDGET_ID = "1jm1t4isv";

/**
 * Tawk.to live chat widget for the embedded app.
 * Uses useEffect + direct DOM injection instead of next/script to ensure
 * the script fires reliably inside the Shopify Admin iframe.
 */
export function TawkToWidget() {
  const locale = useLocale();
  const lang = locale.split("-")[0];

  useEffect(() => {
    // Avoid double-loading
    if (document.getElementById("tawk-script")) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.Tawk_API = w.Tawk_API || {};
    w.Tawk_API.language = lang;
    w.Tawk_LoadStart = new Date();

    const s = document.createElement("script");
    s.id = "tawk-script";
    s.async = true;
    s.src = `https://embed.tawk.to/${TAWK_PROPERTY_ID}/${TAWK_WIDGET_ID}`;
    s.charset = "UTF-8";
    s.setAttribute("crossorigin", "*");
    document.head.appendChild(s);
  }, [lang]);

  return null;
}
