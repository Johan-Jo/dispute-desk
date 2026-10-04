import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

const processMetaLead = vi.fn();
vi.mock("@/lib/marketing/metaLeads/ingest", () => ({
  processMetaLead: (...a: unknown[]) => processMetaLead(...a),
}));

import { GET, POST } from "@/app/api/webhooks/meta-leads/route";

const SECRET = "app-secret";
const body = JSON.stringify({
  object: "page",
  entry: [{ id: "P1", changes: [{ field: "leadgen", value: { leadgen_id: "L1", form_id: "F1", page_id: "P1" } }] }],
});
const sig = (b: string) => `sha256=${createHmac("sha256", SECRET).update(b, "utf8").digest("hex")}`;
const post = (b: string, signature?: string) =>
  new NextRequest("https://disputedesk.app/api/webhooks/meta-leads", {
    method: "POST",
    body: b,
    headers: signature ? { "x-hub-signature-256": signature } : {},
  });

describe("meta-leads webhook", () => {
  beforeEach(() => {
    processMetaLead.mockReset().mockResolvedValue("stored");
    vi.stubEnv("META_APP_SECRET", SECRET);
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "vt");
    vi.stubEnv("META_PAGE_ID", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("answers Meta's handshake only with the right verify token", async () => {
    const ok = await GET(
      new NextRequest("https://x/api/webhooks/meta-leads?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=abc"),
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("abc");
    const bad = await GET(
      new NextRequest("https://x/api/webhooks/meta-leads?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc"),
    );
    expect(bad.status).toBe(403);
  });

  it("rejects an unsigned or wrongly signed POST without processing anything", async () => {
    expect((await POST(post(body))).status).toBe(401);
    expect((await POST(post(body, sig(body + "x")))).status).toBe(401);
    expect(processMetaLead).not.toHaveBeenCalled();
  });

  it("processes each leadgen notification when the signature is valid", async () => {
    const res = await POST(post(body, sig(body)));
    expect(res.status).toBe(200);
    expect(processMetaLead).toHaveBeenCalledWith({ leadgenId: "L1", formId: "F1" });
  });

  it("returns 500 when processing fails so Meta retries", async () => {
    processMetaLead.mockRejectedValue(new Error("graph down"));
    expect((await POST(post(body, sig(body)))).status).toBe(500);
  });

  it("ignores notifications for a different Page when META_PAGE_ID is set", async () => {
    vi.stubEnv("META_PAGE_ID", "OTHER");
    expect((await POST(post(body, sig(body)))).status).toBe(200);
    expect(processMetaLead).not.toHaveBeenCalled();
  });
});
