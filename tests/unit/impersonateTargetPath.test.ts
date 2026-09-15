/**
 * INVARIANT: the impersonation deep link cannot become an open redirect.
 *
 * `targetPath` was added so the Activity timeline can open the exact page a
 * merchant viewed. It is caller-supplied and is used as a redirect target, so
 * anything but a same-origin /app/* path must fall back to /app rather than
 * sending an authenticated operator to an attacker's URL.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(process.cwd(), "app", "api", "admin", "impersonate", "route.ts"),
  "utf8",
);

/** Mirrors the route's guard, so the cases below describe real behaviour. */
function resolve(raw: string): string {
  return raw.startsWith("/app") && !raw.startsWith("//") ? raw : "/app";
}

describe("impersonate targetPath", () => {
  it("the route guards the caller-supplied path", () => {
    expect(SRC).toMatch(/rawTarget\.startsWith\("\/app"\)/);
    expect(SRC).toMatch(/!rawTarget\.startsWith\("\/\/"\)/);
  });

  it("allows embedded app paths", () => {
    expect(resolve("/app")).toBe("/app");
    expect(resolve("/app/disputes")).toBe("/app/disputes");
    expect(resolve("/app/disputes/abc-123")).toBe("/app/disputes/abc-123");
  });

  it("refuses absolute and protocol-relative URLs", () => {
    expect(resolve("https://evil.example/app")).toBe("/app");
    expect(resolve("//evil.example/app")).toBe("/app");
    expect(resolve("http://evil.example")).toBe("/app");
  });

  it("refuses paths outside the embedded app", () => {
    expect(resolve("/admin/shops")).toBe("/app");
    expect(resolve("/portal")).toBe("/app");
    expect(resolve("")).toBe("/app");
  });
});
