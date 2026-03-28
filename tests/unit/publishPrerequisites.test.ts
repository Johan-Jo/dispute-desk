import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_HUB_TAG_KEYS,
  defaultHubMarketingUrl,
  parseDefaultCtaPreference,
} from "@/lib/resources/generation/publishPrerequisites";

describe("publishPrerequisites", () => {
  describe("defaultHubMarketingUrl", () => {
    beforeEach(() => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("uses NEXT_PUBLIC_APP_URL when set", () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com/");
      expect(defaultHubMarketingUrl()).toBe("https://example.com");
    });

    it("falls back to production marketing host when unset", () => {
      expect(defaultHubMarketingUrl()).toBe("https://disputedesk.app");
    });
  });

  it("DEFAULT_HUB_TAG_KEYS has three distinct keys for min_3_tags", () => {
    expect(DEFAULT_HUB_TAG_KEYS.length).toBe(3);
    expect(new Set(DEFAULT_HUB_TAG_KEYS).size).toBe(3);
  });

  describe("parseDefaultCtaPreference", () => {
    it("returns null for none and empty", () => {
      expect(parseDefaultCtaPreference({ defaultCta: "none" })).toBeNull();
      expect(parseDefaultCtaPreference({ defaultCta: "" })).toBeNull();
      expect(parseDefaultCtaPreference({})).toBeNull();
    });

    it("returns event_name token for Free Trial setting", () => {
      expect(parseDefaultCtaPreference({ defaultCta: "free_trial" })).toBe("free_trial");
    });
  });
});
