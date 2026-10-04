import { CONSENT_COOKIE_NAME, CONSENT_VALUE_ANALYTICS } from "@/lib/consent/constants";
import { sendMetaEvent } from "@/lib/analytics/metaCapi";

/** What the install callback learned about the visitor's browser, from first-party cookies. */
export type MetaAttribution = {
  consented: boolean;
  fbp: string | null;
  fbc: string | null;
  clientIp: string | null;
  userAgent: string | null;
  sourceUrl: string | null;
};

function cookieValue(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Read the Meta click/browser ids and the analytics-consent flag from an install request.
 * The merchant's browser returns to our domain at the end of OAuth, so the cookies the
 * pixel set on disputedesk.app arrive here. Installs that never touched our site (App Store
 * listing → Shopify managed install) carry none, so `consented` is false and nothing is sent.
 */
export function readMetaAttribution(req: Request): MetaAttribution {
  const cookie = req.headers.get("cookie") ?? "";
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;
  return {
    consented: cookieValue(cookie, CONSENT_COOKIE_NAME) === CONSENT_VALUE_ANALYTICS,
    fbp: cookieValue(cookie, "_fbp"),
    fbc: cookieValue(cookie, "_fbc"),
    clientIp: ip,
    userAgent: req.headers.get("user-agent"),
    sourceUrl: null,
  };
}

/**
 * Server-side install conversion for EVERY brand-new shop, whichever path created it — a merchant
 * who goes from Shopify's listing straight to the install never touches our site, so site
 * consent cannot be a precondition. What is sent depends on consent: the hashed shop-owner email
 * and shop domain always; the browser-level signals (IP, user agent, `_fbp`, `_fbc`) only when
 * the install request's cookies show the visitor accepted analytics on our site. Sent as the
 * standard `CompleteRegistration` so it can't be confused with (or double-count) the `Purchase`
 * Shopify sends for installs through its listing. The event id is per shop, so a repeated
 * callback deduplicates. Never throws.
 */
export async function sendMetaInstall(opts: {
  shopDomain: string;
  email: string | null;
  attribution: MetaAttribution | undefined;
}): Promise<void> {
  const a = opts.attribution;
  const browser = a?.consented ? a : null;
  // Nothing to match on: no owner email and no consented browser signals.
  if (!opts.email && !browser) return;
  await sendMetaEvent({
    eventName: "CompleteRegistration",
    eventId: `install:${opts.shopDomain}`,
    email: opts.email,
    sourceUrl: browser?.sourceUrl ?? "https://disputedesk.app/",
    clientIp: browser?.clientIp ?? null,
    userAgent: browser?.userAgent ?? null,
    fbp: browser?.fbp ?? null,
    fbc: browser?.fbc ?? null,
    customData: { content_name: "shopify_app_install", shop_domain: opts.shopDomain },
  });
}
