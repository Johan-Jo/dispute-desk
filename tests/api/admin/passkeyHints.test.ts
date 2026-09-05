import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/admin/auth", () => ({
  hasAdminSession: vi.fn(),
  getAdminSessionUser: vi.fn(),
}));
vi.mock("@/lib/admin/passkeys", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    listPasskeys: vi.fn(),
    savePasskey: vi.fn(),
    getPasskeyByCredentialId: vi.fn(),
    updatePasskeyCounter: vi.fn(),
  };
});

import { hasAdminSession, getAdminSessionUser } from "@/lib/admin/auth";
import { listPasskeys } from "@/lib/admin/passkeys";
import { POST as AUTH_POST } from "@/app/api/admin/passkeys/authenticate/route";
import { POST as REG_POST } from "@/app/api/admin/passkeys/register/route";

const admin = { id: "u1", email: "a@x.com", name: null } as never;

function req(): NextRequest {
  return new NextRequest("https://disputedesk.app/api/admin/passkeys", {
    method: "POST",
    headers: { host: "disputedesk.app", "x-forwarded-proto": "https" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Challenge cookies are HMAC-signed with CRON_SECRET (lib/admin/passkeyCookie).
  process.env.CRON_SECRET = "test-secret-for-passkey-cookie-signing";
  vi.mocked(hasAdminSession).mockResolvedValue(true);
  vi.mocked(getAdminSessionUser).mockResolvedValue(admin);
});

/**
 * Regression guard for the admin double-prompt (2026-09-05).
 *
 * The first attempt stripped the `hybrid` transport and shipped to prod with NO
 * observable change: transports are only a routing hint, and Chrome keeps
 * offering its cross-device "use a phone" / Google sheet regardless. `hints:
 * ["client-device"]` is the field Chrome honours, so it is what must be pinned —
 * asserting on transports alone gives false confidence.
 */
describe("passkey ceremonies request the on-device authenticator UI", () => {
  it("authenticate options carry hints: ['client-device']", async () => {
    vi.mocked(listPasskeys).mockResolvedValue([
      {
        id: "pk-1",
        credentialId: "Y3JlZC0x",
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ["internal"],
        friendlyName: "Win32",
      },
    ]);

    const body = await (await AUTH_POST(req())).json();
    expect(body.hints).toEqual(["client-device"]);
  });

  it("register options carry hints AND pin platform attachment", async () => {
    vi.mocked(listPasskeys).mockResolvedValue([]);

    const body = await (await REG_POST(req())).json();
    expect(body.hints).toEqual(["client-device"]);
    // Without this, a phone could enrol as the admin authenticator.
    expect(body.authenticatorSelection.authenticatorAttachment).toBe("platform");
  });

  it("still returns the challenge the cookie is signed against", async () => {
    vi.mocked(listPasskeys).mockResolvedValue([]);
    const res = await REG_POST(req());
    const body = await res.json();
    // Adding `hints` must not disturb the ceremony payload itself.
    expect(typeof body.challenge).toBe("string");
    expect(body.challenge.length).toBeGreaterThan(0);
    expect(res.headers.get("set-cookie")).toContain("dd_admin_webauthn_chal");
  });
});
