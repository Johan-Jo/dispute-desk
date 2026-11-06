/**
 * The evidence field that carries "the order has no return on record".
 *
 * A name, not a reading. The merchant-side surfaces that need to ask "is that
 * row part of this pack?" import the key from here, so the raw-read scan
 * (tests/unit/rawReadScan.test.ts) keeps seeing only the places that
 * interpret the return record. Whether the fact is applicable at all is
 * decided by `lib/packs/noReturnApplicability.ts`, which decides whether the
 * collector emits the row; presence of the row is what a reader may rely on.
 */
export const RETURN_EVIDENCE_FIELD = "no_return_initiated";
