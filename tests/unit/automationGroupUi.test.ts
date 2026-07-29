/**
 * UI-contract guards for the per-group override section.
 *
 * Two things here are easy to get wrong and invisible until a merchant loses
 * data, so they are pinned in source rather than trusted to review:
 *
 *  1. `onModeChange` must pass `savedGroups`, not `groups`. A PUT carries the
 *     whole config, so passing on-screen values would silently commit unsaved
 *     edits from another control on a switch click.
 *  2. Every `rules.group*` key the component renders must exist in all six
 *     locales — `scripts/verify-i18n-parity.mjs` catches a key missing from
 *     SOME locales, but not a key missing from ALL of them, which renders as
 *     the raw key on screen.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { AUTOMATION_GROUPS } from "@/lib/rules/automationGroups";

const ROOT = resolve(__dirname, "../..");
const page = readFileSync(
  resolve(ROOT, "app/(embedded)/app/rules/page.tsx"),
  "utf8",
);
const component = readFileSync(
  resolve(ROOT, "components/automation/AutomationGroupList.tsx"),
  "utf8",
);

const LOCALES = ["en", "de", "es", "fr", "pt", "sv"];

function rulesNamespace(locale: string): Record<string, string> {
  const json = JSON.parse(
    readFileSync(resolve(ROOT, `messages/${locale}.json`), "utf8"),
  );
  return json.rules ?? {};
}

describe("automation group UI wiring", () => {
  it("onModeChange persists savedGroups, never the on-screen groups", () => {
    const fn = page.slice(
      page.indexOf("const onModeChange"),
      page.indexOf("const saveSafeguard"),
    );
    expect(fn).toContain("groups: savedGroups");
    expect(fn).not.toMatch(/groups:\s*groups\b/);
  });

  it("the safeguard's explicit Save also carries savedGroups", () => {
    const fn = page.slice(
      page.indexOf("const saveSafeguard"),
      page.indexOf("const onGroupsChange"),
    );
    expect(fn).toContain("groups: savedGroups");
  });

  it("a group change reverts on failure rather than claiming success", () => {
    const fn = page.slice(
      page.indexOf("const onGroupsChange"),
      page.indexOf("const customisedCount"),
    );
    expect(fn).toContain("const previous = groups");
    expect(fn).toMatch(/if \(!ok\) setGroups\(previous\)/);
  });

  it("the section opens only when overrides already exist", () => {
    expect(page).toMatch(/setGroupsOpen\(Object\.keys\(g\)\.length > 0\)/);
  });

  it("the customised badge is hidden at zero", () => {
    expect(page).toMatch(/customisedCount > 0 && \(/);
  });
});

describe("automation group copy", () => {
  const required = [
    "groupsSectionTitle",
    "groupsSectionSubtitle",
    "groupsCustomisedBadge",
    "groupUseDefault",
    "groupsGeneralNote",
    ...AUTOMATION_GROUPS.map((g) => g.labelKey),
    ...AUTOMATION_GROUPS.filter((g) => g.lockedReasonKey).map(
      (g) => g.lockedReasonKey as string,
    ),
  ];

  for (const locale of LOCALES) {
    it(`${locale} has every rules.group* key`, () => {
      const ns = rulesNamespace(locale);
      for (const key of required) {
        expect(ns[key], `${locale}: rules.${key}`).toBeTruthy();
      }
    });
  }

  it("the inherited-mode option names the mode instead of saying 'default'", () => {
    // "Use store default" alone is mysterious — the label has to say WHICH
    // default, and re-render when the switch above changes.
    expect(rulesNamespace("en").groupUseDefault).toContain("{mode}");
    expect(component).toContain("modeAutoTitle");
    expect(component).toContain("modeReviewTitle");
  });

  it("the locked row renders a badge, not a disabled dropdown", () => {
    // A greyed-out Select reads as "you can't afford this" — the plan-gate
    // idiom already used on this page. A badge reads as a fact.
    const locked = component.slice(
      component.indexOf("group.locked ? ("),
      component.indexOf(") : ("),
    );
    expect(locked).toContain("Badge");
    expect(locked).not.toContain("Select");
  });

  it("does not add a sixth always-reviewed bullet", () => {
    // The lock IS the alwaysReviewedProduct fact. Two statements of one rule
    // reads as two rules.
    const facts = readFileSync(
      resolve(ROOT, "components/automation/AlwaysReviewedFacts.tsx"),
      "utf8",
    );
    expect(facts).not.toContain("group");
  });
});
