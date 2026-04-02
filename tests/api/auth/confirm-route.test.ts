import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/supabase/portal", () => ({
  createPortalClient: vi.fn(),
}));

vi.mock("@/lib/email/sendWelcome", () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/email/sendAdminNotification", () => ({
  sendAdminSignupNotification: vi.fn().mockResolvedValue(undefined),
}));

import { GET } from "@/app/api/auth/confirm/route";
import { createPortalClient } from "@/lib/supabase/portal";
import { cookies } from "next/headers";
import { sendWelcomeEmail } from "@/lib/email/sendWelcome";

const mockCookies = vi.mocked(cookies);
const mockCreatePortalClient = vi.mocked(createPortalClient);
const mockSendWelcome = vi.mocked(sendWelcomeEmail);

function mockCookieStore() {
  return {
    get: vi.fn().mockReturnValue(undefined),
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  };
}

describe("GET /api/auth/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue(mockCookieStore() as never);
  });

  it("calls verifyOtp with token_hash and type=signup — not exchangeCodeForSession", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({
      data: {
        user: { email: "user@example.com", user_metadata: { full_name: "Test" } },
      },
      error: null,
    });
    const exchangeCodeForSession = vi.fn();
    mockCreatePortalClient.mockResolvedValue({
      auth: { verifyOtp, exchangeCodeForSession },
    } as never);

    const req = new Request(
      "http://localhost:3000/api/auth/confirm?token_hash=fakehash&type=signup&redirect=/portal/dashboard",
    );
    const res = await GET(req);

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledWith({
      type: "signup",
      token_hash: "fakehash",
    });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/portal/dashboard");
    expect(mockSendWelcome).toHaveBeenCalled();
  });

  it("verifyOtp for magiclink does not send welcome email", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({
      data: { user: { email: "u@e.com", user_metadata: {} } },
      error: null,
    });
    mockCreatePortalClient.mockResolvedValue({
      auth: { verifyOtp, exchangeCodeForSession: vi.fn() },
    } as never);

    const req = new Request(
      "http://localhost:3000/api/auth/confirm?token_hash=h&type=magiclink&redirect=/portal/dashboard",
    );
    await GET(req);

    expect(mockSendWelcome).not.toHaveBeenCalled();
  });

  it("redirects to sign-in when verifyOtp returns error", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { message: "invalid or expired token" },
    });
    mockCreatePortalClient.mockResolvedValue({
      auth: { verifyOtp, exchangeCodeForSession: vi.fn() },
    } as never);

    const req = new Request(
      "http://localhost:3000/api/auth/confirm?token_hash=bad&type=magiclink",
    );
    const res = await GET(req);
    expect(res.headers.get("location")).toContain("/auth/sign-in");
    expect(res.headers.get("location")).toContain("error=invalid_code");
  });

  it("calls exchangeCodeForSession when only code is present (PKCE legacy)", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({
      data: {
        user: { email: "user@example.com", user_metadata: {} },
      },
      error: null,
    });
    const verifyOtp = vi.fn();
    mockCreatePortalClient.mockResolvedValue({
      auth: { verifyOtp, exchangeCodeForSession },
    } as never);

    const req = new Request(
      "http://localhost:3000/api/auth/confirm?code=pkce-code&type=signup&redirect=/portal/x",
    );
    const res = await GET(req);

    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("http://localhost:3000/portal/x");
  });

  it("redirects no_code when neither token_hash nor code", async () => {
    mockCreatePortalClient.mockResolvedValue({
      auth: {
        verifyOtp: vi.fn(),
        exchangeCodeForSession: vi.fn(),
      },
    } as never);

    const req = new Request("http://localhost:3000/api/auth/confirm?type=signup");
    const res = await GET(req);
    expect(res.headers.get("location")).toContain("error=no_code");
  });
});
