/**
 * SQL-text guards for the legacy → group conversion migration.
 *
 * The migration deletes rules rows that are ROUTING LIVE DISPUTES, so these
 * pin the properties that make that safe. They are text assertions, not a
 * behavioural run — the behavioural rehearsal happened on dev against a
 * replica of prod's rows. What text guards are good at is stopping someone
 * reordering the steps later, which is precisely the failure this migration
 * was rewritten to avoid.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const PATH =
  "../../supabase/migrations/20260729010000_convert_legacy_setup_rules_to_groups.sql";
const sql = readFileSync(resolve(__dirname, PATH), "utf8");

/** Executable SQL only — the header prose names things it must never DO. */
const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

const snapshotAt = sql.indexOf("insert into public.legacy_setup_rules_backup_20260729");
const groupInsertAt = sql.indexOf("'__dd_setup__:group:' || lr.group_id");
const raiseAt = sql.indexOf("Legacy rule conversion incomplete");
const deleteAt = sql.indexOf("delete from public.rules");

describe("legacy group-conversion migration", () => {
  it("snapshots before it touches anything", () => {
    expect(snapshotAt).toBeGreaterThan(-1);
    expect(snapshotAt).toBeLessThan(groupInsertAt);
    expect(snapshotAt).toBeLessThan(deleteAt);
  });

  it("CONVERTS, then VERIFIES, then DELETES — in that order", () => {
    // The whole point. A delete that runs before the verification is a delete
    // that hopes the conversion worked.
    expect(groupInsertAt).toBeGreaterThan(-1);
    expect(raiseAt).toBeGreaterThan(groupInsertAt);
    expect(deleteAt).toBeGreaterThan(raiseAt);
  });

  it("raises rather than deleting when a row failed to convert", () => {
    expect(sql).toMatch(/raise exception\s*\n?\s*'Legacy rule conversion incomplete/);
  });

  it("the delete is scoped to the two legacy name families only", () => {
    const deleteStatement = sql.slice(deleteAt, sql.indexOf(";", deleteAt));
    expect(deleteStatement).toContain("dd\\_setup\\_\\_:pack:%");
    expect(deleteStatement).toContain("dd\\_setup\\_\\_:coverage:%");
    // Never the canonical rows, never a merchant's own.
    expect(deleteStatement).not.toContain("fallback:default");
    expect(deleteStatement).not.toContain("safeguard:high_value");
    expect(deleteStatement).not.toMatch(/:group:/);
  });

  it("escapes the underscores in every LIKE", () => {
    // `_` is a LIKE wildcard and these names are mostly underscores. An
    // unescaped pattern would match far more than intended.
    const likes = sql.match(/like\s+'[^']*'/gi) ?? [];
    expect(likes.length).toBeGreaterThan(0);
    for (const like of likes) {
      if (like.includes("dd_setup") || like.includes("dd\\_setup")) {
        expect(like).toContain("\\_");
      }
    }
  });

  it("never overwrites an existing store-wide switch", () => {
    // An existing fallback IS the merchant's current choice.
    expect(sql).toMatch(/where not exists \(\s*\n\s*select 1 from public\.rules f/);
    expect(sql).not.toMatch(/update public\.rules[\s\S]{0,200}fallback:default/);
  });

  it("keys on shop_id, never on the mutable shop_domain", () => {
    expect(code).not.toMatch(/shop_domain/);
    expect(code).toMatch(/shop_id/);
  });

  it("mirrors auto_save_enabled as 'enabled somewhere', matching the writer", () => {
    // A converted shop whose automation now lives entirely in groups would
    // otherwise resolve to auto at tier-1 and then be blocked by the gate.
    expect(sql).toContain("auto_save_enabled");
    expect(sql).toMatch(/fallback:default' and lower\(r\.action ->> 'mode'\) = 'auto'/);
    expect(sql).toMatch(/:group:%' and lower\(r\.action ->> 'mode'\) = 'auto'/);
  });

  it("normalises legacy mode vocabulary the way the app does", () => {
    expect(sql).toMatch(/in \('auto', 'auto_pack', 'automated'\)/);
    expect(sql).toContain("else 'review'");
  });

  it("writes the fraud group with UNRECOGNIZED included", () => {
    expect(sql).toContain('\'["FRAUDULENT", "UNRECOGNIZED"]\'');
  });

  it("uses the double-L subscription spelling", () => {
    expect(sql).toContain("SUBSCRIPTION_CANCELLED");
    expect(sql).not.toMatch(/SUBSCRIPTION_CANCELED[^L]/);
  });

  it("does not write a row for the locked product group", () => {
    expect(sql).not.toMatch(/'__dd_setup__:group:not_as_described'/);
  });

  it("ends with a post-condition that no legacy rows survive", () => {
    const postAt = sql.indexOf("Legacy setup rules still present after conversion");
    expect(postAt).toBeGreaterThan(deleteAt);
  });
});
