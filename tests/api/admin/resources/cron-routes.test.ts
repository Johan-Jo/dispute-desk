import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin/auth", () => ({
  hasAdminSession: vi.fn(),
}));

vi.mock("@/lib/resources/cron/autopilotTick", () => ({
  executeAutopilotTick: vi.fn(),
}));

vi.mock("@/lib/resources/cron/publishQueueTick", () => ({
  executePublishQueueTick: vi.fn(),
}));

import { hasAdminSession } from "@/lib/admin/auth";
import { executeAutopilotTick } from "@/lib/resources/cron/autopilotTick";
import { executePublishQueueTick } from "@/lib/resources/cron/publishQueueTick";
import { POST as POSTAutopilot } from "@/app/api/admin/resources/cron/autopilot/route";
import { POST as POSTPublish } from "@/app/api/admin/resources/cron/publish/route";

const mockHasAdmin = vi.mocked(hasAdminSession);
const mockAutopilot = vi.mocked(executeAutopilotTick);
const mockPublish = vi.mocked(executePublishQueueTick);

describe("POST /api/admin/resources/cron/autopilot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockHasAdmin.mockResolvedValue(false);
    const res = await POSTAutopilot();
    expect(res.status).toBe(401);
  });

  it("returns 200 with tick result when authenticated", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockAutopilot.mockResolvedValue({ ok: true, processed: 1 } as never);
    const res = await POSTAutopilot();
    expect(res.status).toBe(200);
  });
});

describe("POST /api/admin/resources/cron/publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockHasAdmin.mockResolvedValue(false);
    const res = await POSTPublish();
    expect(res.status).toBe(401);
  });

  it("returns 500 when executePublishQueueTick reports not ok", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockPublish.mockResolvedValue({ ok: false, error: "queue failed" } as never);
    const res = await POSTPublish();
    expect(res.status).toBe(500);
  });

  it("returns 200 when publish tick succeeds", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockPublish.mockResolvedValue({
      ok: true,
      processed: 2,
      results: [],
    } as never);
    const res = await POSTPublish();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { processed: number };
    expect(json.processed).toBe(2);
  });
});
