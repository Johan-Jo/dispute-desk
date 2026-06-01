import { describe, expect, it } from "vitest";
import { isMarketingIntlRoute } from "@/lib/i18n/marketingRoutes";

describe("isMarketingIntlRoute", () => {
  it("treats home, hub paths, locale prefixes, and privacy as marketing", () => {
    expect(isMarketingIntlRoute("/")).toBe(true);
    expect(isMarketingIntlRoute("/resources")).toBe(true);
    expect(isMarketingIntlRoute("/de/resources/foo")).toBe(true);
    expect(isMarketingIntlRoute("/privacy")).toBe(true);
    expect(isMarketingIntlRoute("/de/privacy")).toBe(true);
  });

  it("treats the playbook lead funnel as marketing (so the language switcher works)", () => {
    expect(isMarketingIntlRoute("/playbook")).toBe(true);
    expect(isMarketingIntlRoute("/playbook/read")).toBe(true);
    expect(isMarketingIntlRoute("/playbook/sequence")).toBe(true);
    expect(isMarketingIntlRoute("/de/playbook")).toBe(true);
  });

  it("excludes app surfaces", () => {
    expect(isMarketingIntlRoute("/portal/dashboard")).toBe(false);
    expect(isMarketingIntlRoute("/app")).toBe(false);
    expect(isMarketingIntlRoute("/admin")).toBe(false);
    expect(isMarketingIntlRoute("/auth/sign-in")).toBe(false);
    expect(isMarketingIntlRoute("/api/health")).toBe(false);
  });
});
