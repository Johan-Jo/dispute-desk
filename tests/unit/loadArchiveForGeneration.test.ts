import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadArchiveForGeneration } from "@/lib/resources/generation/pipeline";
import * as server from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

function mockArchiveChain(singleResult: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(singleResult);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  vi.mocked(server.getServiceClient).mockReturnValue({ from } as never);
  return { from, select, eq, maybeSingle };
}

describe("loadArchiveForGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error and linked content id when archive already converted", async () => {
    mockArchiveChain({
      data: {
        id: "arch-1",
        created_from_archive_to_content_item_id: "content-99",
        proposed_title: "T",
        content_type: "cluster_article",
        primary_pillar: "chargebacks",
        target_locale_set: ["en-US"],
      },
      error: null,
    });

    const r = await loadArchiveForGeneration("arch-1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.linkedContentItemId).toBe("content-99");
      expect(r.error).toContain("already converted");
    }
  });

  it("returns brief when convertible", async () => {
    mockArchiveChain({
      data: {
        id: "arch-2",
        created_from_archive_to_content_item_id: null,
        proposed_title: "My topic",
        content_type: "cluster_article",
        primary_pillar: "chargebacks",
        target_keyword: "kw",
        search_intent: "info",
        summary: null,
        notes: null,
        target_locale_set: ["en-US", "de-DE"],
      },
      error: null,
    });

    const r = await loadArchiveForGeneration("arch-2");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.brief.proposedTitle).toBe("My topic");
      expect(r.brief.targetLocales).toEqual(["en-US", "de-DE"]);
    }
  });
});
