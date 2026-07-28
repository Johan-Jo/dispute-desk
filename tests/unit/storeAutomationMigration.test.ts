/**
 * SQL-text guards for the rules-collapse migration.
 *
 * The migration is destructive (it deletes rules rows), so these tests pin
 * the properties that make it SAFE — chiefly that every statement is scoped
 * to a setup-owned name prefix, so merchant custom rules can never be caught
 * in the blast radius.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const sql = readFileSync(
  resolve(
    __dirname,
    "../../supabase/migrations/20260727120000_collapse_setup_rules_to_store_switch.sql",
  ),
  "utf8",
);

describe("collapse-setup-rules migration", () => {
  it("derives the store-wide mode conservatively (auto only if ALL rules were auto)", () => {
    expect(sql).toMatch(/bool_and\(\s*r\.action->>'mode'\s*=\s*'auto'\s*\)/);
    expect(sql).toContain("else 'review'");
  });

  it("EXCLUDES the safeguard from the mode vote", () => {
    // The safeguard is always mode=review. Including it in the bool_and would
    // force every shop that ever set a threshold to "review everything".
    expect(sql).toMatch(
      /r\.name\s*<>\s*'__dd_setup__:safeguard:high_value'/,
    );
  });

  it("counts only ENABLED rules in the vote", () => {
    expect(sql).toMatch(/and r\.enabled/);
  });

  it("uses left(name, 12) rather than an unescaped LIKE", () => {
    // `_` is a LIKE wildcard and these names are all underscores; left() has
    // no escaping ambiguity.
    expect(sql).toContain("left(r.name, 12) = '__dd_setup__'");
    expect(sql).toContain("left(name, 12) = '__dd_setup__'");
    expect(sql).not.toMatch(/like\s+'__dd_setup__:%'/);
  });

  it("materialises both temp tables before deleting", () => {
    const modeTable = sql.indexOf("create temporary table _dd_shop_mode");
    const safeguardTable = sql.indexOf(
      "create temporary table _dd_safeguard_snapshot",
    );
    const firstDelete = sql.indexOf("delete from public.rules");
    expect(modeTable).toBeGreaterThan(-1);
    expect(safeguardTable).toBeGreaterThan(-1);
    expect(modeTable).toBeLessThan(firstDelete);
    expect(safeguardTable).toBeLessThan(firstDelete);
  });

  it("unifies the two safeguard names, keeping the LOWER (more protective) threshold", () => {
    expect(sql).toContain("'__dd_setup__:safeguard:high_value'");
    expect(sql).toContain("'__dd_safeguard__:high_value'");
    expect(sql).toMatch(/min\(\(match->'amount_range'->>'min'\)::numeric\)/);
  });

  it("reinserts exactly one fallback per shop at the catch-all priority", () => {
    expect(sql).toContain("'__dd_setup__:fallback:default'");
    expect(sql).toContain("100000");
    expect(sql).toMatch(/jsonb_build_object\('mode',\s*m\.mode/);
  });

  it("reinserts the safeguard at tier-0 priority 5 and only when positive", () => {
    expect(sql).toMatch(/'\{"mode":"review"\}'::jsonb,\s*\n?\s*5/);
    expect(sql).toContain("s.min_amount > 0");
  });

  it("brings shop_settings.auto_save_enabled into lockstep with the switch", () => {
    expect(sql).toContain("update public.shop_settings");
    expect(sql).toMatch(/auto_save_enabled\s*=\s*\(m\.mode\s*=\s*'auto'\)/);
  });

  it("NEVER issues an unscoped delete against rules", () => {
    // Every `delete from public.rules` must carry a name-scoped predicate on
    // the same line — an unscoped one would wipe merchant custom rules.
    const deletes = sql
      .split("\n")
      .filter((l) => l.includes("delete from public.rules"));
    expect(deletes.length).toBeGreaterThan(0);
    for (const stmt of deletes) {
      expect(stmt).toMatch(/left\(name, 12\) = '__dd_setup__'|name = '__dd_safeguard__:high_value'/);
    }
  });

  it("runs inside a transaction", () => {
    expect(sql).toMatch(/^\s*begin;/m);
    expect(sql).toMatch(/^\s*commit;/m);
  });
});
