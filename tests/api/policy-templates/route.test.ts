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

  it("returns exactly five templates in library order with type, name, description", async () => {
    const res = await GET();
    const data = await res.json();
    expect(data.templates).toHaveLength(5);
    const types = data.templates.map((t: { type: string }) => t.type);
    expect(types).toEqual(["terms", "refunds", "shipping", "privacy", "contact"]);
    for (const t of data.templates) {
      expect(t).toHaveProperty("type");
      expect(t).toHaveProperty("name");
      expect(t).toHaveProperty("description");
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
    }
  });

  it("returns pack title and subtitle", async () => {
    const res = await GET();
    const data = await res.json();
    expect(data.packTitle).toBeDefined();
    expect(data.packSubtitle).toBeDefined();
  });
});
