import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "@/app/api/policy-templates/[type]/content/route";

function makeRequest(type: string) {
  return GET({} as NextRequest, { params: Promise.resolve({ type }) });
}

describe("GET /api/policy-templates/[type]/content", () => {
  it("returns 400 for invalid type", async () => {
    const res = await makeRequest("invalid");
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid");
  });

  it("returns 200 with body for type terms", async () => {
    const res = await makeRequest("terms");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.body).toBeDefined();
    expect(typeof data.body).toBe("string");
    expect(data.body.length).toBeGreaterThan(0);
    expect(data.body).toContain("Terms of Service");
  });

  it("returns 200 with body for type refunds", async () => {
    const res = await makeRequest("refunds");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.body).toBeDefined();
    expect(data.body).toContain("Refund");
  });

  it("returns 200 with body for type shipping", async () => {
    const res = await makeRequest("shipping");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.body).toBeDefined();
    expect(data.body).toContain("Shipping");
  });
});
