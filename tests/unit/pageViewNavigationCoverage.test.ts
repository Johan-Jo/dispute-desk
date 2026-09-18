/**
 * INVARIANT: merchant page-view recording does not depend on `id_token`.
 *
 * WHY THIS FILE EXISTS. The first version of page-view logging gated the
 * merchant branch on `x-dd-id-token`. Shopify supplies `id_token` when the app
 * is OPENED from Shopify Admin -- not on in-app navigation -- so the recorder
 * fired on entry and never again. Measured on dev 2026-09-15: 34 server-side
 * hits on `/app/disputes/[id]` produced ZERO merchant rows, while impersonated
 * admin views (cookie verified per request) recorded every page.
 *
 * The feature therefore worked better for US than for merchants -- the exact
 * lopsided coverage its design set out to prevent, since a missing row reads as
 * "the merchant never opened this page".
 *
 * A grep is the right shape: the regression is a control-flow gate, not a type
 * error. Re-nesting the recorder inside `if (idToken)` would compile fine.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

describe("page-view navigation coverage", () => {
  it("middleware forwards a shop id that survives in-app navigation", () => {
    const mw = readFileSync(join(ROOT, "middleware.ts"), "utf8");

    // The cookie is the identity that rides every page load; id_token does not.
    expect(
      mw.includes('requestHeaders.set("x-dd-shop-id", shopIdCookie)'),
      "middleware must forward x-dd-shop-id from the shopify_shop_id cookie, " +
        "or merchant page views are captured only at the app entry point",
    ).toBe(true);
  });

  it("the embedded layout records views outside the id_token branch", () => {
    const layout = readFileSync(
      join(ROOT, "app", "(embedded)", "app", "layout.tsx"),
      "utf8",
    );

    const call = layout.indexOf("recordPageView({");
    expect(call, "layout must call recordPageView").toBeGreaterThan(-1);

    // The merchant call must read the forwarded shop id. If someone re-gates
    // the recorder on the verified token, this disappears.
    expect(
      layout.includes('headerStore.get("x-dd-shop-id")'),
      "the merchant page-view path must use x-dd-shop-id, not the id_token-" +
        "derived shopDomain alone -- see the 2026-09-15 zero-rows regression",
    ).toBe(true);

    // And it must not sit inside `if (idToken) { ... }`.
    const idTokenGate = layout.indexOf("if (idToken)");
    expect(
      idTokenGate === -1 || call < idTokenGate || call > layout.length,
      "recordPageView must not be nested inside the id_token guard",
    ).toBe(true);
  });
});
