import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CONSENT_COOKIE_NAME, CONSENT_VALUE_ANALYTICS } from "@/lib/consent/constants";
import { readMetaAttribution, sendMetaInstall } from "@/lib/analytics/metaInstall";

function req(cookie: string): Request {
  return new Request("https://disputedesk.app/api/auth/shopify/callback", {
    headers: { cookie, "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "UA/1" },
  });
}

describe("readMetaAttribution", () => {
  it("reads consent, fbp, fbc, ip and user agent", () => {
    const a = readMetaAttribution(
      req(`${CONSENT_COOKIE_NAME}=${encodeURIComponent(CONSENT_VALUE_ANALYTICS)}; _fbp=fb.1.1.2; _fbc=fb.1.1.abc`),
    );
    expect(a).toMatchObject({
      consented: true,
      fbp: "fb.1.1.2",
      fbc: "fb.1.1.abc",
      clientIp: "203.0.113.9",
      userAgent: "UA/1",
    });
  });

  it("is not consented without the analytics cookie value", () => {
    expect(readMetaAttribution(req("_fbp=fb.1.1.2")).consented).toBe(false);
    expect(
      readMetaAttribution(req(`${CONSENT_COOKIE_NAME}=${encodeURIComponent("v1:essential")}`)).consented,
    ).toBe(false);
  });
});

describe("sendMetaInstall", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("META_CAPI_ACCESS_TOKEN", "tok");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends nothing when there is no owner email and no consented browser signals", async () => {
    await sendMetaInstall({ shopDomain: "a.myshopify.com", email: null, attribution: undefined });
    await sendMetaInstall({
      shopDomain: "a.myshopify.com",
      email: null,
      attribution: { consented: false, fbp: "p", fbc: null, clientIp: "1.2.3.4", userAgent: "UA", sourceUrl: null },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still sends for an install that never touched our site (no attribution) (hashed email only)", async () => {
    await sendMetaInstall({ shopDomain: "b.myshopify.com", email: "Owner@X.com", attribution: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const ev = JSON.parse(fetchMock.mock.calls[0][1].body).data[0];
    expect(ev.event_name).toBe("CompleteRegistration");
    expect(ev.event_id).toBe("install:b.myshopify.com");
    expect(ev.user_data.em[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.user_data).not.toHaveProperty("client_ip_address");
    expect(ev.user_data).not.toHaveProperty("client_user_agent");
    expect(ev.user_data).not.toHaveProperty("fbp");
  });

  it("drops browser signals when the cookies show no consent", async () => {
    await sendMetaInstall({
      shopDomain: "c.myshopify.com",
      email: "o@x.com",
      attribution: { consented: false, fbp: "p", fbc: "c", clientIp: "1.2.3.4", userAgent: "UA", sourceUrl: null },
    });
    const ev = JSON.parse(fetchMock.mock.calls[0][1].body).data[0];
    expect(ev.user_data).not.toHaveProperty("client_ip_address");
    expect(ev.user_data).not.toHaveProperty("fbc");
  });

  it("sends one CompleteRegistration with a per-shop event id and hashed email when consented", async () => {
    await sendMetaInstall({
      shopDomain: "a.myshopify.com",
      email: "Owner@X.com",
      attribution: { consented: true, fbp: "fb.1.1.2", fbc: "fb.1.1.abc", clientIp: "203.0.113.9", userAgent: "UA/1", sourceUrl: null },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const ev = body.data[0];
    expect(ev.event_name).toBe("CompleteRegistration");
    expect(ev.event_id).toBe("install:a.myshopify.com");
    expect(ev.user_data.em[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.user_data.em[0]).not.toContain("owner");
    expect(ev.user_data.fbc).toBe("fb.1.1.abc");
    expect(ev.custom_data).toEqual({ content_name: "shopify_app_install", shop_domain: "a.myshopify.com" });
  });
});
