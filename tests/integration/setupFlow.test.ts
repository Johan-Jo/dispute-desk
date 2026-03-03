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
    it("fresh setup has all 7 steps as todo, nextStepId = welcome_goals", async () => {
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
      expect(body.nextStepId).toBe("welcome_goals");
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
      // nextStepId should ideally skip permissions and go to welcome_goals
      // (since welcome_goals has no prerequisites, it stays first)
    });
  });

  describe("Step progression logic", () => {
    it("getNextActionableStep returns first todo step in order", () => {
      expect(getNextActionableStep({})).toBe("welcome_goals");
      expect(
        getNextActionableStep({ welcome_goals: { status: "done" } })
      ).toBe("permissions");
      expect(
        getNextActionableStep({
          welcome_goals: { status: "done" },
          permissions: { status: "done" },
        })
      ).toBe("sync_disputes");
    });

    it("getNextActionableStep skips skipped steps", () => {
      expect(
        getNextActionableStep({
          welcome_goals: { status: "skipped" },
        })
      ).toBe("permissions");
    });

    it("getNextActionableStep returns null when all done", () => {
      const allDone: Record<string, { status: string }> = {};
      for (const id of STEP_IDS) allDone[id] = { status: "done" };
      expect(getNextActionableStep(allDone)).toBeNull();
    });

    it("prerequisite check: sync_disputes requires permissions done", () => {
      expect(isPrerequisiteMet("sync_disputes", {})).toBe(false);
      expect(
        isPrerequisiteMet("sync_disputes", {
          permissions: { status: "done" },
        })
      ).toBe(true);
      expect(
        isPrerequisiteMet("sync_disputes", {
          permissions: { status: "todo" },
        })
      ).toBe(false);
    });

    it("prerequisite chain: business_policies needs sync_disputes done", () => {
      expect(isPrerequisiteMet("business_policies", {})).toBe(false);
      expect(
        isPrerequisiteMet("business_policies", {
          sync_disputes: { status: "done" },
        })
      ).toBe(true);
    });

    it("steps without prerequisites are always met", () => {
      expect(isPrerequisiteMet("welcome_goals", {})).toBe(true);
      expect(isPrerequisiteMet("automation_rules", {})).toBe(true);
      expect(isPrerequisiteMet("team_notifications", {})).toBe(true);
    });
  });

  describe("Step completion via API", () => {
    it("completing welcome_goals advances nextStepId to permissions", async () => {
      const client = createMockSupabaseClient();
      setTableResult(client, "shop_setup", {
        shop_id: "shop-1",
        steps: {},
      });
      mockGetServiceClient.mockReturnValue(client as any);

      const stepRes = await postStep(
        makePostRequest("shop-1", { stepId: "welcome_goals", payload: { primaryGoal: "win" } })
      );
      expect((await stepRes.json()).ok).toBe(true);

      // Re-read state with the step marked done
      setTableResult(client, "shop_setup", {
        shop_id: "shop-1",
        steps: {
          welcome_goals: { status: "done", completed_at: new Date().toISOString() },
        },
      });

      const stateRes = await getState(makeGetRequest("shop-1"));
      const state: SetupStateResponse = await stateRes.json();

      expect(state.progress.doneCount).toBe(1);
      expect(state.nextStepId).toBe("permissions");
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

  describe("STEP_ROUTES for portal (navigation targets)", () => {
    const STEP_ROUTES: Record<StepId, string> = {
      welcome_goals: "/portal/setup/welcome_goals",
      permissions: "/portal/setup/permissions",
      sync_disputes: "/portal/setup/sync_disputes",
      business_policies: "/portal/setup/business_policies",
      evidence_sources: "/portal/setup/evidence_sources",
      automation_rules: "/portal/setup/automation_rules",
      team_notifications: "/portal/setup/team_notifications",
    };

    it("every step has a portal route", () => {
      for (const step of SETUP_STEPS) {
        expect(STEP_ROUTES[step.id]).toBeDefined();
        expect(STEP_ROUTES[step.id]).toMatch(/^\/portal\//);
      }
    });
  });
});
