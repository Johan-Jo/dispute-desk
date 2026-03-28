import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";

describe("getPublicSiteBaseUrl", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    vi.stubEnv("PUBLIC_CANONICAL_URL", undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses NEXT_PUBLIC_APP_URL when set", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com/");
    expect(getPublicSiteBaseUrl()).toBe("https://example.com");
  });

  it("uses PUBLIC_CANONICAL_URL when NEXT_PUBLIC is unset", () => {
    vi.stubEnv("PUBLIC_CANONICAL_URL", "https://canonical.example/");
    expect(getPublicSiteBaseUrl()).toBe("https://canonical.example");
  });

  it("defaults to disputedesk.app (never preview VERCEL_URL)", () => {
    vi.stubEnv("VERCEL_URL", "branch-abc-foo.vercel.app");
    expect(getPublicSiteBaseUrl()).toBe("https://disputedesk.app");
  });
});
