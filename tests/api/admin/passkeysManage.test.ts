import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/admin/auth", () => ({
  hasAdminSession: vi.fn(),
  getAdminSessionUser: vi.fn(),
}));
vi.mock("@/lib/admin/passkeyCookie", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, verifyPasskeyCookie: vi.fn() };
});
vi.mock("@/lib/admin/passkeys", () => ({
  countPasskeys: vi.fn(),
  renamePasskey: vi.fn(),
  revokePasskey: vi.fn(),
  listPasskeySummaries: vi.fn(),
}));

import { hasAdminSession, getAdminSessionUser } from "@/lib/admin/auth";
import { verifyPasskeyCookie } from "@/lib/admin/passkeyCookie";
import { countPasskeys, renamePasskey, revokePasskey } from "@/lib/admin/passkeys";
import { PATCH, DELETE } from "@/app/api/admin/passkeys/[id]/route";

const admin = { id: "u1", email: "a@x.com", name: null } as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/passkeys/pk-1", {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasAdminSession).mockResolvedValue(true);
  vi.mocked(getAdminSessionUser).mockResolvedValue(admin);
  vi.mocked(verifyPasskeyCookie).mockResolvedValue({
    userId: "u1",
    credentialId: "cred-1",
    iat: Math.floor(Date.now() / 1000),
  });
});

describe("DELETE /api/admin/passkeys/[id]", () => {
  it("403s without a passkey-verified session", async () => {
    vi.mocked(verifyPasskeyCookie).mockResolvedValue(null);
    const res = await DELETE(req("DELETE"), params("pk-1"));
    expect(res.status).toBe(403);
  });

  it("refuses to delete the LAST passkey (409 LAST_PASSKEY)", async () => {
    vi.mocked(countPasskeys).mockResolvedValue(1);
    const res = await DELETE(req("DELETE"), params("pk-1"));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("LAST_PASSKEY");
    expect(revokePasskey).not.toHaveBeenCalled();
  });

  it("revokes when more than one passkey exists", async () => {
    vi.mocked(countPasskeys).mockResolvedValue(2);
    vi.mocked(revokePasskey).mockResolvedValue(true);
    const res = await DELETE(req("DELETE"), params("pk-1"));
    expect(res.status).toBe(200);
    expect(revokePasskey).toHaveBeenCalledWith("u1", "pk-1");
  });

  it("404s when the passkey isn't the caller's", async () => {
    vi.mocked(countPasskeys).mockResolvedValue(2);
    vi.mocked(revokePasskey).mockResolvedValue(false);
    const res = await DELETE(req("DELETE"), params("pk-1"));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/admin/passkeys/[id]", () => {
  it("400s on empty name", async () => {
    const res = await PATCH(req("PATCH", { friendlyName: "  " }), params("pk-1"));
    expect(res.status).toBe(400);
  });

  it("renames when owned", async () => {
    vi.mocked(renamePasskey).mockResolvedValue(true);
    const res = await PATCH(req("PATCH", { friendlyName: "My Mac" }), params("pk-1"));
    expect(res.status).toBe(200);
    expect(renamePasskey).toHaveBeenCalledWith("u1", "pk-1", "My Mac");
  });

  it("cross-user rename rejected as passkey-cookie mismatch", async () => {
    vi.mocked(verifyPasskeyCookie).mockResolvedValue({
      userId: "someone-else",
      credentialId: "cred-9",
      iat: Math.floor(Date.now() / 1000),
    });
    const res = await PATCH(req("PATCH", { friendlyName: "x" }), params("pk-1"));
    expect(res.status).toBe(403);
  });
});
