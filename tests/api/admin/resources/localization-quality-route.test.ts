import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin/auth", () => ({
  hasAdminSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { hasAdminSession } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { PATCH } from "@/app/api/admin/resources/localizations/[id]/quality/route";

const mockHasAdmin = vi.mocked(hasAdminSession);
const mockGetService = vi.mocked(getServiceClient);

const localizationId = "c64bb447-6efe-4353-a25c-344532facd75";
const targetId = "11111111-2222-3333-4444-555555555555";

function buildRequest(body: unknown): Request {
  return new Request("http://localhost", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Builds a chainable Supabase mock that:
 *   - records every `update()` payload
 *   - returns `targetMaybeSingle` when callers traverse `.maybeSingle()` after
 *     `.from("content_localizations").select(...).eq(...)`
 *   - exposes `lastUpdate()` for assertions.
 */
function buildSbMock(opts: {
  targetMaybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  updateError?: unknown;
}) {
  const updateCalls: unknown[] = [];

  const updateChain = {
    eq() {
      return Promise.resolve({ error: opts.updateError ?? null });
    },
  };

  const selectChain = {
    eq() {
      return this;
    },
    maybeSingle: opts.targetMaybeSingle,
  };

  return {
    sb: {
      from() {
        return {
          update(payload: unknown) {
            updateCalls.push(payload);
            return updateChain;
          },
          select() {
            return selectChain;
          },
        };
      },
    },
    updateCalls,
  };
}

describe("PATCH /api/admin/resources/localizations/[id]/quality — auth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    mockHasAdmin.mockResolvedValue(false);
    const res = await PATCH(buildRequest({}) as never, {
      params: Promise.resolve({ id: localizationId }),
    });
    expect(res.status).toBe(401);
  });
});

describe("PATCH — validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasAdmin.mockResolvedValue(true);
    const { sb } = buildSbMock({
      targetMaybeSingle: async () => ({ data: null, error: null }),
    });
    mockGetService.mockReturnValue(sb as never);
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost", { method: "PATCH", body: "{not json" });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: localizationId }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when no recognised fields are present", async () => {
    const res = await PATCH(buildRequest({ unknownField: 1 }) as never, {
      params: Promise.resolve({ id: localizationId }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-boolean is_excluded_from_sitemap", async () => {
    const res = await PATCH(buildRequest({ is_excluded_from_sitemap: "yes" }) as never, {
      params: Promise.resolve({ id: localizationId }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid quality_status", async () => {
    const res = await PATCH(buildRequest({ quality_status: "deleted" }) as never, {
      params: Promise.resolve({ id: localizationId }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when the row tries to redirect to itself", async () => {
    const res = await PATCH(
      buildRequest({ redirect_to_localization_id: localizationId }) as never,
      { params: Promise.resolve({ id: localizationId }) }
    );
    expect(res.status).toBe(400);
  });
});

describe("PATCH — redirect-target preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasAdmin.mockResolvedValue(true);
  });

  it("returns 400 when redirect target does not exist", async () => {
    const { sb } = buildSbMock({
      targetMaybeSingle: async () => ({ data: null, error: null }),
    });
    mockGetService.mockReturnValue(sb as never);

    const res = await PATCH(
      buildRequest({ redirect_to_localization_id: targetId }) as never,
      { params: Promise.resolve({ id: localizationId }) }
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/not found/i);
  });

  it("returns 400 when redirect target is itself a redirect", async () => {
    const { sb } = buildSbMock({
      targetMaybeSingle: async () => ({
        data: {
          id: targetId,
          redirect_to_localization_id: "another-id",
          is_published: true,
        },
        error: null,
      }),
    });
    mockGetService.mockReturnValue(sb as never);

    const res = await PATCH(
      buildRequest({ redirect_to_localization_id: targetId }) as never,
      { params: Promise.resolve({ id: localizationId }) }
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/chain/i);
  });

  it("returns 400 when redirect target is unpublished", async () => {
    const { sb } = buildSbMock({
      targetMaybeSingle: async () => ({
        data: { id: targetId, redirect_to_localization_id: null, is_published: false },
        error: null,
      }),
    });
    mockGetService.mockReturnValue(sb as never);

    const res = await PATCH(
      buildRequest({ redirect_to_localization_id: targetId }) as never,
      { params: Promise.resolve({ id: localizationId }) }
    );
    expect(res.status).toBe(400);
  });

  it("succeeds when redirect target is healthy", async () => {
    const { sb, updateCalls } = buildSbMock({
      targetMaybeSingle: async () => ({
        data: { id: targetId, redirect_to_localization_id: null, is_published: true },
        error: null,
      }),
    });
    mockGetService.mockReturnValue(sb as never);

    const res = await PATCH(
      buildRequest({ redirect_to_localization_id: targetId }) as never,
      { params: Promise.resolve({ id: localizationId }) }
    );
    expect(res.status).toBe(200);
    expect(updateCalls.length).toBe(1);
    const payload = updateCalls[0] as Record<string, unknown>;
    expect(payload.redirect_to_localization_id).toBe(targetId);
    expect(payload.last_updated_at).toBeTruthy();
  });
});

describe("PATCH — happy paths for non-redirect fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasAdmin.mockResolvedValue(true);
  });

  it("accepts is_excluded_from_sitemap toggle", async () => {
    const { sb, updateCalls } = buildSbMock({
      targetMaybeSingle: async () => ({ data: null, error: null }),
    });
    mockGetService.mockReturnValue(sb as never);

    const res = await PATCH(buildRequest({ is_excluded_from_sitemap: true }) as never, {
      params: Promise.resolve({ id: localizationId }),
    });
    expect(res.status).toBe(200);
    expect(updateCalls.length).toBe(1);
    expect((updateCalls[0] as Record<string, unknown>).is_excluded_from_sitemap).toBe(true);
  });

  it("accepts quality_status='thin'", async () => {
    const { sb, updateCalls } = buildSbMock({
      targetMaybeSingle: async () => ({ data: null, error: null }),
    });
    mockGetService.mockReturnValue(sb as never);

    const res = await PATCH(buildRequest({ quality_status: "thin" }) as never, {
      params: Promise.resolve({ id: localizationId }),
    });
    expect(res.status).toBe(200);
    expect((updateCalls[0] as Record<string, unknown>).quality_status).toBe("thin");
  });

  it("accepts quality_status=null (clear)", async () => {
    const { sb, updateCalls } = buildSbMock({
      targetMaybeSingle: async () => ({ data: null, error: null }),
    });
    mockGetService.mockReturnValue(sb as never);

    const res = await PATCH(buildRequest({ quality_status: null }) as never, {
      params: Promise.resolve({ id: localizationId }),
    });
    expect(res.status).toBe(200);
    expect((updateCalls[0] as Record<string, unknown>).quality_status).toBeNull();
  });
});
