/**
 * Tests for POST /api/webhooks/customers/redact — GDPR mandatory
 * customer-data anonymization.
 *
 *   - 401 when HMAC fails
 *   - 200 with skipped:invalid_json on malformed body
 *   - 400 when shop domain missing from BOTH header and payload
 *   - 200 with skipped:no_pii_to_match when payload has no email/name
 *   - 200 with skipped:unknown_shop when shop isn't in our DB
 *   - 200 happy path: anonymizes disputes rows by email match,
 *     scrubs pack_json sections, writes compliance audit row
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/webhooks/verify", () => ({
  verifyShopifyWebhook: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { POST } from "@/app/api/webhooks/customers-redact/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockVerify = vi.mocked(verifyShopifyWebhook);

interface SupabaseSpies {
  disputesUpdate: ReturnType<typeof vi.fn>;
  packsUpdate: ReturnType<typeof vi.fn>;
  auditInsert: ReturnType<typeof vi.fn>;
}

function setupSupabase(opts: {
  shopRow?: { id: string } | null;
  matchedDisputes?: Array<{ id: string }>;
  packs?: Array<{ id: string; pack_json: unknown }>;
}): SupabaseSpies {
  const disputesUpdate = vi.fn();
  const packsUpdate = vi.fn();
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
    if (table === "disputes") {
      // .update().eq('shop_id', X).eq('customer_email', Y).select('id')
      return {
        update: vi.fn((patch) => {
          disputesUpdate(patch);
          return {
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockResolvedValue({
              data: opts.matchedDisputes ?? [],
              error: null,
            }),
          };
        }),
      };
    }
    if (table === "evidence_packs") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: opts.packs ?? [], error: null }),
        update: vi.fn((patch) => {
          packsUpdate(patch);
          return {
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }),
      };
    }
    if (table === "audit_events") {
      return { insert: auditInsert };
    }
    throw new Error(`unexpected table: ${table}`);
  };

  mockGetServiceClient.mockReturnValue({ from: fromImpl } as never);
  return { disputesUpdate, packsUpdate, auditInsert };
}

const PAYLOAD = JSON.stringify({
  shop_domain: "demo.myshopify.com",
  customer: {
    id: 12345,
    email: "alice@example.com",
    first_name: "Alice",
    last_name: "Smith",
  },
});

function makeReq(opts: { body: string; hmac?: string | null; shopHeader?: string | null }) {
  const headers: Record<string, string> = {};
  if (opts.hmac !== null && opts.hmac !== undefined) headers["x-shopify-hmac-sha256"] = opts.hmac;
  if (opts.shopHeader) headers["x-shopify-shop-domain"] = opts.shopHeader;
  return new NextRequest("http://localhost/api/webhooks/customers-redact", {
    method: "POST",
    body: opts.body,
    headers,
  });
}

describe("POST /api/webhooks/customers/redact", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when HMAC fails (no DB writes)", async () => {
    mockVerify.mockReturnValue(false);
    const spies = setupSupabase({ shopRow: { id: "shop-1" } });

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "bad" }));

    expect(res.status).toBe(401);
    expect(spies.disputesUpdate).not.toHaveBeenCalled();
    expect(spies.packsUpdate).not.toHaveBeenCalled();
    expect(spies.auditInsert).not.toHaveBeenCalled();
  });

  it("returns 200 with skipped:invalid_json on malformed body", async () => {
    mockVerify.mockReturnValue(true);
    const res = await POST(makeReq({ body: "not-json", hmac: "ok" }));
    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe("invalid_json");
  });

  it("returns 400 when shop domain missing from BOTH header and payload", async () => {
    mockVerify.mockReturnValue(true);
    const res = await POST(makeReq({ body: "{}", hmac: "ok" }));
    expect(res.status).toBe(400);
  });

  it("returns 200 with skipped:no_pii_to_match when payload lacks email AND name", async () => {
    mockVerify.mockReturnValue(true);
    const noPiiPayload = JSON.stringify({
      shop_domain: "demo.myshopify.com",
      customer: { id: 12345 }, // no email, no first/last name
    });

    const res = await POST(makeReq({ body: noPiiPayload, hmac: "ok" }));

    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe("no_pii_to_match");
  });

  it("returns 200 with skipped:unknown_shop when shop isn't in our DB", async () => {
    mockVerify.mockReturnValue(true);
    const spies = setupSupabase({ shopRow: null });

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "ok" }));

    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe("unknown_shop");
    expect(spies.auditInsert).not.toHaveBeenCalled();
  });

  it("happy path: anonymizes matched disputes + scrubs pack_json + writes audit row", async () => {
    mockVerify.mockReturnValue(true);
    const spies = setupSupabase({
      shopRow: { id: "shop-1" },
      matchedDisputes: [{ id: "dispute-1" }, { id: "dispute-2" }],
      packs: [
        {
          id: "pack-1",
          pack_json: {
            sections: [
              { type: "order", data: { customer_email: "alice@example.com", orderName: "#1234" } },
            ],
          },
        },
        {
          id: "pack-2",
          pack_json: { sections: [{ type: "order", data: { customer_email: "bob@example.com" } }] }, // no match
        },
      ],
    });

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "ok" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.disputes_anonymized).toBe(2);
    expect(body.packs_scrubbed).toBe(1); // only pack-1 had matching PII

    // disputes update was called with both customer fields nulled
    expect(spies.disputesUpdate).toHaveBeenCalledWith({
      customer_email: null,
      customer_display_name: null,
    });

    // packs update was called once (for pack-1 only)
    expect(spies.packsUpdate).toHaveBeenCalledTimes(1);
    const scrubbed = spies.packsUpdate.mock.calls[0][0] as { pack_json: { sections: Array<{ data: { customer_email: string } }> } };
    expect(scrubbed.pack_json.sections[0].data.customer_email).toBe("[redacted]");

    // compliance audit row — does NOT contain customer_email or name
    expect(spies.auditInsert).toHaveBeenCalledTimes(1);
    const audit = spies.auditInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(audit.event_type).toBe("gdpr_customer_redacted");
    const payload = audit.event_payload as Record<string, unknown>;
    expect(payload.customer_id).toBe(12345);
    expect(payload.disputes_anonymized).toBe(2);
    expect(payload.packs_scrubbed).toBe(1);
    // critical: PII not in audit
    expect(JSON.stringify(payload)).not.toContain("alice@example.com");
    expect(JSON.stringify(payload)).not.toContain("Alice");
  });
});
