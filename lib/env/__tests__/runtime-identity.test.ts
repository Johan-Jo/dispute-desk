import { describe, expect, it } from "vitest";
import {
  validateRuntimeIdentity,
  runtimeIdentityPresence,
  RuntimeIdentityError,
} from "../runtime-identity";
import {
  KNOWN_PROD_SHOPIFY_CLIENT_ID,
  KNOWN_PROD_SUPABASE_PROJECT_REF,
  PROD_APP_URL,
  DEV_APP_URL,
} from "../build-identity";

const VALID_HEX_64 = "a".repeat(64);

function validProdSecrets() {
  return {
    APP_ENV: "production",
    NEXT_PUBLIC_APP_URL: PROD_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: `https://${KNOWN_PROD_SUPABASE_PROJECT_REF}.supabase.co`,
    SHOPIFY_API_KEY: KNOWN_PROD_SHOPIFY_CLIENT_ID,
    SUPABASE_SERVICE_ROLE_KEY: "svc.placeholder.value",
    SHOPIFY_API_SECRET: "shopify.placeholder.value",
    TOKEN_ENCRYPTION_KEY_V1: VALID_HEX_64,
    CRON_SECRET: "cron.placeholder.value",
  };
}

function validDevSecrets() {
  return {
    APP_ENV: "development",
    NEXT_PUBLIC_APP_URL: DEV_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: "https://dispute-desk-dev123.supabase.co",
    SHOPIFY_API_KEY: "abc1234567890dev",
    SUPABASE_SERVICE_ROLE_KEY: "svc.dev.placeholder",
    SHOPIFY_API_SECRET: "shopify.dev.placeholder",
    TOKEN_ENCRYPTION_KEY_V1: VALID_HEX_64,
    CRON_SECRET: "cron.dev.placeholder",
  };
}

describe("validateRuntimeIdentity — happy paths", () => {
  it("accepts valid prod secrets", () => {
    expect(() => validateRuntimeIdentity(validProdSecrets())).not.toThrow();
  });
  it("accepts valid dev secrets", () => {
    expect(() => validateRuntimeIdentity(validDevSecrets())).not.toThrow();
  });
});

describe("validateRuntimeIdentity — required secrets", () => {
  it.each([
    ["SUPABASE_SERVICE_ROLE_KEY"],
    ["SHOPIFY_API_SECRET"],
    ["TOKEN_ENCRYPTION_KEY_V1"],
    ["CRON_SECRET"],
  ])("rejects when %s is missing", (name) => {
    const env = { ...validProdSecrets(), [name]: undefined };
    expect(() => validateRuntimeIdentity(env)).toThrow(RuntimeIdentityError);
  });

  it.each([
    ["SUPABASE_SERVICE_ROLE_KEY"],
    ["SHOPIFY_API_SECRET"],
    ["TOKEN_ENCRYPTION_KEY_V1"],
    ["CRON_SECRET"],
  ])("rejects when %s is empty string", (name) => {
    const env = { ...validProdSecrets(), [name]: "" };
    expect(() => validateRuntimeIdentity(env)).toThrow(RuntimeIdentityError);
  });
});

describe("validateRuntimeIdentity — TOKEN_ENCRYPTION_KEY_V1 shape", () => {
  it("rejects too-short key", () => {
    expect(() =>
      validateRuntimeIdentity({
        ...validProdSecrets(),
        TOKEN_ENCRYPTION_KEY_V1: "a".repeat(32),
      }),
    ).toThrow(/64 hex characters/);
  });
  it("rejects non-hex characters", () => {
    expect(() =>
      validateRuntimeIdentity({
        ...validProdSecrets(),
        TOKEN_ENCRYPTION_KEY_V1: "z".repeat(64),
      }),
    ).toThrow(/64 hex characters/);
  });
  it("accepts uppercase hex", () => {
    expect(() =>
      validateRuntimeIdentity({
        ...validProdSecrets(),
        TOKEN_ENCRYPTION_KEY_V1: "A".repeat(64),
      }),
    ).not.toThrow();
  });
});

describe("validateRuntimeIdentity — dev email guard", () => {
  it("rejects dev sending from prod mail subdomain when send is enabled", () => {
    expect(() =>
      validateRuntimeIdentity({
        ...validDevSecrets(),
        EMAIL_SEND_ENABLED: "true",
        EMAIL_FROM: "DisputeDesk <notifications@mail.disputedesk.app>",
      }),
    ).toThrow(/prod sending subdomain/);
  });
  it("allows dev with EMAIL_SEND_ENABLED=false even when EMAIL_FROM references prod", () => {
    expect(() =>
      validateRuntimeIdentity({
        ...validDevSecrets(),
        EMAIL_SEND_ENABLED: "false",
        EMAIL_FROM: "DisputeDesk <notifications@mail.disputedesk.app>",
      }),
    ).not.toThrow();
  });
});

describe("runtimeIdentityPresence", () => {
  it("never returns secret values", () => {
    const presence = runtimeIdentityPresence(validProdSecrets());
    for (const item of presence) {
      const ser = JSON.stringify(item);
      expect(ser).not.toContain("svc.placeholder.value");
      expect(ser).not.toContain("shopify.placeholder.value");
      expect(ser).not.toContain("cron.placeholder.value");
      expect(ser).not.toContain(VALID_HEX_64);
    }
  });
  it("marks missing secrets as not present", () => {
    const presence = runtimeIdentityPresence({
      ...validProdSecrets(),
      CRON_SECRET: undefined,
    });
    const cron = presence.find((p) => p.name === "CRON_SECRET");
    expect(cron?.present).toBe(false);
  });
});
