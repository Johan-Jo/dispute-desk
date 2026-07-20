import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/db/templates", () => ({
  listTemplates: vi.fn(),
}));

import { listTemplates } from "@/lib/db/templates";
import { GET } from "@/app/api/templates/route";

const mockListTemplates = vi.mocked(listTemplates);

describe("GET /api/templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with templates array from listTemplates", async () => {
    mockListTemplates.mockResolvedValue([
      {
        id: "a0000000-0000-0000-0000-000000000001",
        slug: "fraud_standard",
        dispute_type: "FRAUDULENT",
        is_recommended: true,
        min_plan: "FREE",
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        name: "Fraudulent / Unrecognized — Standard",
        short_description: "Comprehensive evidence package for fraudulent disputes.",
        works_best_for: "Chargebacks where the cardholder claims they did not authorize.",
        preview_note: null,
        requiredDocs: 2,
        optionalDocs: 8,
        keyEvidence: ["Order details", "IP logs", "Device data", "Timeline"],
      },
    ]);

    const url = new URL("http://localhost/api/templates");
    const req = { nextUrl: url } as unknown as NextRequest;
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.templates).toBeDefined();
    expect(Array.isArray(data.templates)).toBe(true);
    expect(data.templates).toHaveLength(1);
    expect(data.templates[0].id).toBe("a0000000-0000-0000-0000-000000000001");
    expect(data.templates[0].name).toBe("Fraudulent / Unrecognized — Standard");
    expect(mockListTemplates).toHaveBeenCalled();
  });

  it("returns empty array when listTemplates returns no templates", async () => {
    mockListTemplates.mockResolvedValue([]);

    const url = new URL("http://localhost/api/templates");
    const req = { nextUrl: url } as unknown as NextRequest;
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.templates).toEqual([]);
  });

  it("normalizes a canonical category straight through to listTemplates", async () => {
    mockListTemplates.mockResolvedValue([]);
    const url = new URL(
      "http://localhost/api/templates?category=CREDIT_NOT_PROCESSED"
    );
    const req = { nextUrl: url } as unknown as NextRequest;
    await GET(req);
    // second arg is the category passed to the DB filter
    expect(mockListTemplates.mock.calls[0][1]).toBe("CREDIT_NOT_PROCESSED");
  });

  it("maps a legacy short category code to its canonical dispute_type", async () => {
    // Old deep links / bookmarks still send REFUND, PNR, etc. These must be
    // rewritten to the real dispute_type or the DB filter matches nothing and
    // the modal surfaces uninstallable cards (the 2026-07-20 bug).
    mockListTemplates.mockResolvedValue([]);
    for (const [alias, canonical] of [
      ["REFUND", "CREDIT_NOT_PROCESSED"],
      ["PNR", "PRODUCT_NOT_RECEIVED"],
      ["FRAUD", "FRAUDULENT"],
    ] as const) {
      mockListTemplates.mockClear();
      const url = new URL(`http://localhost/api/templates?category=${alias}`);
      const req = { nextUrl: url } as unknown as NextRequest;
      await GET(req);
      expect(mockListTemplates.mock.calls[0][1]).toBe(canonical);
    }
  });
});
