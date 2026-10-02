/**
 * JSON from a model reply — the ONE parser for every model call that answers
 * in JSON (counsel writer/review, return-window extraction, listing
 * translation, bank-claim analysis).
 *
 * Models put prose inside JSON strings, and prose carries quotes. A single
 * unescaped `"` used to lose the whole reply: Mein Maison #100806's letter
 * failed two builds in a row (2026-10-02), and the sibling parsers dropped
 * their evidence silently. Callers that treat a bad reply as "no answer"
 * catch the throw; they no longer each re-implement the slice-and-parse.
 */

/** The first complete JSON object in a model reply (models sometimes add a
 *  second block or commentary after it). String-aware brace matching.
 *
 *  A reply whose prose carries an unescaped `"` (a quoted product name or
 *  phrase) is repaired rather than lost: Mein Maison #100806 failed two builds
 *  in a row on `Expected ',' or ']' after array element` inside the writer's
 *  summary (2026-10-02), and the error never showed the text. A parse that
 *  still fails names the excerpt it failed on. */
export function parseJson<T>(raw: string): T {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error(`no JSON object in model output: ${raw.slice(0, 200)}`);
  const strict = firstObject(raw, start);
  if (strict !== null) {
    try {
      return JSON.parse(strict) as T;
    } catch {
      // Repaired below.
    }
  }
  const repaired = firstObject(escapeStrayQuotes(raw.slice(start)), 0);
  if (repaired === null) {
    throw new Error(`unterminated JSON object in model output: ${raw.slice(0, 200)}`);
  }
  try {
    return JSON.parse(repaired) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const at = Number(/position (\d+)/.exec(message)?.[1] ?? NaN);
    const excerpt = Number.isFinite(at) ? repaired.slice(Math.max(0, at - 80), at + 40) : repaired.slice(0, 200);
    throw new Error(`${message} — near: ${JSON.stringify(excerpt)}`);
  }
}

/** The text of the first balanced `{…}` from `start`, or null. */
function firstObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** Escape every `"` inside a string that does not close it. A quote closes a
 *  string only when the next non-blank character is JSON structure
 *  (`,` `:` `}` `]`) or the text ends; anything else is prose. */
export function escapeStrayQuotes(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) escaped = false;
    else if (ch === "\\") escaped = true;
    else if (ch === '"') {
      const next = /\S/.exec(text.slice(i + 1))?.[0];
      if (next === undefined || next === "," || next === ":" || next === "}" || next === "]") {
        inString = false;
      } else {
        out += '\\"';
        continue;
      }
    }
    out += ch;
  }
  return out;
}
