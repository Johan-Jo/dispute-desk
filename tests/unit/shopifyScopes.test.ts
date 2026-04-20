import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseTomlScopes(toml: string): string {
  // Minimal parser: finds the [access_scopes] section and extracts
  // scopes = "..." — avoids pulling in a TOML dep for one test.
  const sectionMatch = toml.match(/\[access_scopes\]([\s\S]*?)(?=\n\[|\n*$)/);
  if (!sectionMatch) throw new Error("[access_scopes] section not found in shopify.app.toml");
  const scopesLine = sectionMatch[1].match(/^\s*scopes\s*=\s*"([^"]+)"/m);
  if (!scopesLine) throw new Error("scopes key not found under [access_scopes]");
  return scopesLine[1];
}

function parseEnvExampleScopes(env: string): string {
  const match = env.match(/^SHOPIFY_SCOPES=(.+)$/m);
  if (!match) throw new Error("SHOPIFY_SCOPES not found in .env.example");
  return match[1].trim();
}

function normalize(scopes: string): string[] {
  return scopes.split(",").map((s) => s.trim()).filter(Boolean).sort();
}

describe("Shopify scopes drift guard", () => {
  const repoRoot = resolve(__dirname, "..", "..");
  const tomlScopes = parseTomlScopes(readFileSync(resolve(repoRoot, "shopify.app.toml"), "utf8"));
  const envScopes = parseEnvExampleScopes(readFileSync(resolve(repoRoot, ".env.example"), "utf8"));

  it(".env.example SHOPIFY_SCOPES matches shopify.app.toml [access_scopes].scopes", () => {
    // Managed install grants the TOML scope set; buildAuthUrl uses SHOPIFY_SCOPES
    // from env. A mismatch breaks install and is a known cause of the post-install
    // white-screen / redirect loop.
    expect(normalize(envScopes)).toEqual(normalize(tomlScopes));
  });

  beforeEach(() => {
    vi.resetModules();
  });

  it("buildAuthUrl embeds the env scope string verbatim", async () => {
    process.env.SHOPIFY_API_KEY = "test_key";
    process.env.SHOPIFY_API_SECRET = "test_secret";
    process.env.SHOPIFY_APP_URL = "https://example.test";
    process.env.SHOPIFY_SCOPES = tomlScopes;
    const mod = await import("@/lib/shopify/auth");
    const url = mod.buildAuthUrl("test.myshopify.com", "state123");
    expect(url).toContain(`&scope=${tomlScopes}`);
  });

  it("buildAuthUrl throws when SHOPIFY_SCOPES is unset", async () => {
    process.env.SHOPIFY_API_KEY = "test_key";
    process.env.SHOPIFY_API_SECRET = "test_secret";
    process.env.SHOPIFY_APP_URL = "https://example.test";
    delete process.env.SHOPIFY_SCOPES;
    const mod = await import("@/lib/shopify/auth");
    expect(() => mod.buildAuthUrl("test.myshopify.com", "state123")).toThrow(
      /SHOPIFY_SCOPES/,
    );
  });
});
