import { describe, it, expect, vi, beforeEach } from "vitest";

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
        dispute_type: "FRAUD",
        is_recommended: true,
        min_plan: "FREE",
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        name: "Fraudulent / Unrecognized — Standard",
        short_description: "Comprehensive evidence package for fraudulent disputes.",
        works_best_for: "Chargebacks where the cardholder claims they did not authorize.",
        preview_note: null,
      },
    ]);

    const url = new URL("http://localhost/api/templates");
    const req = { nextUrl: url } as Request;
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
    const req = { nextUrl: url } as Request;
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.templates).toEqual([]);
  });
});
