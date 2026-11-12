/**
 * Plain-text message bodies -> email HTML / text.
 *
 * Bodies live in messages/*.json as translator-safe text: paragraphs separated by a blank line and emphasis
 * marked `**bold**`. next-intl's ICU parser treats `<tag>` as rich-text markup and throws, so message strings
 * can never carry HTML; this converts them at render time and gives a clean text fallback.
 * (Same conversion as the private helpers in `billingLifecycle.ts`; new emails use this shared copy.)
 */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function bodyToHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((para) => {
      const withStrong = escapeHtml(para).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      return `<p style="margin:0 0 14px">${withStrong}</p>`;
    })
    .join("");
}

export function bodyToText(body: string): string {
  return body.replace(/\*\*([^*]+)\*\*/g, "$1").trim();
}

/** One line of message text -> inline HTML (escaped, `**bold**` to <strong>), no paragraph wrapper. */
export function inlineToHtml(text: string): string {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}
