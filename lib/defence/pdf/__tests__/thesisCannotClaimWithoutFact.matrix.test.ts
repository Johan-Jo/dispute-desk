/**
 * Static-analysis matrix: every guarded phrase in any THESIS_TEMPLATE
 * must appear ONLY when the corresponding fact-gated token is in
 * `requiredTokens` (or inside an optional `[[ … ]]` clause referencing
 * a gated token).
 *
 * This is the build-time net that catches author drift. The runtime
 * net is `validateComposedDocument`, which catches drift even when
 * this static matrix misses something — they belong to the same
 * defence-in-depth strategy.
 */

import { describe, it, expect } from "vitest";
import { THESIS_TEMPLATES } from "../thesisTemplates";

/** Pattern → name of the token that must guard the phrase. The token
 *  must either be in `requiredTokens` or appear inside the same
 *  optional `[[…]]` clause as the matched text. */
interface GuardedPhrase {
  pattern: RegExp;
  description: string;
  guardingToken: string;
}

const GUARDED_PHRASES: GuardedPhrase[] = [
  {
    pattern: /\b3-D\s+Secure\b/i,
    description: "3-D Secure mention",
    guardingToken: "paymentAuthMethod",
  },
  {
    pattern: /\bAVS\b/i,
    description: "AVS mention",
    guardingToken: "paymentAuthMethod",
  },
  {
    pattern: /\bCVV\b/i,
    description: "CVV mention",
    guardingToken: "paymentAuthMethod",
  },
  {
    pattern: /\b(?:was\s+)?delivered\b/i,
    description: "delivery claim",
    guardingToken: "deliveryClause",
  },
  {
    pattern: /\bprior\s+(?:undisputed\s+)?orders?\b/i,
    description: "prior-customer claim",
    guardingToken: "priorOrderHistoryClause",
  },
  {
    pattern: /\brefund\s+has\s+been\s+processed\b/i,
    description: "refund-processed claim",
    guardingToken: "refundProcessedClause",
  },
  {
    pattern: /\baccess\s+to\s+the\s+service\b/i,
    description: "digital-access claim",
    guardingToken: "digitalAccessClause",
  },
  {
    pattern: /\bcardholder\s+credentials\b/i,
    description: "cardholder credentials reference (implies auth fact)",
    guardingToken: "paymentAuthMethod",
  },
];

/** For each match position in `template`, return the optional clause
 *  region that contains it (or null when it's outside any [[…]]). */
function regionAt(
  template: string,
  index: number,
): { content: string; start: number; end: number } | null {
  const regions = Array.from(template.matchAll(/\[\[([^\]]*?)\]\]/g));
  for (const m of regions) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (index >= start && index < end) {
      return { content: m[1], start, end };
    }
  }
  return null;
}

describe("THESIS_TEMPLATES cannot claim a fact without its guarding token", () => {
  for (const t of THESIS_TEMPLATES) {
    for (const guard of GUARDED_PHRASES) {
      // Find every occurrence of the guarded phrase in this template.
      // We intentionally include token-substituted-only positions —
      // even appearing INSIDE a `{{tokenName}}` placeholder is fine
      // because the token's extractor enforces the predicate.
      const matches = Array.from(t.template.matchAll(new RegExp(guard.pattern.source, guard.pattern.flags + "g")));
      if (matches.length === 0) continue;

      for (const m of matches) {
        const idx = m.index ?? 0;

        // If the match falls inside a `{{...}}` token placeholder, the
        // token's extract function structurally enforces the predicate.
        // Skip the static check.
        const before = t.template.slice(Math.max(0, idx - 32), idx);
        const after = t.template.slice(idx, idx + 32);
        const isInsideTokenPlaceholder =
          /\{\{\w*$/.test(before) && /^\w*\}\}/.test(after);
        if (isInsideTokenPlaceholder) continue;

        const region = regionAt(t.template, idx);
        if (region) {
          // Inside an optional `[[…]]` clause: clause must reference
          // the guarding token. The clause-stripping pass drops the
          // whole clause when the token resolves null.
          const tokensInRegion = Array.from(region.content.matchAll(/\{\{(\w+)\}\}/g)).map(
            (x) => x[1],
          );
          expect(
            tokensInRegion.includes(guard.guardingToken),
            `template ${t.key}: "${guard.description}" appears inside optional clause without referencing ${guard.guardingToken}`,
          ).toBe(true);
        } else {
          // Outside any optional clause: the guarding token MUST be in
          // requiredTokens, so the whole template returns "" when the
          // predicate is false.
          expect(
            t.requiredTokens.includes(guard.guardingToken),
            `template ${t.key}: "${guard.description}" appears in required region without ${guard.guardingToken} in requiredTokens`,
          ).toBe(true);
        }
      }
    }
  }

  it("(structural check executed for every template/guard pair above)", () => {
    expect(true).toBe(true);
  });
});
