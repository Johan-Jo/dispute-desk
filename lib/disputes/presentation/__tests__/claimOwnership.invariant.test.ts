/**
 * CLAIM OWNERSHIP INVARIANT — the check that stops the class returning.
 *
 * Spec: docs/plans/label-fact-divergence.plan.md §6.
 *
 * Seven merchant-visible falsehoods were each fixed at their own render
 * site, and the class survived every time because nothing prevented the
 * eighth. A shared resolver alone does not help: lib/disputes/presentation/
 * already existed and was routed around by 36 direct status readers.
 *
 * This test enumerates production sources with the TypeScript AST — NOT a
 * grep, which an aliased translator or a helper wrapper walks straight
 * through — and fails when a protected claim token is constructed outside
 * the presentation owner.
 *
 * BASELINE-FIRST (plan §6): the 9 known claim-bearing UI surfaces are
 * listed in BASELINE with the violation each currently carries. New
 * violations fail immediately; baseline entries are removed as each
 * boundary migrates, and the baseline must reach zero before completion.
 * An entry names a file AND its protected keys — never a blanket exemption.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import fg from "fast-glob";

/** i18n keys that assert an operational fact about a case. Constructing one
 *  of these outside the presentation owner is a claim made without a
 *  checked predicate. */
const PROTECTED_KEYS = [
  "packPrepared",
  "savedToShopify",
  "submittedToShopify",
  "notAssessed",
  "assessmentState",
  "citedInPdf",
  "decisiveProof",
  "takingLongerNote",
  "queuedNote",
] as const;

/**
 * DELIBERATELY EXCLUDED: the bare enum values (`saved_to_shopify`,
 * `pack_prepared`). Those are domain vocabulary, not claims — API routes
 * and pipeline code read them to DECIDE, which is legitimate. The §5
 * inventory found 36 such readers and only 9 UI surfaces; the detector's
 * job is the claim TOKENS a merchant sees, not the enum a route branches
 * on. Guarding the enum would put ~27 legitimate domain readers into a
 * permanent baseline and teach everyone to ignore it.
 */

/** The only module permitted to construct protected claims. */
const OWNER_DIR = path.join("lib", "disputes", "presentation");

/**
 * Known, reviewed violations as of the baseline commit — produced BY this
 * detector, not by grep. Each entry is a specific file; removing one is the
 * definition of "that boundary is migrated". Do not add to this list —
 * new violations must fail.
 */
const BASELINE: ReadonlySet<string> = new Set(
  [
    "app/(portal)/portal/dashboard/page.tsx",
    "app/(portal)/portal/disputes/page.tsx",
    "app/(portal)/portal/disputes/[id]/page.tsx",
    "app/(portal)/portal/packs/[packId]/page.tsx",
    "app/(embedded)/app/disputes/[id]/tabs/sections/CaseSummaryCard.tsx",
    "app/(embedded)/app/disputes/[id]/tabs/sections/CompleteDefencePackageCard.tsx",
    "app/(embedded)/app/disputes/[id]/tabs/sections/GorgiasCommsReviewSection.tsx",
    // Shared component — NOT in the plan's §5 migration table. Found by
    // this detector, which is the point: grep-based inventories miss
    // claim sites outside the dispute screens.
    "components/packs/detail/TemplateSetupWizard.tsx",
    // The assessment resolver itself owns these tokens today; it becomes a
    // presentation sub-resolver under plan §3.5 and moves under OWNER_DIR.
    "lib/disputes/assessmentPresence.ts",
  ].map((p) => p.split("/").join(path.sep)),
);

/** Collect every string literal in a source file via the AST, so a key
 *  reached through an alias, a template, or a helper is still seen. */
export function protectedKeysIn(source: string, fileName: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const hits = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      for (const key of PROTECTED_KEYS) {
        if (node.text === key || node.text.endsWith(`.${key}`) || node.text.includes(`${key}.`)) {
          hits.add(key);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...hits];
}

function productionSources(): string[] {
  return fg
    .sync(["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"], {
      cwd: process.cwd(),
      ignore: ["**/__tests__/**", "**/*.test.*", "**/*.d.ts", "**/node_modules/**", "**/demo/**"],
    })
    .map((p) => p.split("/").join(path.sep));
}

describe("protected claim ownership", () => {
  it("no NEW file constructs a protected claim outside the presentation owner", () => {
    const offenders: string[] = [];
    for (const rel of productionSources()) {
      if (rel.startsWith(OWNER_DIR)) continue;
      if (BASELINE.has(rel)) continue;
      const keys = protectedKeysIn(readFileSync(rel, "utf8"), rel);
      if (keys.length > 0) offenders.push(`${rel} -> ${keys.join(", ")}`);
    }
    expect(
      offenders,
      `New protected-claim construction outside ${OWNER_DIR}.\n` +
        `Route the claim through resolvePresentation instead of building the ` +
        `token directly. If this is a legitimate domain reader, it must be ` +
        `reviewed and added deliberately — not silently baselined.\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the baseline shrinks to zero and never grows", () => {
    // Guards the migration itself: a baseline entry that no longer violates
    // must be REMOVED, so the list cannot quietly become permanent.
    const stale: string[] = [];
    for (const rel of BASELINE) {
      let source: string;
      try {
        source = readFileSync(rel, "utf8");
      } catch {
        stale.push(`${rel} (file no longer exists)`);
        continue;
      }
      if (protectedKeysIn(source, rel).length === 0) stale.push(`${rel} (no longer violates)`);
    }
    expect(stale, `Baseline entries are stale — delete them:\n${stale.join("\n")}`).toEqual([]);
  });

  // --- detector self-tests (plan §6: bypass specimens must all fail) ---

  it.each([
    ["direct key", `t("disputes.assessmentState.notAssessed.title")`],
    ["aliased translator", `const tr = useTranslations(); tr("packPrepared");`],
    ["helper wrapper", `export const label = () => wrap("citedInPdf");`],
    ["template literal", "const k = `takingLongerNote`; t(k);"],
    ["nested in object", `const M = { a: { b: "assessmentState.notAssessed" } };`],
    ["compliant file with ONE bypass", `import {resolvePresentation} from "@/lib/disputes/presentation";\nconst x = resolvePresentation(f);\nconst bad = t("queuedNote");`],
  ])("detects a bypass: %s", (_name, snippet) => {
    expect(protectedKeysIn(snippet, "specimen.tsx").length).toBeGreaterThan(0);
  });

  it("accepts a pure renderer that consumes a resolved claim", () => {
    const ok = `
      import { resolvePresentation } from "@/lib/disputes/presentation";
      export function Card({ facts }) {
        const claim = resolvePresentation(facts);
        return <Banner tone={claim.tone}>{claim.copy}</Banner>;
      }`;
    expect(protectedKeysIn(ok, "Card.tsx")).toEqual([]);
  });
});
