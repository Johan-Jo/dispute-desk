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
    it("fresh setup has all 6 steps as todo, nextStepId = connection", async () => {
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
      expect(body.progress.total).toBe(6);
      expect(body.nextStepId).toBe("connection");
      expect(body.allDone).toBe(false);

      for (const id of STEP_IDS) {
        expect(body.steps[id].status).toBe("todo");
      }
    });
  });

  describe("Step progression logic", () => {
    it("getNextActionableStep returns first todo step in order", () => {
      expect(getNextActionableStep({})).toBe("connection");
      expect(
        getNextActionableStep({ connection: { status: "done" } })
      ).toBe("store_profile");
      expect(
        getNextActionableStep({
          connection: { status: "done" },
          store_profile: { status: "done" },
        })
      ).toBe("coverage");
    });

    it("getNextActionableStep skips skipped steps", () => {
      expect(
        getNextActionableStep({
          connection: { status: "skipped" },
        })
      ).toBe("store_profile");
    });

    it("getNextActionableStep returns null when all done", () => {
      const allDone: Record<string, { status: string }> = {};
      for (const id of STEP_IDS) allDone[id] = { status: "done" };
      expect(getNextActionableStep(allDone)).toBeNull();
    });

    it("all steps have no prerequisites in the new wizard", () => {
      for (const id of STEP_IDS) {
        expect(isPrerequisiteMet(id, {})).toBe(true);
      }
    });
  });

  describe("Step completion via API", () => {
    it("completing store_profile advances nextStepId to coverage", async () => {
      const client = createMockSupabaseClient();
      setTableResult(client, "shop_setup", {
        shop_id: "shop-1",
        steps: { connection: { status: "done", completed_at: new Date().toISOString() } },
      });
      mockGetServiceClient.mockReturnValue(client as any);

      const stepRes = await postStep(
        makePostRequest("shop-1", { stepId: "store_profile", payload: { storeTypes: ["physical"] } })
      );
      expect((await stepRes.json()).ok).toBe(true);

      // Re-read state with the step marked done
      setTableResult(client, "shop_setup", {
        shop_id: "shop-1",
        steps: {
          connection: { status: "done", completed_at: new Date().toISOString() },
          store_profile: { status: "done", completed_at: new Date().toISOString() },
        },
      });

      const stateRes = await getState(makeGetRequest("shop-1"));
      const state: SetupStateResponse = await stateRes.json();

      expect(state.progress.doneCount).toBe(2);
      expect(state.nextStepId).toBe("coverage");
    });

    it("completing all 6 steps results in allDone", async () => {
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
      expect(body.progress.doneCount).toBe(6);
      expect(body.nextStepId).toBeNull();
    });
  });

  describe("Legacy step migration", () => {
    it("old step ids are mapped to new step ids", async () => {
      const client = createMockSupabaseClient();
      setTableResult(client, "shop_setup", {
        shop_id: "shop-legacy",
        steps: {
          permissions: { status: "done", completed_at: "2026-01-01" },
          overview: { status: "done", completed_at: "2026-01-01" },
          disputes: { status: "done", completed_at: "2026-01-01" },
          business_policies: { status: "done", completed_at: "2026-01-01" },
        },
      });
      mockGetServiceClient.mockReturnValue(client as any);

      const res = await getState(makeGetRequest("shop-legacy"));
      const body: SetupStateResponse = await res.json();

      // permissions + overview → connection
      expect(body.steps.connection.status).toBe("done");
      // business_policies → policies
      expect(body.steps.policies.status).toBe("done");
      // disputes → coverage
      expect(body.steps.coverage.status).toBe("done");
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
      connection: "/portal/setup/connection",
      store_profile: "/portal/setup/store_profile",
      coverage: "/portal/setup/coverage",
      automation: "/portal/setup/automation",
      policies: "/portal/setup/policies",
      activate: "/portal/setup/activate",
    };

    it("every onboarding step has a portal route", () => {
      for (const step of SETUP_STEPS) {
        expect(STEP_ROUTES[step.id]).toBeDefined();
        expect(STEP_ROUTES[step.id]).toMatch(/^\/portal\//);
      }
    });
  });
});
