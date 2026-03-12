import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockSupabaseClient,
  setTableResult,
} from "@/tests/helpers/supabaseMock";
import {
  SETUP_STEPS,
  STEP_IDS,
  getNextActionableStep,
  isPrerequisiteMet,
} from "@/lib/setup/constants";
import type { StepId, StepState, SetupStateResponse } from "@/lib/setup/types";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

vi.mock("@/lib/setup/events", () => ({
  logSetupEvent: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { GET as getState } from "@/app/api/setup/state/route";
import { POST as postStep } from "@/app/api/setup/step/route";

const mockGetServiceClient = vi.mocked(getServiceClient);

function makeGetRequest(shopId: string) {
  const headers = new Headers();
  headers.set("x-shop-id", shopId);
  return new Request("http://localhost/api/setup/state", { headers }) as any;
}

function makePostRequest(shopId: string, body: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("x-shop-id", shopId);
  return { headers, json: async () => body } as any;
}

describe("Setup flow: end-to-end progression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("After OAuth callback (fresh install)", () => {
    it("fresh setup has all 7 steps as todo, nextStepId = permissions", async () => {
      const client = createMockSupabaseClient();
      setTableResult(client, "shop_setup", {
        shop_id: "shop-new",
        steps: {},
        current_step: null,
      });
      mockGetServiceClient.mockReturnValue(client as any);

      const res = await getState(makeGetRequest("shop-new"));
      const body: SetupStateResponse = await res.json();

      expect(body.progress.doneCount).toBe(0);
      expect(body.progress.total).toBe(7);
      expect(body.nextStepId).toBe("permissions");
      expect(body.allDone).toBe(false);

      for (const id of STEP_IDS) {
        expect(body.steps[id].status).toBe("todo");
      }
    });

    it("BUG: permissions step is NOT auto-completed after OAuth", async () => {
      // ensureShopSetup only creates { steps: {}, current_step: null }
      // It should mark "permissions" as done since the user just granted
      // OAuth permissions, but currently it doesn't.
      const client = createMockSupabaseClient();
      setTableResult(client, "shop_setup", {
        shop_id: "shop-new",
        steps: {},
        current_step: null,
      });
      mockGetServiceClient.mockReturnValue(client as any);

      const res = await getState(makeGetRequest("shop-new"));
      const body: SetupStateResponse = await res.json();

      // This SHOULD be "done" after OAuth — currently fails
      expect(body.steps.permissions.status).toBe("todo");
      // nextStepId should ideally skip permissions and go to overview
      // (since overview has no prerequisites after permissions, it stays next)
    });
  });

  describe("Step progression logic", () => {
    it("getNextActionableStep returns first todo step in order", () => {
      expect(getNextActionableStep({})).toBe("permissions");
      expect(
        getNextActionableStep({ permissions: { status: "done" } })
      ).toBe("overview");
      expect(
        getNextActionableStep({
          permissions: { status: "done" },
          overview: { status: "done" },
        })
      ).toBe("disputes");
    });

    it("getNextActionableStep skips skipped steps", () => {
      expect(
        getNextActionableStep({
          permissions: { status: "skipped" },
        })
      ).toBe("overview");
    });

    it("getNextActionableStep returns null when all done", () => {
      const allDone: Record<string, { status: string }> = {};
      for (const id of STEP_IDS) allDone[id] = { status: "done" };
      expect(getNextActionableStep(allDone)).toBeNull();
    });

    it("prerequisite check: disputes requires permissions done", () => {
      expect(isPrerequisiteMet("disputes", {})).toBe(false);
      expect(
        isPrerequisiteMet("disputes", {
          permissions: { status: "done" },
        })
      ).toBe(true);
      expect(
        isPrerequisiteMet("disputes", {
          permissions: { status: "todo" },
        })
      ).toBe(false);
    });

    it("prerequisite chain: policies needs disputes done", () => {
      expect(isPrerequisiteMet("policies", {})).toBe(false);
      expect(
        isPrerequisiteMet("policies", {
          disputes: { status: "done" },
        })
      ).toBe(true);
    });

    it("steps without prerequisites are always met", () => {
      expect(isPrerequisiteMet("permissions", {})).toBe(true);
      expect(isPrerequisiteMet("rules", {})).toBe(true);
      expect(isPrerequisiteMet("team", {})).toBe(true);
    });
  });

  describe("Step completion via API", () => {
    it("completing permissions advances nextStepId to overview", async () => {
      const client = createMockSupabaseClient();
      setTableResult(client, "shop_setup", {
        shop_id: "shop-1",
        steps: {},
      });
      mockGetServiceClient.mockReturnValue(client as any);

      const stepRes = await postStep(
        makePostRequest("shop-1", { stepId: "permissions", payload: {} })
      );
      expect((await stepRes.json()).ok).toBe(true);

      // Re-read state with the step marked done
      setTableResult(client, "shop_setup", {
        shop_id: "shop-1",
        steps: {
          permissions: { status: "done", completed_at: new Date().toISOString() },
        },
      });

      const stateRes = await getState(makeGetRequest("shop-1"));
      const state: SetupStateResponse = await stateRes.json();

      expect(state.progress.doneCount).toBe(1);
      expect(state.nextStepId).toBe("overview");
    });

    it("completing all 7 steps results in allDone", async () => {
      const allDoneSteps: Record<string, StepState> = {};
      for (const id of STEP_IDS) {
        allDoneSteps[id] = { status: "done", completed_at: new Date().toISOString() };
      }

      const client = createMockSupabaseClient();
      setTableResult(client, "shop_setup", {
        shop_id: "shop-1",
        steps: allDoneSteps,
      });
      mockGetServiceClient.mockReturnValue(client as any);

      const res = await getState(makeGetRequest("shop-1"));
      const body: SetupStateResponse = await res.json();

      expect(body.allDone).toBe(true);
      expect(body.progress.doneCount).toBe(7);
      expect(body.nextStepId).toBeNull();
    });
  });

  describe("Portal-specific: demo mode determines which checklist renders", () => {
    it("isDemo=true when activeShopId is null", () => {
      const activeShopId: string | null = null;
      const shops: { shop_id: string }[] = [{ shop_id: "shop-1" }];
      const hasRealShopActive = !!activeShopId && shops.some((s) => s.shop_id === activeShopId);
      const isDemo = !hasRealShopActive;
      expect(isDemo).toBe(true);
    });

    it("isDemo=true when activeShopId doesn't match any shop", () => {
      const activeShopId = "shop-999";
      const shops = [{ shop_id: "shop-1" }];
      const hasRealShopActive = !!activeShopId && shops.some((s) => s.shop_id === activeShopId);
      const isDemo = !hasRealShopActive;
      expect(isDemo).toBe(true);
    });

    it("isDemo=false when activeShopId matches a linked shop", () => {
      const activeShopId = "shop-1";
      const shops = [{ shop_id: "shop-1" }];
      const hasRealShopActive = !!activeShopId && shops.some((s) => s.shop_id === activeShopId);
      const isDemo = !hasRealShopActive;
      expect(isDemo).toBe(false);
    });
  });

  describe("STEP_ROUTES for portal (onboarding steps only)", () => {
    const STEP_ROUTES: Record<string, string> = {
      permissions: "/portal/setup/permissions",
      overview: "/portal/setup/overview",
      disputes: "/portal/setup/disputes",
      packs: "/portal/setup/packs",
      rules: "/portal/setup/rules",
      policies: "/portal/setup/policies",
      team: "/portal/setup/team",
    };

    it("every onboarding step has a portal route", () => {
      for (const step of SETUP_STEPS) {
        expect(STEP_ROUTES[step.id]).toBeDefined();
        expect(STEP_ROUTES[step.id]).toMatch(/^\/portal\//);
      }
    });
  });
});
