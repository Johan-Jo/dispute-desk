"use client";

import { useEffect } from "react";
import {
  hasMetaConsent,
  loadMetaPixel,
  META_CONSENT_EVENT,
} from "@/lib/analytics/metaPixel";

/**
 * Meta Pixel for the marketing/portal surfaces. Loads only after the visitor accepted
 * analytics in the cookie bar (now or on a previous visit). Never mounted on the embedded app.
 */
export function MetaPixel() {
  useEffect(() => {
    if (hasMetaConsent()) loadMetaPixel();
    const onGrant = () => loadMetaPixel();
    window.addEventListener(META_CONSENT_EVENT, onGrant);
    return () => window.removeEventListener(META_CONSENT_EVENT, onGrant);
  }, []);
  return null;
}
