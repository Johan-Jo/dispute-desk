import { describe, it, expect } from "vitest";
import { parseLead } from "@/lib/marketing/metaLeads/parseLead";

describe("parseLead", () => {
  it("maps Meta's standard fields and lowercases the email", () => {
    const l = parseLead({
      id: "123",
      created_time: "2026-10-04T18:00:00+0000",
      ad_name: "Ad A",
      campaign_name: "Leads",
      field_data: [
        { name: "email", values: ["Owner@Shop.com "] },
        { name: "full_name", values: ["Maya Lopez"] },
        { name: "phone_number", values: ["+15550100"] },
        { name: "company_name", values: ["Maya Co"] },
        { name: "what_is_your_store_url?", values: ["maya.myshopify.com"] },
      ],
    });
    expect(l).toMatchObject({
      leadgenId: "123",
      email: "owner@shop.com",
      fullName: "Maya Lopez",
      phone: "+15550100",
      company: "Maya Co",
      store: "maya.myshopify.com",
      adName: "Ad A",
      campaignName: "Leads",
    });
    expect(l.answers.email).toBe("Owner@Shop.com");
  });

  it("builds the name from first and last, and nulls an invalid email", () => {
    const l = parseLead({
      id: "9",
      field_data: [
        { name: "first_name", values: ["Sam"] },
        { name: "last_name", values: ["Ng"] },
        { name: "email", values: ["not-an-email"] },
      ],
    });
    expect(l.fullName).toBe("Sam Ng");
    expect(l.email).toBeNull();
  });

  it("copes with a lead that has no field data", () => {
    const l = parseLead({ id: "1" });
    expect(l).toMatchObject({ leadgenId: "1", email: null, fullName: null, store: null, answers: {} });
  });
});
