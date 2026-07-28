import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockSupabaseClient,
  setTableResult,
} from "@/tests/helpers/supabaseMock";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { GET } from "@/app/api/setup/state/route";

const mockGetServiceClient = vi.mocked(getServiceClient);

function makeRequest(shopId?: string) {
  const headers = new Headers();
  if (shopId) headers.set("x-shop-id", shopId);
  return new Request("http://localhost/api/setup/state", { headers }) as any;
}

describe("GET /api/setup/state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when shop_id header is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("shop_id");
  });

  it("returns default todo state when no shop_setup row exists", async () => {
    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", null);
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await GET(makeRequest("shop-123"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.progress.doneCount).toBe(0);
    expect(body.progress.total).toBe(5);
    expect(body.allDone).toBe(false);
    expect(body.nextStepId).toBe("connection");

    // All steps should be todo
    for (const step of Object.values(body.steps)) {
      expect((step as any).status).toBe("todo");
    }
  });

  it("returns correct progress for partially complete setup", async () => {
    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", {
      shop_id: "shop-123",
      steps: {
        connection: { status: "done", completed_at: "2026-01-01" },
        store_profile: { status: "done", completed_at: "2026-01-01" },
        handling: { status: "in_progress" },
      },
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await GET(makeRequest("shop-123"));
    const body = await res.json();

    expect(body.progress.doneCount).toBe(2);
    expect(body.progress.total).toBe(5);
    expect(body.nextStepId).toBe("handling");
    expect(body.allDone).toBe(false);
  });

  it("migrates legacy step ids to new ids", async () => {
    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", {
      shop_id: "shop-123",
      steps: {
        permissions: { status: "done", completed_at: "2026-01-01" },
        overview: { status: "done" },
        disputes: { status: "in_progress" },
      },
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await GET(makeRequest("shop-123"));
    const body = await res.json();

    expect(body.steps.connection?.status).toBe("done");
    expect(body.steps.handling?.status).toBe("in_progress");
    expect(body.nextStepId).toBe("store_profile");
  });

  it("does not let a lingering legacy team:{todo} clobber activate:{done}", async () => {
    // Regression: ActivateStep PATCHes /api/shop/preferences (writes
    // steps.team = {status:'todo', payload:{notifications,...}}) BEFORE it
    // POSTs /api/setup/step for `activate` ({status:'done'}). Both keys then
    // coexist, and LEGACY_STEP_ID_MAP maps team → activate. Object iteration
    // order previously let team's `todo` overwrite activate's `done`, so
    // allDone stayed false and the dashboard bounced back into the wizard
    // forever. The most-complete status must win regardless of key order.
    const steps: Record<string, { status: string; payload?: unknown }> = {
      connection: { status: "done" },
      store_profile: { status: "done" },
      handling: { status: "done" },
      policies: { status: "done" },
      // activate listed BEFORE team so `team` (todo) is the later writer.
      activate: { status: "done" },
      team: { status: "todo", payload: { teamEmail: "hi@blume.com" } },
    };

    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", { shop_id: "shop-123", steps });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await GET(makeRequest("shop-123"));
    const body = await res.json();

    expect(body.steps.activate?.status).toBe("done");
    expect(body.progress.doneCount).toBe(5);
    expect(body.allDone).toBe(true);
    expect(body.nextStepId).toBeNull();
  });

  it("returns allDone when all 5 onboarding steps are done", async () => {
    const allDoneSteps: Record<string, { status: string }> = {};
    const ids = [
      "connection", "store_profile", "handling", "policies", "activate",
    ];
    for (const id of ids) {
      allDoneSteps[id] = { status: "done", completed_at: "2026-01-01" } as any;
    }

    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", {
      shop_id: "shop-123",
      steps: allDoneSteps,
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await GET(makeRequest("shop-123"));
    const body = await res.json();

    expect(body.progress.doneCount).toBe(5);
    expect(body.allDone).toBe(true);
    expect(body.nextStepId).toBeNull();
  });

  // ── 6→5 wizard merge (2026-07-27) ─────────────────────────────────────
  // `coverage` + `automation` both fold into `handling`. TOTAL_STEPS drops
  // 6→5, which is exactly the shape that once wedged merchants via the
  // `team` collision — so all three population states are pinned here.

  it("MERGED: a fully-completed legacy merchant stays done (no loop-back)", async () => {
    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", {
      shop_id: "shop-123",
      steps: {
        connection: { status: "done" },
        store_profile: { status: "done" },
        coverage: { status: "done" },
        automation: { status: "done" },
        policies: { status: "done" },
        activate: { status: "done" },
      },
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const body = await (await GET(makeRequest("shop-123"))).json();

    // Both legacy keys collapse onto handling; done survives.
    expect(body.steps.handling?.status).toBe("done");
    expect(body.progress.doneCount).toBe(5);
    expect(body.allDone).toBe(true);
    expect(body.nextStepId).toBeNull();
  });

  it("MERGED: a mid-wizard merchant is FORCED through the new handling step", async () => {
    // coverage:done + automation:todo. Plain status-rank precedence would
    // mark handling done and skip them past the merged step — they would
    // then silently inherit whatever the rules migration derived, having
    // never consciously chosen a handling mode. Downgrade to in_progress.
    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", {
      shop_id: "shop-123",
      steps: {
        connection: { status: "done" },
        store_profile: { status: "done" },
        coverage: { status: "done" },
        automation: { status: "todo" },
      },
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const body = await (await GET(makeRequest("shop-123"))).json();

    expect(body.steps.handling?.status).toBe("in_progress");
    expect(body.nextStepId).toBe("handling");
    expect(body.allDone).toBe(false);
  });

  it("MERGED: a merchant who completed the NEW step is never downgraded", async () => {
    // Once `handling` exists in its own right, the legacy-pair downgrade
    // must not fire — otherwise they'd be sent back every page load.
    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", {
      shop_id: "shop-123",
      steps: {
        connection: { status: "done" },
        store_profile: { status: "done" },
        coverage: { status: "done" },
        automation: { status: "todo" },
        handling: { status: "done" },
        policies: { status: "done" },
        activate: { status: "done" },
      },
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const body = await (await GET(makeRequest("shop-123"))).json();

    expect(body.steps.handling?.status).toBe("done");
    expect(body.allDone).toBe(true);
  });

  it("MERGED: a fresh install starts at connection with 5 todo steps", async () => {
    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", { shop_id: "shop-123", steps: {} });
    mockGetServiceClient.mockReturnValue(client as any);

    const body = await (await GET(makeRequest("shop-123"))).json();

    expect(Object.keys(body.steps)).toHaveLength(5);
    expect(body.nextStepId).toBe("connection");
    expect(body.allDone).toBe(false);
  });
});
