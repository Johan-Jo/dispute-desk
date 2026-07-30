/**
 * The rule-builder reason vocabulary is ONE list.
 *
 * Failure proof for each case is stated inline: a test nobody has watched fail
 * is not evidence. Delete `UNRECOGNIZED` from `RULE_REASON_CODES` and the
 * "every reason the engine routes" case goes red; remove either message key
 * from a single locale and the label cases go red.
 *
 * Why this file exists: the embedded modal and the portal form each carried
 * their own hard-coded reason list while importing `REASON_KEYS` only for
 * labels. Both lists were missing `UNRECOGNIZED`, so a merchant building "auto
 * for fraud" picked `FRAUDULENT` and silently missed every unrecognized-payment
 * dispute — which fell through to the store-wide catch-all.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  REASON_KEYS,
  RULE_REASON_CODES,
  embeddedReasonLabelKey,
} from "../helpers";
import { AUTOMATION_GROUPS } from "../automationGroups";

const LOCALES = ["en", "de", "es", "fr", "pt", "sv"] as const;

function messages(locale: string): Record<string, Record<string, string>> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `messages/${locale}.json`), "utf8"),
  );
}

describe("rule-builder reason vocabulary", () => {
  it("every selectable reason has a REASON_KEYS entry", () => {
    for (const code of RULE_REASON_CODES) {
      expect(REASON_KEYS[code], `${code} has no REASON_KEYS entry`).toBeTruthy();
    }
  });

  it("every reason the automation groups route is selectable in a custom rule", () => {
    // A merchant who wants finer control than a group must be able to express
    // it. Anything the group model routes but the rule builder cannot name is
    // a reason a merchant can see happening and cannot act on.
    const groupReasons = new Set(AUTOMATION_GROUPS.flatMap((g) => g.reasons));
    for (const reason of groupReasons) {
      expect(
        RULE_REASON_CODES,
        `${reason} is routed by a group but cannot be picked in a custom rule`,
      ).toContain(reason);
    }
  });

  it("UNRECOGNIZED is selectable — it is scored with the fraud formula", () => {
    expect(RULE_REASON_CODES).toContain("UNRECOGNIZED");
    // Next to FRAUDULENT, because that is where a merchant looks for it.
    expect(RULE_REASON_CODES.indexOf("UNRECOGNIZED")).toBe(
      RULE_REASON_CODES.indexOf("FRAUDULENT") + 1,
    );
  });

  for (const locale of LOCALES) {
    it(`${locale}: both surfaces can label every selectable reason`, () => {
      const m = messages(locale);
      for (const code of RULE_REASON_CODES) {
        // Portal reads `reasons.<camelCase>`.
        expect(
          m.reasons?.[REASON_KEYS[code]],
          `${locale}: missing reasons.${REASON_KEYS[code]}`,
        ).toBeTruthy();
        // Embedded modal reads `rules.reason<PascalCase>`.
        const embeddedKey = embeddedReasonLabelKey(code);
        expect(
          m.rules?.[embeddedKey],
          `${locale}: missing rules.${embeddedKey}`,
        ).toBeTruthy();
      }
    });
  }

  it("the embedded key is derived from the portal key, not a second list", () => {
    expect(embeddedReasonLabelKey("FRAUDULENT")).toBe("reasonFraudulent");
    expect(embeddedReasonLabelKey("UNRECOGNIZED")).toBe("reasonUnrecognized");
    expect(embeddedReasonLabelKey("PRODUCT_NOT_RECEIVED")).toBe(
      "reasonProductNotReceived",
    );
  });
});
