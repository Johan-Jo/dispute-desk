/**
 * Merchant-facing localization for dispute-event rows — FAIL-CLOSED.
 *
 * `dispute_events.description` is writer-produced free text and may
 * carry internal vocabulary (raw status enums, scores, gate reasons).
 * The design-alignment audit (2026-07-26) found two leak paths: the
 * dashboard activity feed fell back to the raw text for any unmatched
 * event, and the detail timeline rendered it with no localization at
 * all. This module is the ONE localizer both surfaces use:
 *
 *  - known event shapes are parsed and re-rendered through
 *    `disputeTimeline.eventDescriptions.*`;
 *  - `status_changed` translates BOTH sides through the status-label
 *    maps instead of interpolating raw enums;
 *  - anything unrecognized returns null → the row renders its
 *    (translated) event label only. Raw DB text never reaches the
 *    merchant.
 */

import { safeDynamicT, type DynamicTranslator } from "@/lib/i18n/safeDynamicT";

/** Event types merchants may see in the dashboard activity feed.
 *  Internal failures (sync/build/save errors, admin overrides) are
 *  excluded — they surface as transparency copy on the detail page,
 *  never as feed alarm (§12V decision 4). */
export const MERCHANT_ACTIVITY_EVENT_TYPES: readonly string[] = [
  "dispute_opened",
  "status_changed",
  "due_date_changed",
  "dispute_closed",
  "pack_created",
  "pack_ready",
  "pack_blocked",
  "pdf_rendered",
  "evidence_saved_to_shopify",
  "submission_confirmed",
  "auto_build_triggered",
  "auto_save_triggered",
  "parked_for_review",
  "merchant_approved_for_save",
  "outcome_detected",
  "support_note_added",
  "dispute_resynced",
];

/** Translate a raw Shopify/normalized status token to a merchant label.
 *  Tries `normalizedStatuses.*` then `shopifyStatuses.*`; falls back to
 *  a de-snaked lowercase phrase (never the raw enum casing). */
function statusLabel(tTimeline: DynamicTranslator, raw: string): string {
  const cleaned = raw.trim();
  const fromNormalized = safeDynamicT(tTimeline, `normalizedStatuses.${cleaned}`, "");
  if (fromNormalized) return fromNormalized;
  const fromShopify = safeDynamicT(tTimeline, `shopifyStatuses.${cleaned}`, "");
  if (fromShopify) return fromShopify;
  return cleaned.replace(/_/g, " ").toLowerCase();
}

/**
 * Localize an event description for merchant display. `tTimeline` must
 * be scoped to the `disputeTimeline` namespace. Returns null when the
 * description cannot be rendered safely — callers show the label only.
 */
export function localizeEventDescription(
  tTimeline: DynamicTranslator,
  eventType: string,
  description: string | null,
): string | null {
  if (!description) return null;

  try {
    switch (eventType) {
      case "submission_confirmed":
        return tTimeline("eventDescriptions.submission_confirmed");
      case "dispute_opened": {
        const m = description.match(/^(.+?) opened — (.+)$/);
        if (m) {
          return (tTimeline as (k: string, p?: Record<string, string>) => string)(
            "eventDescriptions.dispute_opened",
            { type: m[1], reason: m[2] },
          );
        }
        break;
      }
      case "status_changed": {
        const m = description.match(/^(.+?) → (.+)$/);
        if (m) {
          return (tTimeline as (k: string, p?: Record<string, string>) => string)(
            "eventDescriptions.status_changed",
            {
              from: statusLabel(tTimeline, m[1]),
              to: statusLabel(tTimeline, m[2]),
            },
          );
        }
        break;
      }
      case "due_date_changed": {
        const m = description.match(/^Due date changed to (.+)$/);
        if (m) {
          return (tTimeline as (k: string, p?: Record<string, string>) => string)(
            "eventDescriptions.due_date_changed",
            { date: m[1] },
          );
        }
        break;
      }
      case "pack_created": {
        const m = description.match(/^Score: (\d+)%, (\d+) evidence items collected$/);
        if (m) {
          return (tTimeline as (k: string, p?: Record<string, string>) => string)(
            "eventDescriptions.pack_created",
            { score: m[1], count: m[2] },
          );
        }
        break;
      }
      case "evidence_saved_to_shopify": {
        const m = description.match(/^(\d+) evidence fields sent to Shopify$/);
        if (m) {
          return (tTimeline as (k: string, p?: Record<string, string>) => string)(
            "eventDescriptions.evidence_saved_to_shopify",
            { count: m[1] },
          );
        }
        break;
      }
      case "support_note_added": {
        const m = description.match(/^Note added by (.+)$/);
        if (m) {
          return (tTimeline as (k: string, p?: Record<string, string>) => string)(
            "eventDescriptions.support_note_added",
            { role: m[1] },
          );
        }
        break;
      }
      case "dispute_resynced": {
        const m = description.match(/^Resynced by (.+?)\./);
        if (m) {
          return (tTimeline as (k: string, p?: Record<string, string>) => string)(
            "eventDescriptions.dispute_resynced",
            { role: m[1] },
          );
        }
        break;
      }
      case "pack_blocked": {
        const m = description.match(/^Completeness score (\d+)% is below threshold (\d+)%$/);
        if (m) {
          return (tTimeline as (k: string, p?: Record<string, string>) => string)(
            "eventDescriptions.pack_blocked_score",
            { score: m[1], threshold: m[2] },
          );
        }
        break;
      }
    }
  } catch {
    /* fall through to fail-closed */
  }

  // FAIL-CLOSED: unrecognized shapes render nothing rather than raw
  // internal text.
  return null;
}
