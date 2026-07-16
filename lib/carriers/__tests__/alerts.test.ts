import { describe, it, expect, beforeEach, vi } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({ rpc: rpcMock }),
}));

const sendAdminEmailMock = vi.fn(async (_opts: unknown) => {});
vi.mock("@/lib/email/adminEmail", () => ({
  sendAdminEmail: (opts: unknown) => sendAdminEmailMock(opts),
}));

import {
  reportCarrierFailure,
  reportUnsupportedCarrier,
  maskTrackingRef,
  trackingUrlHost,
} from "@/lib/carriers/alerts";

const FULL_TRACKING = "373325386394209542";

beforeEach(() => {
  rpcMock.mockReset();
  sendAdminEmailMock.mockClear();
  rpcMock.mockResolvedValue({ data: true, error: null });
});

describe("helpers", () => {
  it("maskTrackingRef keeps only the last 4 characters", () => {
    expect(maskTrackingRef(FULL_TRACKING)).toBe("…9542");
    expect(maskTrackingRef("  ")).toBeNull();
    expect(maskTrackingRef(null)).toBeNull();
  });

  it("trackingUrlHost returns the hostname only — never path or query", () => {
    expect(
      trackingUrlHost(`https://www.dhl.com/se-en/home/tracking.html?tracking-id=${FULL_TRACKING}`),
    ).toBe("www.dhl.com");
    expect(trackingUrlHost("not a url")).toBeNull();
  });
});

describe("reportCarrierFailure", () => {
  const baseInput = {
    category: "authentication_error" as const,
    carrier: "dhl",
    adapterName: "dhl",
    adapterVersion: "dhl@1",
    shopId: "shop-1",
    orderGid: "gid://shopify/Order/8199481196810",
    disputeId: "dispute-1",
    fulfillmentId: "gid://shopify/Fulfillment/11",
    correlationId: "corr-1",
    httpStatus: 401,
    retryable: false,
    sanitizedMessage: "DHL rejected the API key",
    trackingRef: FULL_TRACKING,
  };

  it("sends one email when the dedup RPC grants the notification slot", async () => {
    await reportCarrierFailure(baseInput);
    expect(rpcMock).toHaveBeenCalledWith(
      "carrier_alert_touch",
      expect.objectContaining({
        p_category: "authentication_error",
        p_carrier: "dhl",
        p_shop_id: "shop-1",
        p_suppress_seconds: 6 * 60 * 60,
      }),
    );
    expect(sendAdminEmailMock).toHaveBeenCalledTimes(1);
    const call = sendAdminEmailMock.mock.calls[0][0] as Record<string, string>;
    expect(call.to).toBe("support@disputedesk.app");
    expect(call.subject).toContain("dhl");
    expect(call.subject).toContain("authentication_error");
  });

  it("suppresses the email when the RPC says the incident is deduped", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    await reportCarrierFailure(baseInput);
    expect(sendAdminEmailMock).not.toHaveBeenCalled();
  });

  it("never includes the full tracking number, secrets, or auth headers in the email", async () => {
    await reportCarrierFailure(baseInput);
    const call = sendAdminEmailMock.mock.calls[0][0] as { text: string; html: string };
    const body = call.text + call.html;
    expect(body).not.toContain(FULL_TRACKING);
    expect(body).toContain("…9542");
    expect(body.toLowerCase()).not.toContain("api_key");
    expect(body.toLowerCase()).not.toContain("authorization");
  });

  it("a dedup-storage failure is logged and NEVER thrown (pack build survives)", async () => {
    rpcMock.mockRejectedValue(new Error("db down"));
    await expect(reportCarrierFailure(baseInput)).resolves.toBeUndefined();
    expect(sendAdminEmailMock).not.toHaveBeenCalled();
  });

  it("an email-send failure is logged and NEVER thrown", async () => {
    sendAdminEmailMock.mockRejectedValueOnce(new Error("resend down"));
    await expect(reportCarrierFailure(baseInput)).resolves.toBeUndefined();
  });
});

describe("reportUnsupportedCarrier", () => {
  const baseInput = {
    carrier: "postnord",
    companyRaw: "PostNord SE",
    identifiedFrom: "company" as const,
    trackingUrl: `https://tracking.postnord.com/se/?id=${FULL_TRACKING}&extra=1`,
    shopId: "shop-1",
    orderGid: "gid://shopify/Order/1",
    disputeId: null,
    fulfillmentId: "gid://shopify/Fulfillment/11",
    correlationId: "corr-2",
  };

  it("first merchant+carrier occurrence sends the subject-formatted email", async () => {
    await reportUnsupportedCarrier(baseInput);
    expect(rpcMock).toHaveBeenCalledWith(
      "carrier_alert_touch",
      expect.objectContaining({
        p_category: "unsupported_carrier",
        p_incident_key: expect.stringContaining("unsupported_carrier|postnord|shop-1"),
        p_suppress_seconds: 7 * 24 * 60 * 60,
      }),
    );
    const call = sendAdminEmailMock.mock.calls[0][0] as Record<string, string>;
    expect(call.subject).toBe("[DisputeDesk] Unsupported carrier detected: postnord");
    expect(call.to).toBe("support@disputedesk.app");
  });

  it("email carries the URL HOSTNAME only — never the full URL, query, or tracking id", async () => {
    await reportUnsupportedCarrier(baseInput);
    const call = sendAdminEmailMock.mock.calls[0][0] as { text: string; html: string };
    const body = call.text + call.html;
    expect(body).toContain("tracking.postnord.com");
    expect(body).not.toContain(FULL_TRACKING);
    expect(body).not.toContain("?id=");
    expect(body).toContain("No DisputeDesk carrier adapter currently supports");
  });

  it("duplicate merchant+carrier is suppressed; email failure is non-fatal", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    await reportUnsupportedCarrier(baseInput);
    expect(sendAdminEmailMock).not.toHaveBeenCalled();

    rpcMock.mockResolvedValue({ data: true, error: null });
    sendAdminEmailMock.mockRejectedValueOnce(new Error("resend down"));
    await expect(reportUnsupportedCarrier(baseInput)).resolves.toBeUndefined();
  });

  it("dedup key is per merchant+carrier — a different shop notifies separately", async () => {
    await reportUnsupportedCarrier(baseInput);
    await reportUnsupportedCarrier({ ...baseInput, shopId: "shop-2" });
    const keys = rpcMock.mock.calls.map((c) => (c[1] as { p_incident_key: string }).p_incident_key);
    expect(new Set(keys).size).toBe(2);
  });
});
