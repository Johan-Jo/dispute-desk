/**
 * Admin pages must print a merchant as storefront domain + myshopify alias
 * (components/admin/AdminMerchant.tsx), never as a bare `shop_domain`. This
 * fails when a JSX child expression renders the raw domain, so new pages cannot
 * quietly drift back to printing just the alias.
 *
 * (Template-literal `${…}` is excluded: those build plain-text labels.)
 * It looks for `{ … shop_domain }` / `{ … shopDomain }` that is NOT a prop value
 * (`prop={x.shop_domain}` is how AdminMerchant is fed and is fine).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["app/admin", "components/admin"];

/** Files that are allowed to render the raw domain, and why. */
const ALLOW: Record<string, string> = {
  "components/admin/AdminMerchant.tsx": "the renderer itself",
  "components/admin/DeleteShopButton.tsx": "the destructive dialog makes the operator type the exact alias",
  "app/admin/shops/page.tsx": "reference implementation: storefront domain + alias line",
  "app/admin/shops/[id]/page.tsx": "header prints the alias under the storefront domain",
};

const RAW = /(?<![=\w$])\{\s*[\w.?]*(?:shop_domain|shopDomain)\s*\}/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p.split(path.sep).join("/"));
  }
  return out;
}

describe("admin merchant display", () => {
  it("no admin page renders a bare shop_domain outside the allowlist", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        if (ALLOW[file]) continue;
        const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);
        lines.forEach((line, i) => {
          if (RAW.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim()}`);
        });
      }
    }
    expect(offenders, `Use <AdminMerchant>:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every allowlist entry still exists (no stale exemptions)", () => {
    for (const file of Object.keys(ALLOW)) {
      expect(fs.existsSync(file), file).toBe(true);
    }
  });
});
