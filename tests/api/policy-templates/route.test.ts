import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/policy-templates/route";

describe("GET /api/policy-templates", () => {
  it("returns 200 with templates array", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.templates).toBeDefined();
    expect(Array.isArray(data.templates)).toBe(true);
  });

  it("returns exactly three templates with type, name, description", async () => {
    const res = await GET();
    const data = await res.json();
    expect(data.templates).toHaveLength(3);
    const types = new Set(data.templates.map((t: { type: string }) => t.type));
    expect(types).toEqual(new Set(["refunds", "shipping", "terms"]));
    for (const t of data.templates) {
      expect(t).toHaveProperty("type");
      expect(t).toHaveProperty("name");
      expect(t).toHaveProperty("description");
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
    }
  });
});
