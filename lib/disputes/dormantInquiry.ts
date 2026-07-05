/**
 * Dormant-inquiry classification — shared single source of truth.
 *
 * Some Shopify Payments **inquiries** are opened, never given a real
 * evidence deadline, and left in `UNDER_REVIEW` indefinitely. Shopify
 * returns `evidenceDueBy = 1970-01-01` (epoch) for them, which ingestion
 * sanitizes to a NULL `due_at` (see sanitizeDueAt). They never transition
 * to a closed status on Shopify's side, so months later they still map to
 * an "active" `normalized_status` (`submitted_to_bank` / `waiting_on_issuer`)
 * and silently inflate the dashboard's Active Disputes and Waiting-on-Issuer
 * counts even though there is nothing actionable.
 *
 * Concrete case (cay-collective, verified 2026-07-05 against Shopify's live
 * API): 3 PRODUCT_NOT_RECEIVED inquiries from May–Sep 2025, all still
 * `UNDER_REVIEW` with `finalizedOn: null` and an epoch `evidenceDueBy`, no
 * evidence ever submitted. They pushed Active Disputes to 5 (real workload:
 * 2) and Waiting on Issuer to 3.
 *
 * A dispute is DORMANT when it is an inquiry with no meaningful deadline
 * that was initiated long enough ago that it is effectively dead:
 *   • phase === "inquiry"           (chargebacks always carry a real deadline)
 *   • due_at is null/epoch          (no actionable deadline)
 *   • initiated_at older than the staleness window
 *
 * Validated platform-wide (2026-07-05): the ONLY active disputes with a null
 * due_at are these 3 inquiries; zero recent (< window) disputes have a null
 * due_at, so the rule excludes exactly the ghosts and nothing legitimate.
 *
 * IMPORTANT: this does NOT change Shopify status and does NOT fabricate an
 * outcome — a dormant inquiry is simply omitted from ACTIVE workload counts.
 * It stays in the DB with its real status; if Shopify ever resolves it, the
 * normal sync/outcome path still records the true win/loss.
 */

/** Inquiries older than this with no real deadline are treated as dormant. */
export const DORMANT_INQUIRY_MAX_AGE_MS = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 months

/** Any due date parsing to before this is an epoch/coercion artifact.
 *  Mirrors MIN_MEANINGFUL_MS in lib/disputeEvents/spuriousDueDate.ts. */
const MIN_MEANINGFUL_DUE_MS = Date.UTC(2000, 0, 1);

export interface DormantInquiryFields {
  phase?: string | null;
  due_at?: string | null;
  initiated_at?: string | null;
}

/** True when `due_at` is absent or an epoch/pre-2000 artifact (no real deadline). */
function hasNoMeaningfulDueDate(dueAt: string | null | undefined): boolean {
  if (dueAt == null) return true;
  const ms = new Date(dueAt).getTime();
  if (!Number.isFinite(ms)) return true;
  return ms < MIN_MEANINGFUL_DUE_MS;
}

/**
 * True when a dispute is a dormant (dead) inquiry that should be excluded
 * from active-workload counts. `now` is injectable for deterministic tests.
 */
export function isDormantInquiry(
  d: DormantInquiryFields,
  now: number = Date.now(),
): boolean {
  if ((d.phase ?? "") !== "inquiry") return false;
  if (!hasNoMeaningfulDueDate(d.due_at)) return false;
  if (!d.initiated_at) return false; // no initiated date → can't call it stale
  const initiatedMs = new Date(d.initiated_at).getTime();
  if (!Number.isFinite(initiatedMs)) return false;
  return now - initiatedMs > DORMANT_INQUIRY_MAX_AGE_MS;
}
