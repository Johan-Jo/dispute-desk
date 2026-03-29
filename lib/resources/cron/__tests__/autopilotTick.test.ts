import { describe, it, expect, vi, beforeEach } from "vitest";
import * as server from "@/lib/supabase/server";
import * as pipeline from "@/lib/resources/generation/pipeline";
import * as generate from "@/lib/resources/generation/generate";
import { executeAutopilotTick } from "@/lib/resources/cron/autopilotTick";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

vi.mock("@/lib/resources/generation/pipeline", () => ({
  runGenerationPipeline: vi.fn(),
}));

vi.mock("@/lib/resources/generation/generate", () => ({
  isGenerationEnabled: vi.fn(),
}));

const mockPipeline = vi.mocked(pipeline.runGenerationPipeline);
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
    mockPipeline.mockResolvedValue({
      contentItemId: "ci-1",
      results: [],
      error: null,
      publishQueueDrain: { ok: true, processed: 0, results: [] },
    });
  });

  it("passes autopilotDrainBacklog false when bypassRateLimit (manual admin)", async () => {
    mockSupabaseForOneArchive({
      autopilotEnabled: true,
      autopilotArticlesPerDay: 1,
    });

    await executeAutopilotTick({ bypassRateLimit: true, overrideCount: 1 });

    expect(mockPipeline).toHaveBeenCalledWith("archive-1", {
      autopilot: true,
      autopilotDrainBacklog: false,
    });
  });

  it("passes autopilotDrainBacklog true for scheduled cron (no bypass)", async () => {
    mockSupabaseForOneArchive({
      autopilotEnabled: true,
      autopilotArticlesPerDay: 1,
    });

    await executeAutopilotTick();

    expect(mockPipeline).toHaveBeenCalledWith("archive-1", {
      autopilot: true,
      autopilotDrainBacklog: true,
    });
  });
});
