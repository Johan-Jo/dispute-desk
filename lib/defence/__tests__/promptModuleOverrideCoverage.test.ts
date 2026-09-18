/**
 * The override path and the drift detector must look at the same fields.
 *
 * `resolveReasonCodeModule` lets a `defence_prompt_modules` row replace the
 * file default's prompt body and guidance lists — and the row wins. Drift
 * detection is what tells us a row has gone stale. If the resolver reads a
 * field the detector does not compare, that field can diverge in production
 * with nothing reporting it: the deployed file says one thing, the model is
 * told another, and every dashboard is green.
 *
 * That is not theoretical. On 2026-09-02 all seven modules were drifted in
 * prod, `visa_10_4_fraud` by prompt body across five commits and seven weeks,
 * and a change shipped the day before had no effect because the stale row
 * outranked it. Detection existed; nothing consumed it, and nothing pinned its
 * field list to the resolver's.
 *
 * This test pins them together. It reads `registry.ts` as text rather than
 * exercising the resolver, because the failure it guards against is a NEW
 * field being wired into the override object — something only visible in the
 * shape of that object literal.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PROMPT_MODULE_GUIDANCE_KEYS,
  PROMPT_MODULE_OVERRIDABLE_FIELDS,
} from "@/lib/defence/promptModuleGuidanceKeys";

/** The override application in `resolveReasonCodeModule`, as source text. */
function overrideBlocks(): string {
  const src = readFileSync(
    join(process.cwd(), "lib/defence/reasonCodes/registry.ts"),
    "utf8",
  );
  // Every line that reads from the DB override object.
  return src
    .split("\n")
    .filter((l) => l.includes("dbOverride."))
    .join("\n");
}

describe("prompt-module override coverage", () => {
  it("every field the resolver takes from a DB override is a known overridable field", () => {
    const blocks = overrideBlocks();
    expect(blocks.length).toBeGreaterThan(0);

    // Field names assigned from the override, e.g. `prioritize: dbOverride...`
    const assigned = new Set<string>();
    for (const line of blocks.split("\n")) {
      const m = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:/);
      if (m) assigned.add(m[1]);
    }

    const known = new Set<string>([
      ...PROMPT_MODULE_OVERRIDABLE_FIELDS,
      // Identifies the row rather than steering generation, so deliberately
      // not a drift signal — see promptModuleGuidanceKeys.ts.
      "version",
    ]);

    const unknown = [...assigned].filter((f) => !known.has(f));
    expect(
      unknown,
      "a field is overridable but absent from PROMPT_MODULE_OVERRIDABLE_FIELDS, " +
        "so drift in it would be invisible — add it there",
    ).toEqual([]);
  });

  it("every guidance key the shared list names is actually read by the resolver", () => {
    // The reverse direction: a key listed as overridable that the resolver
    // ignores would make drift detection report a difference nothing acts on.
    const blocks = overrideBlocks();
    for (const key of PROMPT_MODULE_GUIDANCE_KEYS) {
      expect(blocks, `${key} is declared overridable but never read`).toContain(key);
    }
  });

  it("guidance keys are the five that live in guidance_json", () => {
    // Pinned by name. A silent addition or removal changes what reconcile
    // compares and what the admin drift view reports.
    expect([...PROMPT_MODULE_GUIDANCE_KEYS]).toEqual([
      "prioritize",
      "avoid",
      "mustNotClaim",
      "criticalCategories",
      "allowedFactCategories",
    ]);
  });
});
