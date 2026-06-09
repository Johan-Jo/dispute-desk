/**
 * Deterministic, no-LLM repair for the ONE failure mode that otherwise forces an
 * expensive regeneration: a `mainHtml` body that the model left truncated at the
 * very end (see validators.ts `v10_incompleteBody`).
 *
 * Why this exists: with Anthropic structured outputs the model occasionally ends
 * the body string early to go finish the rest of the required JSON object
 * (keyTakeaways/faq/disclaimer). The JSON is valid and `stop_reason` is `end_turn`,
 * so nothing upstream catches it — but the HTML *inside* the string is left
 * unbalanced. Observed: an article that opened `<blockquote><p>` for a sample
 * quote it never wrote, leaving a dangling empty tag, and a 1000-word otherwise
 * complete article was hard-rejected over it.
 *
 * Repairing a trailing dangling element is a sanitizer's job, not grounds to
 * throw the article away and re-bill a full regeneration. This trims:
 *   1. trailing open-only tags with no content (`…</p><blockquote><p>` → `…</p>`)
 *   2. trailing empty elements (`<p></p>`, `<blockquote></blockquote>`)
 *   3. a trailing plain-text paragraph that ends on a colon — a dangling lead-in
 *      promising content (a list/quote) that the truncation dropped
 *   4. a final UNCLOSED `<p>` with partial content (genuine mid-sentence cut)
 *
 * Conservative by design: it ONLY runs when the body actually looks truncated
 * (matches what v10 detects), caps how much it will remove, and returns the input
 * unchanged if the repair would gut the body — in which case v10 still rejects it
 * (no retry, no re-bill: the locale simply doesn't publish).
 */

/** Closing-punctuation test mirrors v10_incompleteBody (terminal char + optional close-quote). */
const ENDS_COMPLETE = /[.!?:][")'\]”»]?$/;

/** Block tags we treat as structural wrappers when trimming the tail. */
const BLOCK_TAGS = "p|blockquote|ul|ol|li|div|figure|table|tbody|tr|td|th|h[1-6]|pre|section";

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countP(html: string): { opens: number; closes: number } {
  return {
    opens: (html.match(/<p\b[^>]*>/gi) ?? []).length,
    closes: (html.match(/<\/p>/gi) ?? []).length,
  };
}

export interface BodyRepairResult {
  html: string;
  changed: boolean;
  notes: string[];
}

/**
 * Repair a body that the model left truncated at the tail. Returns the input
 * unchanged (changed:false) when the body already looks complete or when repair
 * cannot salvage it without removing too much.
 */
export function repairTruncatedBody(input: string): BodyRepairResult {
  const original = input ?? "";
  const startText = stripTags(original);
  const startP = countP(original);

  // Gate: only act when the body actually looks truncated (same signals as v10).
  const looksTruncated = startP.opens > startP.closes || (startText !== "" && !ENDS_COMPLETE.test(startText));
  if (!looksTruncated) return { html: original, changed: false, notes: [] };

  const notes: string[] = [];
  let html = original.trimEnd();
  const MAX_PASSES = 8;

  for (let i = 0; i < MAX_PASSES; i += 1) {
    const before = html;

    // 1. Trailing run of open-only block tags with no content between them.
    const openOnly = new RegExp(`(?:\\s*<(?:${BLOCK_TAGS})\\b[^>]*>)+\\s*$`, "i");
    if (openOnly.test(html)) {
      html = html.replace(openOnly, "").trimEnd();
      notes.push("stripped trailing empty open tag(s)");
    }

    // 2. Trailing empty element (open + immediate close).
    const emptyEl = new RegExp(`\\s*<(${BLOCK_TAGS})\\b[^>]*>\\s*</\\1>\\s*$`, "i");
    if (emptyEl.test(html)) {
      html = html.replace(emptyEl, "").trimEnd();
      notes.push("stripped trailing empty element");
    }

    // 3. Trailing plain-text paragraph ending on a colon (dangling lead-in).
    const colonLead = /\s*<p\b[^>]*>[^<]*:\s*<\/p>\s*$/i;
    if (colonLead.test(html)) {
      html = html.replace(colonLead, "").trimEnd();
      notes.push("dropped dangling colon lead-in paragraph");
    }

    // 4. Final UNCLOSED <p> with partial content (mid-sentence cut): drop it.
    const p = countP(html);
    if (p.opens > p.closes) {
      const lastUnclosed = /<p\b[^>]*>(?:(?!<\/p>)[\s\S])*$/i;
      if (lastUnclosed.test(html)) {
        html = html.replace(lastUnclosed, "").trimEnd();
        notes.push("dropped final unclosed paragraph");
      }
    }

    if (html === before) break;
  }

  html = html.trimEnd();
  const endText = stripTags(html);
  const endP = countP(html);
  const nowComplete = endP.opens <= endP.closes && (endText === "" ? false : ENDS_COMPLETE.test(endText));

  // Safety: never publish a gutted body. If repair removed more than half the
  // visible text, or still doesn't look complete, leave it to v10 (reject, no retry).
  const tooMuchRemoved = startText.length > 0 && endText.length < startText.length * 0.5;
  if (!nowComplete || tooMuchRemoved || html === original) {
    return { html: original, changed: false, notes };
  }

  return { html, changed: true, notes };
}
