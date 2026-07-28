/**
 * Types for the plain-node helper in `allDisputeReasons.mjs`, so the vitest
 * invariant (`lib/rules/__tests__/shopifyReasonEnum.test.ts`) can import it
 * under `tsc --noEmit`.
 */
export declare const DISPUTE_REASONS_SOURCE: string;
export declare function readAllDisputeReasons(sourcePath?: string): string[];
