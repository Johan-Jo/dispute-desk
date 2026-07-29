/**
 * UI-contract guards for the Automation page.
 *
 * The page was rebuilt to `Automation Rules Page.dc.html` (Claude Design
 * project "Dispute Desk Design Restoration"), which replaced three different
 * commit models on one screen — the switch wrote immediately, group rows wrote
 * immediately, the safeguard had a Save — with ONE explicit Save over draft
 * state. That removed the old trap (a switch click publishing another
 * control's unsaved edits) by construction, and introduced a new one: a save
 * that reads from the wrong half of the draft/saved pair would publish stale
 * values instead. Both are invisible until a merchant loses data, so the
 * shape is pinned in source rather than trusted to review.
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

/** The body of a top-level `const <name> = ...` up to the next such binding. */
function block(source: string, name: string, until: string): string {
  const start = source.indexOf(`const ${name}`);
  const end = source.indexOf(`const ${until}`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  expect(end, `${until} not found`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("automation page wiring", () => {
  it("the single save publishes the DRAFT, never the last-saved values", () => {
    // One commit point means the on-screen values are the payload. Sending
    // `savedGroups` / `savedSafeguard` here would silently discard whatever
    // the merchant just changed and report success.
    const fn = block(page, "save = useCallback", "setAllGroups");
    expect(fn).toMatch(/body: JSON\.stringify\(\{/);
    expect(fn).toContain("mode,");
    expect(fn).toContain("groups,");
    expect(fn).toContain("enabled: safeguard.enabled");
    expect(fn).not.toMatch(/savedGroups|savedSafeguard|savedMode/);
  });

  it("save commits all three halves of the draft, so dirty cannot stick", () => {
    const fn = block(page, "save = useCallback", "setAllGroups");
    expect(fn).toContain("setSavedMode(mode)");
    expect(fn).toContain("setSavedSafeguard(safeguard)");
    expect(fn).toContain("setSavedGroups(groups)");
  });

  it("dirty compares every control, not just the switch", () => {
    const fn = block(page, "dirty =", "touch");
    expect(fn).toContain("mode !== savedMode");
    expect(fn).toContain("safeguard.enabled !== savedSafeguard.enabled");
    expect(fn).toContain("sameGroups(groups, savedGroups)");
  });

  it("bulk actions never write a row for a locked group", () => {
    // `evaluateAutoSubmitGuards` ignores such a row 100% of the time, so
    // "Automate all" writing one would be a lie stored in the database.
    const fn = block(page, "setAllGroups", "customisedCount");
    expect(fn).toMatch(/if \(!group\.locked\)/);
  });

  it("the section opens only when overrides already exist", () => {
    expect(page).toMatch(/setOverridesOpen\(Object\.keys\(g\)\.length > 0\)/);
  });

  it("the customised badge is hidden at zero", () => {
    expect(page).toMatch(/customisedCount > 0 && \(/);
  });
});

describe("automation group rows", () => {
  it("choosing 'store default' deletes the override rather than storing a third state", () => {
    // Absence IS the inherit state — there is no stored "default".
    expect(component).toMatch(/if \(next === "default"\) delete draft\[id\]/);
  });

  it("the locked row states a fact instead of offering a dead control", () => {
    const locked = component.slice(
      component.indexOf("group.locked ? ("),
      component.indexOf("data-r=\"seg\""),
    );
    expect(locked).toContain("groupAlwaysReviewed");
    expect(locked).not.toContain("role=\"radio\"");
  });

  it("every group has a row style, so a new group cannot render unstyled", () => {
    for (const group of AUTOMATION_GROUPS) {
      expect(component, `ROW_STYLE.${group.id}`).toContain(`${group.id}: {`);
    }
  });
});

describe("automation group copy", () => {
  const required = [
    "groupsSectionTitle",
    "groupsSectionSubtitle",
    "groupsCustomisedBadge",
    "groupsGeneralNote",
    "groupsShow",
    "groupsHide",
    "groupsAutomateAll",
    "groupsReviewAll",
    "groupStoreDefault",
    "groupStoreDefaultHint",
    "groupFollowsDefault",
    "groupAlwaysReviewed",
    "safeguardSubtitle",
    "safeguardAmountPrefix",
    "safeguardAmountSuffix",
    "alwaysReviewedHeading",
    "alwaysReviewedHeadingTail",
    "saveChanges",
    "saveSaved",
    ...AUTOMATION_GROUPS.map((g) => g.labelKey),
    ...AUTOMATION_GROUPS.map(
      (g) =>
        `groupSub${g.id
          .split("_")
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join("")}`,
    ),
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

  it("an inheriting row names the mode it inherits, not just 'default'", () => {
    // "Store default" alone is mysterious — the sub-line has to say WHICH
    // default, and re-render when the switch above changes.
    expect(rulesNamespace("en").groupFollowsDefault).toContain("{mode}");
    expect(component).toContain("groupFollowsDefault");
    expect(component).toContain("autoPack");
  });

  it("the locked row's note no longer repeats its own badge", () => {
    // The pill says "Always reviewed"; the note used to open with the same
    // words, which read as a stutter once they sat side by side.
    expect(rulesNamespace("en").groupNotAsDescribedLocked).not.toMatch(
      /^Always reviewed/,
    );
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
