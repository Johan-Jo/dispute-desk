import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { dhlAdapter, normalizeDhlShipment } from "@/lib/carriers/dhl";

/**
 * DHL adapter tests — deterministic REDACTED fixtures (no live API, no
 * real tracking data beyond the known #12809 acceptance shape).
 */

const TRACKING = "373325386394209542";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const shipmentFixture = (overrides: Record<string, unknown> = {}) => ({
  shipments: [
    {
      id: TRACKING,
      status: {
        timestamp: "2026-06-04T14:31:00",
        statusCode: "delivered",
        description: "Picked up by receiver",
      },
      events: [
        {
          timestamp: "2026-06-04T14:31:00",
          statusCode: "delivered",
          description: "Picked up by receiver, DIREKTEN LÖDÖSE Servicepoint",
        },
        {
          timestamp: "2026-06-03T08:00:00",
          statusCode: "transit",
          description: "Arrived at servicepoint",
        },
      ],
      ...overrides,
    },
  ],
});

describe("dhlAdapter.match", () => {
  it("URL-derived tracking-id takes precedence over the stored confirmation number", () => {
    const m = dhlAdapter.match({
      company: "DHL Freight",
      number: "5198980574",
      url: `https://www.dhl.com/se-en/home/tracking.html?tracking-id=${TRACKING}`,
    });
    expect(m).toMatchObject({
      carrier: "dhl",
      trackingNumber: TRACKING,
      matchedFrom: "url",
      confidence: "high",
      divisionHint: "freight",
    });
  });

  it("falls back to company+number at medium confidence", () => {
    const m = dhlAdapter.match({ company: "DHL", number: "1234567890", url: null });
    expect(m).toMatchObject({
      carrier: "dhl",
      trackingNumber: "1234567890",
      matchedFrom: "company_and_number",
      confidence: "medium",
    });
  });

  it("returns null on conflicting URL ids and on non-DHL entries", () => {
    expect(
      dhlAdapter.match({
        company: null,
        number: null,
        url: "https://dhl.com/t?tracking-id=X1234&tracking-id=Y5678",
      }),
    ).toBeNull();
    expect(dhlAdapter.match({ company: "PostNord SE", number: "1", url: null })).toBeNull();
    expect(dhlAdapter.match({ company: "DHL", number: null, url: null })).toBeNull();
  });
});

