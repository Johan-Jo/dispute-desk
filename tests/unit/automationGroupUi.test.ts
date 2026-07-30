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
    const fn = block(page, "save = useCallback", "pickMode");
    expect(fn).toMatch(/body: JSON\.stringify\(\{/);
    expect(fn).toContain("mode,");
    expect(fn).toContain("groups,");
    expect(fn).toContain("enabled: safeguard.enabled");
    expect(fn).not.toMatch(/savedGroups|savedSafeguard|savedMode/);
  });

  it("save commits all three halves of the draft, so dirty cannot stick", () => {
    const fn = block(page, "save = useCallback", "pickMode");
    expect(fn).toContain("setSavedMode(mode)");
    expect(fn).toContain("setSavedSafeguard(safeguard)");
    expect(fn).toContain("setSavedGroups(groups)");
  });

  it("dirty compares every control, not just the switch", () => {
    const fn = block(page, "dirty =", "[clearedCount");
    expect(fn).toContain("mode !== savedMode");
    expect(fn).toContain("safeguard.enabled !== savedSafeguard.enabled");
    expect(fn).toContain("sameGroups(groups, savedGroups)");
  });

  it("picking a house rule CLEARS the per-type list", () => {
    // The whole fix. Two controls at the same level with the list silently
    // winning is what let "Review everything" sit above four rows reading
    // "Automatic" with no explanation — the page contradicted itself and read
    // as broken. The house rule is now authoritative at the moment it is
    // picked; anything set on a row afterwards takes precedence again.
    const fn = block(page, "pickMode = useCallback", "customisedCount");
    expect(fn).toContain("setGroups({})");
    expect(fn).toContain("setMode(next)");
    // And it says how many it wiped — an invisible reset is as confusing as
    // the contradiction it replaced.
    expect(fn).toContain("setClearedCount(Object.keys(groups).length)");
  });

  it("both house-rule cards go through pickMode, so neither can skip the clear", () => {
    expect(page).toContain('onClick={() => pickMode("auto")}');
    expect(page).toContain('onClick={() => pickMode("review")}');
    expect(page).not.toMatch(/onClick=\{\(\) => \{\s*touch\(\);\s*setMode\(/);
  });

  it("the bulk buttons are gone — the house rule is the bulk action", () => {
    // They were identical in effect to picking the matching rule, except they
    // left six exceptions the next house-rule click would wipe; and with every
    // row already set they appeared to do nothing at all.
    expect(page).not.toContain("groupsAutomateAll");
    expect(page).not.toContain("groupsReviewAll");
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
    "groupStoreDefault",
    "groupStoreDefaultHint",
    "groupFollowingStoreSetting",
    "groupHasOwnSetting",
    "groupAlwaysReviewed",
    "modeClearedExceptions",
    "safeguardSubtitle",
    "safeguardAmountPrefix",
    "safeguardAmountSuffix",
    "alwaysReviewedHeading",
    "alwaysReviewedHeadingTail",
    "saveChanges",
    "saveSaved",
    ...AUTOMATION_GROUPS.map((g) => g.labelKey),
    ...AUTOMATION_GROUPS.filter((g) => g.lockedReasonKey).map(
      (g) => g.lockedReasonKey as string,
    ),
  ];

  it("the copy the removed controls used is gone too", () => {
    // Dead copy outlives the control that rendered it and then gets
    // resurrected by someone who assumes it is still wired to something.
    for (const key of ["groupsAutomateAll", "groupsReviewAll", "groupFollowsDefault"]) {
      expect(rulesNamespace("en")[key], `rules.${key} should be deleted`).toBeUndefined();
    }
  });

  for (const locale of LOCALES) {
    it(`${locale} has every rules.group* key`, () => {
      const ns = rulesNamespace(locale);
      for (const key of required) {
        expect(ns[key], `${locale}: rules.${key}`).toBeTruthy();
      }
    });
  }

  it("every row says whether it follows the house rule or overrides it", () => {
    // The one fact the page was failing to state. "Review everything" selected
    // above four rows reading "Automatic", with nothing explaining that the
    // rows win, is why a merchant read the page as broken.
    expect(rulesNamespace("en").groupFollowingStoreSetting).toContain("{mode}");
    expect(component).toContain("groupFollowingStoreSetting");
    expect(component).toContain("groupHasOwnSetting");
    // And it names the inherited mode rather than saying "default".
    expect(component).toContain("autoPack");
  });

  it("the cleared-exceptions note says how many and which rule now applies", () => {
    const copy = rulesNamespace("en").modeClearedExceptions;
    expect(copy).toContain("{count}");
    expect(copy).toContain("{mode}");
  });

  it("the copy for the removed not_as_described lock is gone", () => {
    // Unlocked 2026-07-30 with the product-family park it described. Dead copy
    // outlives the control that rendered it and then gets resurrected.
    expect(rulesNamespace("en").groupNotAsDescribedLocked).toBeUndefined();
    expect(rulesNamespace("en").alwaysReviewedProduct).toBeUndefined();
  });

  it("no group is locked, so no row renders the lock branch", () => {
    // The `locked` machinery is retained for a future group that genuinely
    // can't be automated, but nothing exercises it today. If someone re-locks
    // a group, they must also add its lockedReasonKey copy to all 6 locales —
    // this test is the reminder.
    expect(AUTOMATION_GROUPS.filter((g) => g.locked)).toHaveLength(0);
  });

  it("does not add a fifth always-reviewed bullet", () => {
    // The bullets are engine facts, not per-group settings. A group-derived
    // bullet would state one rule twice and read as two rules.
    const facts = readFileSync(
      resolve(ROOT, "components/automation/AlwaysReviewedFacts.tsx"),
      "utf8",
    );
    expect(facts).not.toContain("group");
  });
});
