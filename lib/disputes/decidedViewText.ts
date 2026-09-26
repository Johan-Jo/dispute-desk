/**
 * Turns a `DecidedView` into plain strings. Shared by the Overview renderer and
 * the outcome email so the executive summary is assembled ONE way: the email a
 * merchant reads and the page they then open say the same thing.
 *
 * `resolve` is the caller's translator bound to its locale (a React
 * `useTranslations` root or a server `createTranslator`) — this module never
 * holds English.
 */

import type { I18nToken } from "@/lib/i18n/token";
import type { DecidedView } from "@/lib/disputes/decidedView";

type Resolve = (token: I18nToken) => string;

function capitalise(s: string, locale: string): string {
  return s.length === 0 ? s : s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
}

function joinList(parts: string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(parts);
  } catch {
    return parts.join(", ");
  }
}

/** The executive summary paragraph (design `DecidedView3`, hero body). */
export function decidedSummaryParagraph(view: DecidedView, resolve: Resolve, locale: string): string {
  const s = view.summary;
  const sentences: string[] = [resolve(s.claim)];
  if (s.clauses.length > 0) {
    const clauses = capitalise(joinList(s.clauses.map(resolve), locale), locale);
    sentences.push(
      resolve({
        key: s.held ? "disputes.decidedView.summary.evidenceHeld" : "disputes.decidedView.summary.evidence",
        params: { clauses },
      }),
    );
  }
  sentences.push(resolve(s.response));
  if (s.closing) sentences.push(resolve(s.closing));
  return sentences.join(" ");
}
