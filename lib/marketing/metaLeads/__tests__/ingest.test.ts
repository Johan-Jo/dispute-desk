import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => {
    throw new Error("must not touch the database when Meta is not configured");
  },
}));
vi.mock("@/lib/marketing/metaLeads/graph", () => ({
  listLeadForms: () => {
    throw new Error("must not call Meta when not configured");
  },
  listLeadsSince: () => {
    throw new Error("must not call Meta when not configured");
  },
}));

import { ingestMetaLeads } from "@/lib/marketing/metaLeads/ingest";

describe("ingestMetaLeads", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is a no-op until META_PAGE_ID and META_PAGE_ACCESS_TOKEN are set", async () => {
    vi.stubEnv("META_PAGE_ID", "");
    vi.stubEnv("META_PAGE_ACCESS_TOKEN", "");
    const r = await ingestMetaLeads();
    expect(r).toMatchObject({ forms: 0, fetched: 0, inserted: 0, welcomed: 0 });
    expect(r.skipped).toMatch(/not set/);
  });

  it("needs both values — a token alone is still a no-op", async () => {
    vi.stubEnv("META_PAGE_ID", "");
    vi.stubEnv("META_PAGE_ACCESS_TOKEN", "tok");
    expect((await ingestMetaLeads()).skipped).toBeDefined();
  });
});
