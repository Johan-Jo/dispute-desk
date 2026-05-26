import { describe, expect, it } from "vitest";
import {
  validateBuildIdentity,
  BuildIdentityError,
  KNOWN_PROD_SUPABASE_PROJECT_REF,
  KNOWN_PROD_SHOPIFY_CLIENT_ID,
  PROD_APP_URL,
  DEV_APP_URL,
  buildIdentitySummary,
} from "../build-identity";

function validProd() {
  return {
    APP_ENV: "production",
    NEXT_PUBLIC_APP_URL: PROD_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: `https://${KNOWN_PROD_SUPABASE_PROJECT_REF}.supabase.co`,
    SHOPIFY_API_KEY: KNOWN_PROD_SHOPIFY_CLIENT_ID,
    CRON_ENABLED: "true",
  };
}

function validDev() {
  return {
    APP_ENV: "development",
    NEXT_PUBLIC_APP_URL: DEV_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: "https://dispute-desk-dev123.supabase.co",
    SHOPIFY_API_KEY: "abc1234567890dev",
    CRON_ENABLED: "false",
  };
}

describe("validateBuildIdentity — happy paths", () => {
  it("accepts a fully valid production env", () => {
    expect(() => validateBuildIdentity(validProd())).not.toThrow();
  });
  it("accepts a fully valid development env", () => {
    expect(() => validateBuildIdentity(validDev())).not.toThrow();
  });
});

describe("validateBuildIdentity — APP_ENV failures", () => {
  it("rejects unset APP_ENV", () => {
    expect(() => validateBuildIdentity({})).toThrow(BuildIdentityError);
  });
  it("rejects unknown APP_ENV values", () => {
    expect(() =>
      validateBuildIdentity({ ...validProd(), APP_ENV: "staging" }),
    ).toThrow(/APP_ENV must be/);
  });
});

describe("validateBuildIdentity — APP_URL failures", () => {
  it("rejects prod with non-prod APP_URL", () => {
    expect(() =>
      validateBuildIdentity({
        ...validProd(),
        NEXT_PUBLIC_APP_URL: "https://preview.vercel.app",
      }),
    ).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
  it("rejects dev pointed at the prod APP_URL", () => {
    expect(() =>
      validateBuildIdentity({
        ...validDev(),
        NEXT_PUBLIC_APP_URL: PROD_APP_URL,
      }),
    ).toThrow(/dev build at the production hostname/);
  });
});

describe("validateBuildIdentity — Supabase ref failures", () => {
  it("rejects dev pointed at the prod Supabase ref", () => {
    expect(() =>
      validateBuildIdentity({
        ...validDev(),
        NEXT_PUBLIC_SUPABASE_URL: `https://${KNOWN_PROD_SUPABASE_PROJECT_REF}.supabase.co`,
      }),
    ).toThrow(/production ref/);
  });
  it("rejects prod NOT pointed at the prod Supabase ref", () => {
    expect(() =>
      validateBuildIdentity({
        ...validProd(),
        NEXT_PUBLIC_SUPABASE_URL: "https://wrong-project.supabase.co",
      }),
    ).toThrow(/expected the known prod ref/);
  });
  it("falls back to SUPABASE_URL if NEXT_PUBLIC_SUPABASE_URL is unset", () => {
    const env = {
      ...validDev(),
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      SUPABASE_URL: `https://${KNOWN_PROD_SUPABASE_PROJECT_REF}.supabase.co`,
    };
    expect(() => validateBuildIdentity(env)).toThrow(/production ref/);
  });
});

describe("validateBuildIdentity — Shopify client_id failures", () => {
  it("rejects dev using the prod client_id", () => {
    expect(() =>
      validateBuildIdentity({
        ...validDev(),
        SHOPIFY_API_KEY: KNOWN_PROD_SHOPIFY_CLIENT_ID,
      }),
    ).toThrow(/dev Partners app/);
  });
  it("rejects prod not using the prod client_id", () => {
    expect(() =>
      validateBuildIdentity({
        ...validProd(),
        SHOPIFY_API_KEY: "some-other-client-id",
      }),
    ).toThrow(/expected the known prod client_id/);
  });
  it("accepts SHOPIFY_CLIENT_ID alias when SHOPIFY_API_KEY is unset", () => {
    expect(() =>
      validateBuildIdentity({
        ...validProd(),
        SHOPIFY_API_KEY: undefined,
        SHOPIFY_CLIENT_ID: KNOWN_PROD_SHOPIFY_CLIENT_ID,
      }),
    ).not.toThrow();
  });
});

describe("validateBuildIdentity — CRON_ENABLED in dev", () => {
  it("rejects dev with CRON_ENABLED=true and no override", () => {
    expect(() =>
      validateBuildIdentity({
        ...validDev(),
        CRON_ENABLED: "true",
      }),
    ).toThrow(/CRON_ENABLED_DEV_OVERRIDE=true/);
  });
  it("accepts dev with CRON_ENABLED=true when override is true", () => {
    expect(() =>
      validateBuildIdentity({
        ...validDev(),
        CRON_ENABLED: "true",
        CRON_ENABLED_DEV_OVERRIDE: "true",
      }),
    ).not.toThrow();
  });
});

describe("buildIdentitySummary", () => {
  it("includes only non-secret fingerprints", () => {
    const s = buildIdentitySummary(validProd());
    expect(s).toContain("APP_ENV=production");
    expect(s).toContain("disputedesk.app");
    expect(s).toContain("supabaseRefFp=sddzuglx");
    expect(s).toContain("shopifyClientIdFp=84f40ec7");
    expect(s).not.toContain(KNOWN_PROD_SHOPIFY_CLIENT_ID); // full id not echoed
  });
  it("never crashes on partial input", () => {
    expect(() => buildIdentitySummary({})).not.toThrow();
  });
});
