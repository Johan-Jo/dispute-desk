/**
 * English translation of a product-listing exhibit
 * (docs/plans/defence-letter-structure.plan.md §4; maintainer D3, 2026-09-28).
 *
 * Visa's Dispute Management Guidelines (p. 9): evidence must be "in English or
 * accompanied by an English translation". The exhibit keeps the store's
 * original text and prints this translation beneath it, captioned
 * "English translation (machine-translated)".
 *
 * A mistranslated spec would become the merchant's own statement, so every
 * number in the original must survive into the translation, or no
 * translation is printed. Made once per snapshot and cached
 * (`product_listing_translations`).
 */

import { englishOnlyIssues } from "./counsel/checks";

export interface ListingText {
  title: string | null;
  variantLine: string | null;
  excerpt: string | null;
}

export type TranslateCall = (system: string, user: string) => Promise<string>;

export const LISTING_TRANSLATION_SYSTEM = `You translate a shop's product listing into English for a payment-dispute file. Translate faithfully and literally: keep every number, unit, size, colour and claim exactly as written; add nothing, drop nothing, soften nothing, and do not improve the marketing. Keep brand and model names as they are. If a field is already English, return it unchanged. A truncated field ends with "…"; keep the ellipsis.
Return JSON only: { "title": "…", "variantLine": "…", "excerpt": "…" } with null for a field that is null.`;

/** True when the listing needs no translation. */
export function isEnglishListing(t: ListingText): boolean {
  const text = [t.title, t.variantLine, t.excerpt].filter(Boolean).join(" ");
  return englishOnlyIssues(text).length === 0;
}

/** The numbers in a text, normalised ("6,5" and "6.5" are the same). */
export function numbersIn(text: string | null): string[] {
  return (text ?? "").match(/\d+(?:[.,]\d+)?/g)?.map((n) => n.replace(",", ".")) ?? [];
}

/** Why a translation cannot be printed, or [] when it can. */
export function translationIssues(original: ListingText, english: ListingText): string[] {
  const issues: string[] = [];
  for (const k of ["title", "variantLine", "excerpt"] as const) {
    if (!original[k]) continue;
    if (!english[k]) {
      issues.push(`${k}: missing`);
      continue;
    }
    const have = numbersIn(english[k]);
    for (const n of numbersIn(original[k])) {
      const i = have.indexOf(n);
      if (i < 0) issues.push(`${k}: the number ${n} is not in the translation`);
      else have.splice(i, 1);
    }
  }
  return issues;
}

export async function translateListing(original: ListingText, call: TranslateCall): Promise<ListingText | null> {
  const raw = await call(LISTING_TRANSLATION_SYSTEM, JSON.stringify(original));
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const english: ListingText = { title: s(parsed.title), variantLine: s(parsed.variantLine), excerpt: s(parsed.excerpt) };
  return translationIssues(original, english).length === 0 ? english : null;
}