describe("dhlAdapter.fetchTimeline", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DHL_API_KEY", "test-key");
    vi.stubEnv("DHL_API_SECRET", "test-secret");
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("configuration_missing when either credential is absent (self-disablement)", async () => {
    vi.stubEnv("DHL_API_KEY", "");
    expect((await dhlAdapter.fetchTimeline(TRACKING)).status).toBe("configuration_missing");
    vi.stubEnv("DHL_API_KEY", "test-key");
    vi.stubEnv("DHL_API_SECRET", "");
    expect((await dhlAdapter.fetchTimeline(TRACKING)).status).toBe("configuration_missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("success: 'Picked up by receiver' normalizes to CollectedAtPickup — ID-verified collection (the #12809 shape)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(shipmentFixture()));
    const r = await dhlAdapter.fetchTimeline(TRACKING);
    expect(r.status).toBe("success");
    if (r.status === "success") {
      expect(r.shipment.deliveryStatus).toBe("CollectedAtPickup");
      expect(r.shipment.terminalAt).toBe("2026-06-04T14:31:00");
      expect(r.shipment.events).toHaveLength(2);
    }
    // Auth is the documented DHL-API-Key header; credentials never in the URL.
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain(`trackingNumber=${TRACKING}`);
    expect(String(calledUrl)).not.toContain("test-key");
    expect((init as RequestInit).headers).toMatchObject({ "DHL-API-Key": "test-key" });
  });

  it("success: plain home delivery normalizes to Delivered", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        shipmentFixture({
          events: [
            {
              timestamp: "2026-06-04T14:31:00",
              statusCode: "delivered",
              description: "Delivered to recipient",
            },
          ],
        }),
      ),
    );
    const r = await dhlAdapter.fetchTimeline(TRACKING);
    expect(r.status === "success" && r.shipment.deliveryStatus).toBe("Delivered");
  });

  it("success: returned shipment normalizes to Returned", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        shipmentFixture({
          status: { timestamp: "2026-06-10T10:00:00", statusCode: "failure" },
          events: [
            {
              timestamp: "2026-06-10T10:00:00",
              statusCode: "failure",
              description: "Returned to sender",
            },
          ],
        }),
      ),
    );
    const r = await dhlAdapter.fetchTimeline(TRACKING);
    expect(r.status === "success" && r.shipment.deliveryStatus).toBe("Returned");
  });

  it("success with NO terminal event: in-transit is success + null deliveryStatus (never not_found)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        shipmentFixture({
          status: { timestamp: "2026-06-03T08:00:00", statusCode: "transit" },
          events: [
            { timestamp: "2026-06-03T08:00:00", statusCode: "transit", description: "In transit" },
          ],
        }),
      ),
    );
    const r = await dhlAdapter.fetchTimeline(TRACKING);
    expect(r.status).toBe("success");
    if (r.status === "success") {
      expect(r.shipment.deliveryStatus).toBeNull();
      expect(r.shipment.terminalAt).toBeNull();
    }
  });

  it("older delivery then newer return: return wins (latest-terminal-event)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        shipmentFixture({
          events: [
            { timestamp: "2026-06-20T10:00:00", statusCode: "failure", description: "Returned to sender" },
            { timestamp: "2026-06-04T14:31:00", statusCode: "delivered", description: "Delivered to recipient" },
          ],
        }),
      ),
    );
    const r = await dhlAdapter.fetchTimeline(TRACKING);
    expect(r.status === "success" && r.shipment.deliveryStatus).toBe("Returned");
  });

  it("return then redelivery: redelivery wins", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        shipmentFixture({
          events: [
            { timestamp: "2026-06-25T10:00:00", statusCode: "delivered", description: "Delivered to recipient" },
            { timestamp: "2026-06-20T10:00:00", statusCode: "failure", description: "Returned to sender" },
          ],
        }),
      ),
    );
    const r = await dhlAdapter.fetchTimeline(TRACKING);
    expect(r.status === "success" && r.shipment.deliveryStatus).toBe("Delivered");
  });

  it("authentication failure → authentication_error (401 and 403)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 401 }, 401));
    expect((await dhlAdapter.fetchTimeline(TRACKING)).status).toBe("authentication_error");
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 403 }, 403));
    expect((await dhlAdapter.fetchTimeline(TRACKING)).status).toBe("authentication_error");
  });

  it("404 → not_found (legitimate no-such-shipment, no retry)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 404 }, 404));
    expect((await dhlAdapter.fetchTimeline(TRACKING)).status).toBe("not_found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("empty shipments array → not_found; multiple shipments → ambiguous", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ shipments: [] }));
    expect((await dhlAdapter.fetchTimeline(TRACKING)).status).toBe("not_found");
    fetchMock.mockResolvedValueOnce(jsonResponse({ shipments: [{}, {}, {}] }));
    const r = await dhlAdapter.fetchTimeline(TRACKING);
    expect(r).toMatchObject({ status: "ambiguous", candidateCount: 3 });
  });

  it("429 → rate_limited with Retry-After, never retried in-process", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 429, { "retry-after": "17" }));
    const r = await dhlAdapter.fetchTimeline(TRACKING);
    expect(r).toEqual({ status: "rate_limited", retryAfterSeconds: 17 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("5xx → one bounded retry, then unavailable", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    expect((await dhlAdapter.fetchTimeline(TRACKING)).status).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("5xx then success on the bounded retry", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse(shipmentFixture()));
    expect((await dhlAdapter.fetchTimeline(TRACKING)).status).toBe("success");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("network error → one bounded retry, then network_error", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect((await dhlAdapter.fetchTimeline(TRACKING)).status).toBe("network_error");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("timeout (abort) → timeout after bounded retry", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    fetchMock.mockRejectedValue(abortErr);
    expect((await dhlAdapter.fetchTimeline(TRACKING)).status).toBe("timeout");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("malformed JSON → invalid_response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>gateway error</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    expect((await dhlAdapter.fetchTimeline(TRACKING)).status).toBe("invalid_response");
  });

  it("unexpected response schema → invalid_response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ somethingElse: true }));
    expect((await dhlAdapter.fetchTimeline(TRACKING)).status).toBe("invalid_response");
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 400));
    expect((await dhlAdapter.fetchTimeline(TRACKING)).status).toBe("invalid_response");
  });
});

describe("normalizeDhlShipment", () => {
  it("extracts a POD name from signature phrasing in event text", () => {
    const s = normalizeDhlShipment(TRACKING, {
      status: { statusCode: "delivered", timestamp: "2026-06-04T14:31:00" },
      events: [
        {
          timestamp: "2026-06-04T14:31:00",
          statusCode: "delivered",
          description: "Delivered, signed by ANNA ANDERSSON",
        },
      ],
    });
    expect(s.deliveryStatus).toBe("Delivered");
    expect(s.podName).toBe("ANNA ANDERSSON");
  });

  it("trusts the structured delivered code when event messages are empty", () => {
    const s = normalizeDhlShipment(TRACKING, {
      status: { statusCode: "delivered", timestamp: "2026-06-04T14:31:00" },
      events: [],
    });
    expect(s.deliveryStatus).toBe("Delivered");
    expect(s.terminalAt).toBe("2026-06-04T14:31:00");
  });

  it("sorts events newest first and tolerates junk entries", () => {
    const s = normalizeDhlShipment(TRACKING, {
      events: [
        { timestamp: "2026-06-01T00:00:00", description: "older" },
        { description: "no timestamp — dropped" },
        { timestamp: "2026-06-02T00:00:00", description: "newer" },
      ],
    });
    expect(s.events.map((e) => e.message)).toEqual(["newer", "older"]);
    expect(s.deliveryStatus).toBeNull();
  });
});
