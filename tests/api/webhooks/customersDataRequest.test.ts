/**
 * Tests for POST /api/webhooks/customers/data_request — GDPR
 * mandatory acknowledgment + audit + admin notification.
 *
 *   - 401 when HMAC verification fails (no DB writes, no email)
 *   - 200 ok with skipped:invalid_json on malformed body
 *   - 400 when shop domain missing from BOTH header and payload
 *   - 200 happy path: writes audit_events row, calls sendAdminEmail,
 *     returns ok:true
 *   - 200 unknown shop: still writes audit row + emails (Shopify
 *     doesn't care if we know the shop; ack required either way)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/webhooks/verify", () => ({
  verifyShopifyWebhook: vi.fn(),
}));
vi.mock("@/lib/email/adminEmail", () => ({
  sendAdminEmail: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { sendAdminEmail } from "@/lib/email/adminEmail";
import { POST } from "@/app/api/webhooks/customers-data-request/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockVerify = vi.mocked(verifyShopifyWebhook);
const mockSendAdminEmail = vi.mocked(sendAdminEmail);

interface SupabaseSpies {
  auditInsert: ReturnType<typeof vi.fn>;
}

function setupSupabase(opts: { shopRow?: { id: string } | null }): SupabaseSpies {
  const auditInsert = vi.fn().mockResolvedValue({ data: null, error: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromImpl = (table: string): any => {
    if (table === "shops") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: opts.shopRow ?? null,
          error: null,
        }),
      };
    }
    if (table === "audit_events") {
      return { insert: auditInsert };
    }
    throw new Error(`unexpected table: ${table}`);
  };
  mockGetServiceClient.mockReturnValue({ from: fromImpl } as never);
  return { auditInsert };
}

const PAYLOAD = JSON.stringify({
  shop_domain: "demo.myshopify.com",
  customer: { id: 12345, email: "alice@example.com" },
  orders_requested: [9001, 9002],
  data_request: { id: 7777 },
});

function makeReq(opts: { body: string; hmac?: string | null; shopHeader?: string | null }) {
  const headers: Record<string, string> = {};
  if (opts.hmac !== null && opts.hmac !== undefined) headers["x-shopify-hmac-sha256"] = opts.hmac;
  if (opts.shopHeader) headers["x-shopify-shop-domain"] = opts.shopHeader;
  return new NextRequest("http://localhost/api/webhooks/customers-data-request", {
    method: "POST",
    body: opts.body,
    headers,
  });
}

describe("POST /api/webhooks/customers/data_request", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when HMAC verification fails (no DB writes, no email)", async () => {
    mockVerify.mockReturnValue(false);
    const spies = setupSupabase({});

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "bad" }));

    expect(res.status).toBe(401);
    expect(spies.auditInsert).not.toHaveBeenCalled();
    expect(mockSendAdminEmail).not.toHaveBeenCalled();
  });

  it("returns 200 with skipped:invalid_json on malformed body (Shopify shouldn't retry)", async () => {
    mockVerify.mockReturnValue(true);

    const res = await POST(makeReq({ body: "not-json", hmac: "ok" }));

    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe("invalid_json");
  });

  it("returns 400 when shop domain missing from header AND payload", async () => {
    mockVerify.mockReturnValue(true);

    const res = await POST(makeReq({ body: "{}", hmac: "ok" })); // no shop_domain in body, no header
    expect(res.status).toBe(400);
  });

  it("happy path: writes audit row + sends admin email + returns ok", async () => {
    mockVerify.mockReturnValue(true);
    const spies = setupSupabase({ shopRow: { id: "shop-1" } });

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "ok", shopHeader: "demo.myshopify.com" }));

    expect(res.status).toBe(200);
    expect(spies.auditInsert).toHaveBeenCalledTimes(1);
    const audit = spies.auditInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(audit.event_type).toBe("gdpr_data_request_received");
    expect(audit.shop_id).toBe("shop-1");
    const payload = audit.event_payload as Record<string, unknown>;
    expect(payload.customer_email).toBe("alice@example.com");
    expect(payload.shopify_request_id).toBe(7777);

    expect(mockSendAdminEmail).toHaveBeenCalledTimes(1);
    const email = mockSendAdminEmail.mock.calls[0][0] as { subject: string };
    expect(email.subject).toContain("demo.myshopify.com");
  });

  it("unknown shop: still writes audit row (with shop_id=null) + ack returns 200", async () => {
    mockVerify.mockReturnValue(true);
    const spies = setupSupabase({ shopRow: null });

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "ok", shopHeader: "ghost.myshopify.com" }));

    expect(res.status).toBe(200);
    expect(spies.auditInsert).toHaveBeenCalledTimes(1);
    const audit = spies.auditInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(audit.shop_id).toBeNull();
  });
});
