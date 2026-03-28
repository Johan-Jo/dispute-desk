/** Pull visible h2/h3 text from generated mainHtml for overlap context (compact prompt use). */
export function extractHeadingsFromMainHtml(html: string): string[] {
  const out: string[] = [];
  const re = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
  let m: RegExpExecArray | null;
  const src = html ?? "";
  while ((m = re.exec(src)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out.slice(0, 12);
}

/** First paragraph text (or leading plain text) for intro overlap checks. */
export function extractIntroSnippet(html: string, maxLen = 220): string | null {
  const src = html ?? "";
  const p = src.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const raw = p ? p[1] : src.slice(0, 800);
  const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}
