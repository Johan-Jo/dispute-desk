/**
 * The admin dispute page used to call the merchant routes (/api/disputes/:id/
 * timeline|notes|resync), which need a Bearer role token the admin UI never
 * sends — so the timeline was empty and notes/resync silently failed. These pin
 * the admin-gated replacements.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/disputes/internal/timeline", () => ({
  loadDisputeTimeline: vi.fn(async () => new Response("{}", { status: 200 })),
}));
vi.mock("@/lib/disputes/internal/notes", () => ({
  listDisputeNotes: vi.fn(async () => new Response("{}", { status: 200 })),
  createDisputeNote: vi.fn(async () => new Response("{}", { status: 201 })),
}));
vi.mock("@/lib/disputes/internal/resync", () => ({
  resyncDispute: vi.fn(async () => new Response("{}", { status: 200 })),
}));
vi.mock("@/lib/admin/auth", () => ({ getAdminSessionUser: vi.fn() }));

import { GET as timelineGET } from "@/app/api/admin/disputes/[id]/timeline/route";
import { GET as notesGET, POST as notesPOST } from "@/app/api/admin/disputes/[id]/notes/route";
import { POST as resyncPOST } from "@/app/api/admin/disputes/[id]/resync/route";
import { loadDisputeTimeline } from "@/lib/disputes/internal/timeline";
import { listDisputeNotes, createDisputeNote } from "@/lib/disputes/internal/notes";
import { resyncDispute } from "@/lib/disputes/internal/resync";
import { getAdminSessionUser } from "@/lib/admin/auth";

const req = {} as never;
const ctx = { params: Promise.resolve({ id: "d1" }) };

beforeEach(() => vi.clearAllMocks());

describe("admin dispute routes", () => {
  it("timeline always includes internal events", async () => {
    await timelineGET(req, ctx);
    expect(loadDisputeTimeline).toHaveBeenCalledWith(req, "d1", true);
  });

  it("notes/resync refuse without an admin session", async () => {
    vi.mocked(getAdminSessionUser).mockResolvedValue(null);
    expect((await notesGET(req, ctx)).status).toBe(401);
    expect((await notesPOST(req, ctx)).status).toBe(401);
    expect((await resyncPOST(req, ctx)).status).toBe(401);
    expect(listDisputeNotes).not.toHaveBeenCalled();
    expect(createDisputeNote).not.toHaveBeenCalled();
    expect(resyncDispute).not.toHaveBeenCalled();
  });

  it("notes/resync act as the signed-in admin", async () => {
    vi.mocked(getAdminSessionUser).mockResolvedValue({ email: "ops@example.com" } as never);
    await notesPOST(req, ctx);
    await resyncPOST(req, ctx);
    expect(createDisputeNote).toHaveBeenCalledWith(req, "d1", { role: "admin", email: "ops@example.com" });
    expect(resyncDispute).toHaveBeenCalledWith("d1", { role: "admin", email: "ops@example.com" });
  });
});
