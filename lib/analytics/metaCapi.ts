import { createHash } from "node:crypto";

const GRAPH_VERSION = "v21.0";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type MetaEventInput = {
  /** Standard Meta event name, e.g. `Lead`, `CompleteRegistration`. */
  eventName: string;
  /** Deduplication key — identical to the browser pixel's `eventID` when one fires. */
  eventId: string;
  email: string | null;
  sourceUrl: string | null;
  clientIp: string | null;
  userAgent: string | null;
  fbp: string | null;
  fbc: string | null;
  customData?: Record<string, string>;
};

export type MetaLeadInput = Omit<MetaEventInput, "eventName" | "customData" | "email"> & {
  email: string;
};

/**
 * Server-side event via the Conversions API. No-op unless META_CAPI_ACCESS_TOKEN is set.
 * Callers must only invoke this for visitors who accepted analytics consent. Never throws.
 */
export async function sendMetaEvent(input: MetaEventInput): Promise<void> {
  const token = process.env.META_CAPI_ACCESS_TOKEN?.trim();
  const pixelId = (process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "").trim() || "1075321878435262";
  if (!token) return;

  const userData: Record<string, unknown> = {};
  if (input.email) userData.em = [sha256(input.email.trim().toLowerCase())];
  if (input.clientIp) userData.client_ip_address = input.clientIp;
  if (input.userAgent) userData.client_user_agent = input.userAgent;
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: input.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.eventId,
        action_source: "website",
        event_source_url: input.sourceUrl ?? undefined,
        user_data: userData,
        custom_data: input.customData,
      },
    ],
  };
  const testCode = process.env.META_CAPI_TEST_EVENT_CODE?.trim();
  if (testCode) body.test_event_code = testCode;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    if (!res.ok) console.error("[meta-capi] non-2xx:", res.status, await res.text());
  } catch (err) {
    console.error("[meta-capi] send threw:", err);
  }
}

/** Server-side `Lead` for the /test form. */
export function sendMetaLead(input: MetaLeadInput): Promise<void> {
  return sendMetaEvent({ ...input, eventName: "Lead" });
}
