/**
 * Merchant emails call the store by its own name ("Mein Maison"), never the
 * `*.myshopify.com` alias. Every sender / call site resolves the label
 * through `storeDisplayName`; this pins the class so a new email cannot
 * quietly pass `shop_domain` as the store's name again.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["lib", "app"];
const SKIP_DIRS = new Set(["__tests__", "node_modules", ".next"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** A store-name field/variable assigned straight from the myshopify domain. */
const DOMAIN_AS_NAME =
  /\b(?:shopName|shopLabel|merchantName)\s*[:=]\s*(?:[\w.?]*shop_domain|shopDomain)\b/;

describe("merchant emails name the store, not its myshopify domain", () => {
  it("no email sender or caller passes shop_domain as the store name", () => {
    const offenders: string[] = [];
    for (const file of ROOTS.flatMap((r) => walk(r))) {
      const src = readFileSync(file, "utf8");
      const isEmailCode =
        file.split("\\").join("/").includes("lib/email/") ||
        /from "[^"]*\/email\/send/.test(src);
      if (!isEmailCode) continue;
      src.split("\n").forEach((line, i) => {
        if (DOMAIN_AS_NAME.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
