/**
 * Deterministic per-locale terminology lock for KEEP-ENGLISH terms.
 *
 * Some terms must stay the English loanword in a given locale even though the
 * model keeps translating them (the prompt rule alone is unreliable). The classic
 * case: Swedish keeps "chargeback" as the English loanword — the established
 * Swedish UI term — but native generation drifts to "återbetalningskrav". This
 * runs a deterministic, case-preserving replacement after generation so the
 * locked term is always correct regardless of what the model produced.
 *
 * This is the KEEP-ENGLISH direction only. The TRANSLATE direction (e.g.
 * "representment" must be translated, not kept English) is handled by the prompt
 * + the V8 slug validator — there is no fixed target term to swap to.
 */

export interface TermRule {
  /** Matches the wrong (translated) form in prose, case-insensitive. */
  wrong: RegExp;
  /** The correct English term, lowercase. Capitalization is preserved from the match. */
  correct: string;
  /** ASCII slug form of the wrong term → correct slug token. */
  slugWrong?: string;
  slugCorrect?: string;
}

export const KEEP_ENGLISH_BY_LOCALE: Record<string, TermRule[]> = {
  "sv-SE": [
    {
      // Match the STEM only so suffixes/compounds keep their tail:
      // "återbetalningskrav" → "chargeback", "återbetalningskravsfrekvens" →
      // "chargebacksfrekvens", "återbetalningskravet" → "chargebacket".
      wrong: /återbetalningskrav/gi,
      correct: "chargeback",
      slugWrong: "aterbetalningskrav",
      slugCorrect: "chargeback",
    },
  ],
};

/** Preserve the match's casing: ALL CAPS, Capitalized, or lowercase. */
function matchCase(sample: string, replacement: string): string {
  if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) return replacement.toUpperCase();
  if (sample[0] === sample[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

function applyProse(text: string | undefined, rules: TermRule[]): { out: string; n: number } {
  if (!text) return { out: text ?? "", n: 0 };
  let n = 0;
  let out = text;
  for (const r of rules) {
    out = out.replace(r.wrong, (m) => {
      n += 1;
      return matchCase(m, r.correct);
    });
  }
  return { out, n };
}

export interface TermLockResult {
  changed: boolean;
  replacements: number;
}

/**
 * Mutate a parsed article in place so KEEP-ENGLISH terms for `locale` are the
 * correct English loanword across body, slug, and metadata. No-op for locales
 * (incl. en-US) with no rules.
 */
export function applyTermLock(
  parsed: {
    title?: string;
    excerpt?: string;
    slug?: string;
    meta_title?: string;
    meta_description?: string;
    body_json: { mainHtml?: string; keyTakeaways?: string[]; faq?: { q: string; a: string }[]; disclaimer?: string };
  },
  locale: string
): TermLockResult {
  const rules = KEEP_ENGLISH_BY_LOCALE[locale];
  if (!rules || rules.length === 0) return { changed: false, replacements: 0 };

  let total = 0;
  const fix = (s: string | undefined) => {
    const { out, n } = applyProse(s, rules);
    total += n;
    return out;
  };

  parsed.title = fix(parsed.title);
  parsed.excerpt = fix(parsed.excerpt);
  parsed.meta_title = fix(parsed.meta_title);
  parsed.meta_description = fix(parsed.meta_description);
  parsed.body_json.mainHtml = fix(parsed.body_json.mainHtml);
  if (parsed.body_json.disclaimer) parsed.body_json.disclaimer = fix(parsed.body_json.disclaimer);
  if (Array.isArray(parsed.body_json.keyTakeaways)) {
    parsed.body_json.keyTakeaways = parsed.body_json.keyTakeaways.map((k) => fix(k));
  }
  if (Array.isArray(parsed.body_json.faq)) {
    parsed.body_json.faq = parsed.body_json.faq.map((f) => ({ q: fix(f.q), a: fix(f.a) }));
  }

  // Slug uses ASCII tokens (no diacritics) — swap the wrong slug token.
  if (parsed.slug) {
    let slug: string = parsed.slug;
    for (const r of rules) {
      if (r.slugWrong && r.slugCorrect) {
        const before: string = slug;
        slug = slug.replace(new RegExp(r.slugWrong, "gi"), r.slugCorrect);
        if (slug !== before) total += 1;
      }
    }
    parsed.slug = slug;
  }

  return { changed: total > 0, replacements: total };
}
