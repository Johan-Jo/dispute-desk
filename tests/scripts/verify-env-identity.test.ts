import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const SCRIPT = resolve(__dirname, "..", "..", "scripts", "verify-env-identity.mjs");

const KNOWN_PROD_SUPABASE_PROJECT_REF = "aokhplydttxtebvbeuzc";
const KNOWN_PROD_SHOPIFY_CLIENT_ID = "84f40ec77c9ba18e9eabc1657d9b6af8";
const PROD_APP_URL = "https://disputedesk.app";
const DEV_APP_URL = "https://dev.disputedesk.app";
const VALID_HEX_64 = "a".repeat(64);

function runScript(env: Record<string, string | undefined>): { code: number; out: string } {
  // Build a fully-isolated env — start empty, no inheritance, so the
  // operator's real shell env can't accidentally pass a strict check.
  const cleanEnv: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    // dotenv inside the script will read .env.local, which on the dev's
    // machine contains real dev/prod creds. To avoid that interference,
    // point dotenv at a non-existent file via PWD override is messy;
    // simpler: trust that the test sets explicit values and overrides
    // anything dotenv injects (process.env already-set wins over .env).
  };
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) cleanEnv[k] = v;
  }
  const result = spawnSync("node", [SCRIPT], {
    env: cleanEnv as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  return {
    code: result.status ?? -1,
    out: (result.stdout || "") + (result.stderr || ""),
  };
}

const validProd = {
  APP_ENV: "production",
  NEXT_PUBLIC_APP_URL: PROD_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: `https://${KNOWN_PROD_SUPABASE_PROJECT_REF}.supabase.co`,
  SHOPIFY_API_KEY: KNOWN_PROD_SHOPIFY_CLIENT_ID,
  SUPABASE_SERVICE_ROLE_KEY: "svc-key",
  SHOPIFY_API_SECRET: "shop-secret",
  TOKEN_ENCRYPTION_KEY_V1: VALID_HEX_64,
  CRON_SECRET: "cron-secret",
};

const validDev = {
  APP_ENV: "development",
  NEXT_PUBLIC_APP_URL: DEV_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: "https://vrpkgudqmpyunekrkpnc.supabase.co",
  SHOPIFY_API_KEY: "bbb7c00568ffb57fecd789fa0580e309",
  SUPABASE_SERVICE_ROLE_KEY: "svc-key",
  SHOPIFY_API_SECRET: "shop-secret",
  TOKEN_ENCRYPTION_KEY_V1: VALID_HEX_64,
  CRON_SECRET: "cron-secret",
};

describe("verify-env-identity.mjs CLI — happy paths", () => {
  it("passes for a fully valid production env", () => {
    const r = runScript(validProd);
    expect(r.code).toBe(0);
    expect(r.out).toContain("all checks passed");
  });
  it("passes for a fully valid development env", () => {
    const r = runScript(validDev);
    expect(r.code).toBe(0);
    expect(r.out).toContain("all checks passed");
  });
  it("passes (informational) when APP_ENV is unset (Phase 0 tolerance)", () => {
    const r = runScript({ APP_ENV: undefined });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/APP_ENV is unset/);
  });
});

describe("verify-env-identity.mjs CLI — refuses deliberately broken combos", () => {
  it("refuses dev pointed at prod Supabase URL", () => {
    const r = runScript({
      ...validDev,
      NEXT_PUBLIC_SUPABASE_URL: `https://${KNOWN_PROD_SUPABASE_PROJECT_REF}.supabase.co`,
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/production ref/);
  });

  it("refuses dev using the prod Shopify client_id", () => {
    const r = runScript({
      ...validDev,
      SHOPIFY_API_KEY: KNOWN_PROD_SHOPIFY_CLIENT_ID,
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/known prod client_id/);
  });

  it("refuses prod whose app URL is not disputedesk.app", () => {
    const r = runScript({
      ...validProd,
      NEXT_PUBLIC_APP_URL: "https://staging.example.com",
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/NEXT_PUBLIC_APP_URL/);
  });

  it("refuses prod whose Supabase ref isn't the known prod ref", () => {
    const r = runScript({
      ...validProd,
      NEXT_PUBLIC_SUPABASE_URL: "https://someotherprojectref.supabase.co",
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/expected "aokhplydttxtebvbeuzc"/);
  });

  it("refuses dev pointed at the prod app URL", () => {
    const r = runScript({
      ...validDev,
      NEXT_PUBLIC_APP_URL: PROD_APP_URL,
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/dev build at the production hostname/);
  });

  it("refuses dev with CRON_ENABLED=true and no override", () => {
    const r = runScript({
      ...validDev,
      CRON_ENABLED: "true",
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/CRON_ENABLED_DEV_OVERRIDE/);
  });

  it("refuses any APP_ENV value other than development|production", () => {
    const r = runScript({
      ...validProd,
      APP_ENV: "staging",
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/APP_ENV must be/);
  });

  it("refuses missing SHOPIFY_API_SECRET when APP_ENV is set", () => {
    const r = runScript({
      ...validProd,
      SHOPIFY_API_SECRET: undefined,
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/SHOPIFY_API_SECRET/);
  });

  it("refuses missing TOKEN_ENCRYPTION_KEY_V1 when APP_ENV is set", () => {
    const r = runScript({
      ...validProd,
      TOKEN_ENCRYPTION_KEY_V1: undefined,
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/TOKEN_ENCRYPTION_KEY_V1/);
  });

  it("refuses wrong-shape TOKEN_ENCRYPTION_KEY_V1 (not 64 hex)", () => {
    const r = runScript({
      ...validProd,
      TOKEN_ENCRYPTION_KEY_V1: "a".repeat(32),
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/64 hex characters/);
  });

  it("refuses dev sending from prod mail subdomain when send is enabled", () => {
    const r = runScript({
      ...validDev,
      EMAIL_SEND_ENABLED: "true",
      EMAIL_FROM: "DisputeDesk <notifications@mail.disputedesk.app>",
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/prod sending subdomain/);
  });
});
