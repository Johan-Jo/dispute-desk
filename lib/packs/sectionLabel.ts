/**
 * Section-label reader shim.
 *
 * Transitional: bridges the cutover from English `label: string`
 * (pre-Phase-4 persisted `pack_json` rows) to `labelToken: I18nToken`
 * (new collector output). New code emits tokens directly through
 * `EvidenceSection.labelToken`; this helper exists so any pack viewer
 * that reads historical rows can render them correctly during the
 * 90-day pack-retention window.
 *
 * Slated for removal after the retention window following the Phase 4
 * deploy date. The snapshot test in `lib/packs/__tests__/sectionLabel.test.ts`
 * guarantees no newly-emitted section ever carries `label` (which
 * would silently keep the shim alive past its useful life).
 */

import type { Localized } from "@/lib/i18n/localized";
import { resolveToken } from "@/lib/i18n/resolveToken";
import type { I18nToken } from "@/lib/i18n/token";
import type { EvidenceSection } from "./types";

/** Shape of a section as persisted on disk. Looser than
 *  `EvidenceSection` because legacy rows may not carry `labelToken`. */
export type PersistedSection = Omit<EvidenceSection, "labelToken"> & {
  labelToken?: I18nToken;
  /** Legacy English label (pre-Phase 4). Read but never written by
   *  new code. */
  label?: string;
};

type Translator = (key: string, params?: Record<string, string | number>) => string;

/**
 * Resolve a section's display label.
 *
 * Preference order:
 *   1. `section.labelToken` (new collector output) — resolved through
 *      the translator to the active locale.
 *   2. `packs.section.legacy.<type>` token — for legacy rows that only
 *      carry English `label`. Gives the merchant a translated header
 *      even on pre-Phase-4 packs.
 */
export function readSectionLabel(
  section: PersistedSection,
  t: Translator,
): Localized {
  if (section.labelToken) {
    return resolveToken(t, section.labelToken);
  }
  return resolveToken(t, { key: `packs.section.legacy.${section.type}` });
}
