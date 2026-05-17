/**
 * Render a thesis blockquote from a fact-templated template.
 *
 * Algorithm:
 *   1. Find the best matching template via the (section, family, mode)
 *      fallback chain: (s, f, m) → (s, f, "any") → (s, "any", "any") → null.
 *   2. Resolve every required token. If any returns null, return "".
 *   3. Strip optional clauses `[[ … ]]` whose tokens didn't resolve.
 *   4. Substitute remaining tokens. Whitespace cleanup at the end.
 */

import { THESIS_TEMPLATES } from "./thesisTemplates";
import { THESIS_TOKENS } from "./thesisTokens";
import type {
  EvidenceFact,
  NarrativeSectionKey,
  PackageMode,
  ReasonCodeFamilyKey,
  ThesisTemplate,
  ThesisTokenName,
} from "../types";

export interface RenderThesisInput {
  sectionKey: NarrativeSectionKey;
  familyKey: ReasonCodeFamilyKey;
  packageMode: PackageMode;
  approvedFacts: EvidenceFact[];
}

/** Match the most specific template available for the given context.
 *  Falls back along (family, mode) → (family, "any") → ("any", "any"). */
function pickTemplate(input: RenderThesisInput): ThesisTemplate | null {
  const candidates = THESIS_TEMPLATES.filter(
    (t) => t.sectionKey === input.sectionKey,
  );
  // Try most-specific first.
  const tryMatch = (
    familyKey: ReasonCodeFamilyKey | "any",
    packageMode: PackageMode | "any",
  ): ThesisTemplate | null =>
    candidates.find(
      (t) => t.familyKey === familyKey && t.packageMode === packageMode,
    ) ?? null;

  return (
    tryMatch(input.familyKey, input.packageMode) ??
    tryMatch(input.familyKey, "any") ??
    tryMatch("any", input.packageMode) ??
    tryMatch("any", "any") ??
    null
  );
}

/** Resolve a token's value via its registered extractor. Returns null
 *  when the token isn't registered (caller treats it as missing). */
function resolveToken(
  name: ThesisTokenName,
  facts: EvidenceFact[],
): string | null {
  const token = THESIS_TOKENS[name];
  if (!token) return null;
  return token.extract(facts);
}

/** Strip optional `[[ … ]]` clauses whose tokens didn't all resolve.
 *  Non-nested grammar — `[[` / `]]` markers don't compose. */
function stripOptionalClauses(template: string, facts: EvidenceFact[]): string {
  return template.replace(/\[\[([^\]]*?)\]\]/g, (_, clause: string) => {
    const tokenMatches = Array.from(clause.matchAll(/\{\{(\w+)\}\}/g));
    if (tokenMatches.length === 0) return clause; // no tokens — keep as-is
    for (const m of tokenMatches) {
      const tokenName = m[1] as ThesisTokenName;
      const value = resolveToken(tokenName, facts);
      if (value === null || value === "") return ""; // drop the whole clause
    }
    return clause;
  });
}

/** Substitute every remaining `{{tokenName}}` with its resolved value.
 *  At this point all tokens must resolve (the required-token gate has
 *  already short-circuited otherwise). */
function substituteTokens(text: string, facts: EvidenceFact[]): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = resolveToken(name as ThesisTokenName, facts);
    return value ?? "";
  });
}

/** Collapse repeated whitespace and tidy stray punctuation that the
 *  clause-stripping pass can leave behind ("foo[[ , bar]]" becomes
 *  "foo " when `bar` is missing — clean to "foo"). */
function cleanup(text: string): string {
  return text
    .replace(/\s+/g, " ")
    // Doubled punctuation introduced by missing clauses, e.g. ". ."
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    // Trailing connectives left over after clause stripping
    .replace(/[,;]\s*\./g, ".")
    .trim();
}

export function renderThesis(input: RenderThesisInput): string {
  const template = pickTemplate(input);
  if (!template) return "";

  // Required-token gate: if any required token is unresolvable, the
  // ENTIRE template returns "". This is the structural guarantee that
  // a thesis cannot claim a fact that doesn't exist.
  for (const name of template.requiredTokens) {
    const value = resolveToken(name, input.approvedFacts);
    if (value === null || value === "") return "";
  }

  // Optional clauses — drop the ones whose tokens didn't resolve.
  const stripped = stripOptionalClauses(template.template, input.approvedFacts);

  // Substitute the remaining tokens.
  const substituted = substituteTokens(stripped, input.approvedFacts);

  return cleanup(substituted);
}
