/**
 * INVARIANT: the Activity row opens the merchant page by passing the URL to
 * window.open — never by opening a blank tab and steering it afterwards.
 *
 * WHY. The first version did this:
 *
 *     const w = window.open("", "_blank", "noopener");
 *     ...await fetch...
 *     if (w) w.location.href = data.targetUrl;
 *
 * `noopener` makes `window.open` return **null by design** — that is the whole
 * point of the flag, severing the opener relationship. So `w` was always null,
 * the assignment never ran, and clicking a row opened an empty tab that stayed
 * empty. Reported as "det funkar inte" after it had been declared verified.
 *
 * Every server-side assertion passed throughout: the route returned the right
 * targetUrl, the destination pages rendered 200. The break was entirely in the
 * browser half, which is why this pins the call shape from source — the one
 * part a route test cannot reach.
 *
 * ViewAsMerchant has always done it correctly (window.open(url, ...) after the
 * fetch); this keeps the two consistent.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(process.cwd(), "components", "admin", "ShopActivity.tsx"),
  "utf8",
);

describe("Activity row opens a real tab", () => {
  it("passes the resolved URL straight to window.open", () => {
    expect(SRC).toMatch(/window\.open\(\s*data\.targetUrl/);
  });

  it("never opens a blank tab to steer later — noopener returns null", () => {
    expect(SRC).not.toMatch(/window\.open\(\s*""/);
    expect(SRC).not.toMatch(/\bw\.location\.href\s*=/);
  });

  it("matches the shape ViewAsMerchant already ships", () => {
    const vam = readFileSync(
      join(process.cwd(), "components", "admin", "ViewAsMerchant.tsx"),
      "utf8",
    );
    const shape = /window\.open\(\s*data\.targetUrl,\s*"_blank",\s*"noopener"\s*\)/;
    expect(vam).toMatch(shape);
    expect(SRC).toMatch(shape);
  });
});
