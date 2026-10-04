import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => {
    throw new Error("must not touch the database when Meta is not configured");
  },
}));
vi.mock("@/lib/marketing/metaLeads/graph", () => ({
  getLead: () => {
    throw new Error("must not call Meta when not configured");
  },
  getFormName: () => {
    throw new Error("must not call Meta when not configured");
  },
}));

import { processMetaLead } from "@/lib/marketing/metaLeads/ingest";

describe("processMetaLead", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is a no-op until META_PAGE_ACCESS_TOKEN is set", async () => {
    vi.stubEnv("META_PAGE_ACCESS_TOKEN", "");
    expect(await processMetaLead({ leadgenId: "1", formId: "f" })).toBe("not_configured");
  });
});
