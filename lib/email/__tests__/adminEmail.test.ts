/**
 * Coverage for `sendAdminEmail` — the shared Resend wrapper for admin alerts.
 *
 * Pins the diagnosability contract added 2026-05-31 after a new-merchant
 * install notification went missing and the path was effectively a black box:
 *
 *   1. A successful send logs an info marker (with the Resend message id) so
 *      delivery attempts are visible in Vercel logs.
 *   2. A Resend API-level rejection (returned in `{ error }`, NOT thrown by
 *      the SDK) is surfaced as console.error — previously it was silently
 *      ignored, so "no email" left zero trace.
 *   3. A thrown/network error is logged, never rethrown (non-blocking).
 *   4. A missing RESEND_API_KEY is a silent skip (warn), never a throw.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.RESEND_API_KEY = "test-key";

interface ResendSendArgs {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}
// Mutable response so each test can choose success / API-error / throw.
let sendImpl: (args: ResendSendArgs) => Promise<unknown> = async () => ({
  data: { id: "msg-success" },
  error: null,
});
const sendMock = vi.fn((args: ResendSendArgs) => sendImpl(args));

vi.mock("resend", () => {
  class FakeResend {
    emails = { send: sendMock };
    constructor(_apiKey?: string) {
      // no-op
    }
  }
  return { Resend: FakeResend };
});

const BASE = {
  subject: "s",
  html: "<p>h</p>",
  text: "t",
  logTag: "test-tag",
};

describe("sendAdminEmail diagnosability", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sendImpl = async () => ({ data: { id: "msg-success" }, error: null });
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("logs an info success marker with the Resend message id", async () => {
    const { sendAdminEmail } = await import("@/lib/email/adminEmail");
    await sendAdminEmail({ ...BASE, to: "ops@example.com" });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalled();
    const logged = infoSpy.mock.calls[0].join(" ");
    expect(logged).toContain("[email:test-tag]");
    expect(logged).toContain("ops@example.com");
    expect(logged).toContain("msg-success");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("surfaces a Resend API-level rejection as console.error (not silent)", async () => {
    sendImpl = async () => ({
      data: null,
      error: { name: "rate_limit_exceeded", message: "Too many requests" },
    });
    const { sendAdminEmail } = await import("@/lib/email/adminEmail");
    await sendAdminEmail({ ...BASE });

    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls[0].join(" ");
    expect(logged).toContain("[email:test-tag]");
    expect(logged).toContain("rejected by Resend");
    // Must NOT have also logged success.
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("logs (never rethrows) when the SDK throws", async () => {
    sendImpl = async () => {
      throw new Error("network down");
    };
    const { sendAdminEmail } = await import("@/lib/email/adminEmail");
    await expect(sendAdminEmail({ ...BASE })).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls[0].join(" ")).toContain("send failed");
  });

  it("silently skips (warn) when RESEND_API_KEY is unset", async () => {
    vi.resetModules();
    const prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const { sendAdminEmail } = await import("@/lib/email/adminEmail");
      await expect(sendAdminEmail({ ...BASE })).resolves.toBeUndefined();
      expect(sendMock).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      process.env.RESEND_API_KEY = prev;
      vi.resetModules();
    }
  });
});
