/**
 * Contract tests for the merchant-message respond route.
 *
 * The three things that must hold:
 *   1. A reply with neither email nor phone is rejected (the banner
 *      asks for "email or phone" — empty is not an answer).
 *   2. The write is scoped by shop_id, so a message id belonging to
 *      another shop cannot be answered from this session.
 *   3. Merchant-supplied text is HTML-escaped before it reaches the
 *      ops inbox.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendEmail = vi.fn().mockResolvedValue({ data: { id: "e1" }, error: null });
const eqCalls: Array<[string, unknown]> = [];
const updateCalls: Array<Record<string, unknown>> = [];
let updateResult: { data: unknown; error: unknown } = {
  data: { id: "msg-1" },
  error: null,
};

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => sendEmail(...args) };
  },
}));

vi.mock("@/lib/middleware/extractShopId", () => ({
  extractShopId: () => "shop-1",
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      if (table === "merchant_messages") {
        const chain: Record<string, unknown> = {};
        chain.update = (payload: Record<string, unknown>) => {
          updateCalls.push(payload);
          return chain;
        };
        chain.eq = (col: string, val: unknown) => {
          eqCalls.push([col, val]);
          return chain;
        };
        chain.select = () => chain;
        chain.maybeSingle = async () => updateResult;
        return chain;
      }
      if (table === "shops") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { shop_domain: "s.myshopify.com", shop_name: "S" },
              }),
            }),
          }),
        };
      }
      return { insert: async () => ({ error: null }) };
    },
  }),
}));

import { POST } from "@/app/api/dashboard/message/respond/route";

function req(body: unknown) {
  return new Request("http://localhost/api/dashboard/message/respond", {
    method: "POST",
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  // The route short-circuits without a key, which is exactly the dev
  // behaviour we want covered separately — set one for the happy paths.
  process.env.RESEND_API_KEY = "re_test_key";
  sendEmail.mockClear();
  eqCalls.length = 0;
  updateCalls.length = 0;
  updateResult = { data: { id: "msg-1" }, error: null };
});

describe("POST /api/dashboard/message/respond", () => {
  it("rejects a reply with neither email nor phone", async () => {
    const res = await POST(req({ messageId: "msg-1" }));
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("accepts phone alone (either channel is a complete answer)", async () => {
    const res = await POST(req({ messageId: "msg-1", phone: "+49 30 1234" }));
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("scopes the update by shop_id as well as message id", async () => {
    await POST(req({ messageId: "msg-1", email: "a@b.de" }));
    expect(eqCalls).toEqual(
      expect.arrayContaining([
        ["id", "msg-1"],
        ["shop_id", "shop-1"],
      ]),
    );
  });

  it("404s when the id does not belong to this shop", async () => {
    updateResult = { data: null, error: null };
    const res = await POST(req({ messageId: "other-shop-msg", email: "a@b.de" }));
    expect(res.status).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("records a delivery failure rather than reporting silent success", async () => {
    sendEmail.mockResolvedValueOnce({
      data: null,
      error: { message: "domain not verified" },
    });
    const res = await POST(req({ messageId: "msg-1", email: "a@b.de" }));
    // The reply is stored regardless — losing it because the mail
    // bounced would be strictly worse than a missing notification.
    expect(res.status).toBe(200);
    const errorWrite = updateCalls.find(
      (u) => typeof u.response_notify_error === "string",
    );
    expect(errorWrite?.response_notify_error).toBe("domain not verified");
  });

  it("marks the row notified when the send is accepted", async () => {
    await POST(req({ messageId: "msg-1", email: "a@b.de" }));
    const okWrite = updateCalls.find((u) => u.response_notified_at != null);
    expect(okWrite).toBeTruthy();
  });

  it("stores the name and puts it in the ops email", async () => {
    await POST(
      req({ messageId: "msg-1", name: "Hans Meier", email: "h@m.de" }),
    );
    const write = updateCalls.find((u) => "response_name" in u);
    expect(write?.response_name).toBe("Hans Meier");
    const mail = sendEmail.mock.calls[0][0] as { text: string };
    expect(mail.text).toContain("Hans Meier");
  });

  it("still requires a contact channel — a name alone is not reachable", async () => {
    const res = await POST(req({ messageId: "msg-1", name: "Hans Meier" }));
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("escapes merchant-supplied text before it reaches the ops inbox", async () => {
    await POST(
      req({
        messageId: "msg-1",
        email: "a@b.de",
        note: "<script>alert(1)</script>",
      }),
    );
    const call = sendEmail.mock.calls[0][0] as { html: string };
    expect(call.html).not.toContain("<script>");
    expect(call.html).toContain("&lt;script&gt;");
  });
});
