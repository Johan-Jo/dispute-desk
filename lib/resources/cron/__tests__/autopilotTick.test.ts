import { describe, it, expect, vi, beforeEach } from "vitest";
import * as server from "@/lib/supabase/server";
import * as pipeline from "@/lib/resources/generation/pipeline";
import * as generate from "@/lib/resources/generation/generate";
import { executeAutopilotTick } from "@/lib/resources/cron/autopilotTick";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

vi.mock("@/lib/resources/generation/pipeline", () => ({
  submitArticleAsBatch: vi.fn(),
}));

vi.mock("@/lib/resources/generation/generate", () => ({
  isGenerationEnabled: vi.fn(),
}));

const mockSubmitBatch = vi.mocked(pipeline.submitArticleAsBatch);
const mockGenEnabled = vi.mocked(generate.isGenerationEnabled);

function mockSupabaseForOneArchive(settingsJson: Record<string, unknown>) {
  const cmsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { settings_json: settingsJson },
      error: null,
    }),
  };
  const archiveChain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: [{ id: "archive-1" }],
      error: null,
    }),
  };
  vi.mocked(server.getServiceClient).mockReturnValue({
    from: (table: string) => {
      if (table === "cms_settings") return cmsChain;
      if (table === "content_archive_items") return archiveChain;
      throw new Error(`unexpected table: ${table}`);
    },
  } as never);
}

describe("executeAutopilotTick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenEnabled.mockReturnValue(true);
    mockSubmitBatch.mockResolvedValue({
      contentItemId: "ci-1",
      batchId: "msgbatch_test",
      requestedLocales: 6,
      error: null,
    });
  });

  it("submits the picked archive item as an async batch (manual admin)", async () => {
    mockSupabaseForOneArchive({
      autopilotEnabled: true,
      autopilotArticlesPerDay: 1,
    });

    await executeAutopilotTick({ bypassRateLimit: true, overrideCount: 1 });

    // All-async: the tick submits the article to the Anthropic batch (no sync
    // generation, no pipeline options) — the drain cron ingests + publishes.
    expect(mockSubmitBatch).toHaveBeenCalledWith("archive-1");
  });

  it("submits the picked archive item as an async batch (scheduled cron)", async () => {
    mockSupabaseForOneArchive({
      autopilotEnabled: true,
      autopilotArticlesPerDay: 1,
    });

    await executeAutopilotTick();

    expect(mockSubmitBatch).toHaveBeenCalledWith("archive-1");
  });
});
