import { describe, it, expect } from "vitest";
import {
  PORTAL_API_PREFIXES,
  isPortalApiPath,
} from "@/lib/middleware/portalApiPrefixes";

/**
 * APIs that portal pages call (Supabase Auth + active_shop, no Shopify session).
 * If a portal page calls an API not in PORTAL_API_PREFIXES, middleware returns 401.
 * When adding a new portal feature that calls an API, add its prefix to
 * lib/middleware/portalApiPrefixes.ts AND to this list so the test fails if we forget.
 */
const PORTAL_APIS_WE_USE = [
  "/api/portal/",
  "/api/setup/",
  "/api/integrations/",
  "/api/files/samples",
  "/api/disputes",
  "/api/packs",
  "/api/policies",
  "/api/policy-templates",
  "/api/templates",
  "/api/billing",
  "/api/rules",
] as const;

describe("Portal API prefixes (middleware allowlist)", () => {
  it("includes every API prefix that portal pages call", () => {
    const set = new Set(PORTAL_API_PREFIXES);
    for (const prefix of PORTAL_APIS_WE_USE) {
      expect(
        set.has(prefix),
        `Portal uses ${prefix} but it is not in PORTAL_API_PREFIXES. Add it to lib/middleware/portalApiPrefixes.ts`
      ).toBe(true);
    }
  });

  it("isPortalApiPath returns true for template list and install", () => {
    expect(isPortalApiPath("/api/templates")).toBe(true);
    expect(isPortalApiPath("/api/templates/abc-123/install")).toBe(true);
    expect(isPortalApiPath("/api/templates/abc-123/preview")).toBe(true);
  });

  it("isPortalApiPath returns true for policy-templates", () => {
    expect(isPortalApiPath("/api/policy-templates")).toBe(true);
    expect(isPortalApiPath("/api/policy-templates/terms/content")).toBe(true);
  });

  it("isPortalApiPath returns true for portal switch-demo and switch-shop", () => {
    expect(isPortalApiPath("/api/portal/switch-demo")).toBe(true);
    expect(isPortalApiPath("/api/portal/switch-shop")).toBe(true);
  });

  it("isPortalApiPath returns false for non-portal APIs", () => {
    expect(isPortalApiPath("/api/automation/settings")).toBe(false);
    expect(isPortalApiPath("/api/jobs/worker")).toBe(false);
  });
});
