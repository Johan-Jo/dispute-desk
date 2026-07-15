/**
 * Enforcement: every checklist field must have its per-field UI copy.
 *
 * Origin (2026-07-15, dispute #C89276B6/#891BECCC): `refund_record` was
 * added to the CREDIT_NOT_PROCESSED checklist (2026-07-07) without a
 * `disputes.whyText.refund_record` entry. Nothing failed at build time;
 * the raw key path `disputes.whyText.refund_record` rendered in the
 * merchant-facing "Missing or weak evidence" card. Four more fields
 * turned out to have the same gap.
 *
 * This test closes the class: it enumerates EVERY field in both
 * completeness templates (the source of truth for what can appear on a
 * dispute checklist) and asserts the per-field namespaces consumed by
 * the workspace UI contain copy for it. Adding a checklist field without
 * copy is now a CI failure, not a prod leak.
 *
 * Only en.json is asserted — scripts/verify-i18n-parity.mjs already
 * fails the build when any other locale is missing a key en has.
 *
 * If a field is intentionally never merchant-visible, do NOT exempt it
 * here — give it copy anyway. Copy is cheap; a future surfacing-filter
 * change silently re-exposing the field is not.
 */

import { describe, it, expect } from "vitest";
import {
  REASON_TEMPLATES,
  REASON_TEMPLATES_V2,
} from "@/lib/automation/completeness";
import enMessages from "@/messages/en.json";

function allChecklistFields(): string[] {
  const fields = new Set<string>();
  for (const template of Object.values(REASON_TEMPLATES)) {
    for (const item of template) fields.add(item.field);
  }
  for (const template of Object.values(REASON_TEMPLATES_V2)) {
    for (const item of template) fields.add(item.field);
  }
  return [...fields].sort();
}

const en = enMessages as unknown as {
  disputes: {
    whyText: Record<string, string>;
    sourceCaption: Record<string, string>;
    fieldAction: Record<string, unknown>;
    workspaceHook: Record<string, string>;
  };
};

describe("checklist field copy enforcement", () => {
  const fields = allChecklistFields();

  it("collects a sane, non-empty field list from the templates", () => {
    // 17 distinct fields across V1+V2 templates as of 2026-07-15. Grows as
    // templates gain fields — the bound only guards against the import
    // silently returning empty objects.
    expect(fields.length).toBeGreaterThanOrEqual(17);
    expect(fields).toContain("refund_record");
    expect(fields).toContain("no_return_initiated");
  });

  it.each(allChecklistFields())(
    "disputes.whyText has copy for %s",
    (field) => {
      expect(
        en.disputes.whyText[field],
        `Missing disputes.whyText.${field} — a checklist field was added ` +
          `without its "why this matters" copy. Add it to messages/en.json ` +
          `(and all locales) or the raw key path leaks into the ` +
          `Missing-or-weak-evidence card.`,
      ).toBeTruthy();
    },
  );

  it.each(allChecklistFields())(
    "disputes.sourceCaption has copy for %s",
    (field) => {
      expect(
        en.disputes.sourceCaption[field],
        `Missing disputes.sourceCaption.${field} — add it to ` +
          `messages/en.json (and all locales).`,
      ).toBeTruthy();
    },
  );

  it("the fieldAction namespace keeps its designed default fallback", () => {
    // Unlike whyText/sourceCaption, fieldAction intentionally has per-field
    // OVERRIDES over a `default` entry — the default must always exist.
    const dflt = en.disputes.fieldAction.default as
      | Record<string, string>
      | undefined;
    expect(dflt?.ctaLabel).toBeTruthy();
    expect(dflt?.acceptedFormats).toBeTruthy();
    expect(dflt?.skipLabel).toBeTruthy();
  });

  it("the workspaceHook fallbacks used on copy misses exist", () => {
    expect(en.disputes.workspaceHook.impactFallback).toBeTruthy();
    expect(en.disputes.workspaceHook.sourceFallback).toBeTruthy();
  });
});
