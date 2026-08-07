/**
 * Shared Supabase mock for the two NAMED-candidate routes (`submit` and
 * `finalize`).
 *
 * Both call `preflightNamedCandidate`, which issues its two queries in
 * `Promise.all` — a named lookup filtered on `id`, and a latest-version probe
 * filtered on `dispute_id` + `order`. A call-counting mock cannot distinguish
 * them under parallel execution, so this mock keys on the FILTER instead,
 * which is also how it can inject an error into one query and not the other.
 */

import { vi } from "vitest";

export const FULL_FACT = {
  id: "f1",
  category: "delivery_proof",
  label: "Delivery confirmation",
  source: "shopify_fulfillments",
  sourceRef: null,
  strength: "moderate",
  bankEligible: true,
  merchantVisible: true,
  internalOnly: false,
  includeInBankNarrative: true,
  submissionRisk: false,
  confidence: null,
  value: { proofType: "delivered_confirmed" },
};

export const RETIRED_FACT = {
  ...FULL_FACT,
  value: { deliveredToVerifiedAddress: true },
};

export const CLEAN_NARRATIVE = {
  executiveSummary: {
    text: "The carrier confirmed delivery on 12 May 2026 (PostNord, tracking 1234567890).",
    usedFactIds: ["f1"],
  },
};

export const UNSAFE_NARRATIVE = {
  fulfillmentArgument: {
    text: "The parcel was delivered to the cardholder's verified address on 12 May 2026.",
    usedFactIds: ["f1"],
  },
};

export const AMBIGUOUS_NARRATIVE = {
  fulfillmentArgument: { text: "Delivery to the customer's address.", usedFactIds: [] },
};

export interface NamedCandidateScenario {
  /** The row the route loads by id, and the row the preflight judges. */
  named: Record<string, unknown> | null;
  /** Id of the newest version for the dispute. Defaults to `named.id`. */
  latestId?: string | null;
  /** Inject a failure into the named lookup only. */
  namedError?: { message: string } | null;
  /** Inject a failure into the latest-version probe only. */
  latestError?: { message: string } | null;
}

export function mockNamedCandidateClient(s: NamedCandidateScenario) {
  const jobsInsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const packageUpdates: Array<Record<string, unknown>> = [];

  const from = vi.fn((table: string) => {
    if (table === "jobs") return { insert: jobsInsert };
    if (table !== "defence_packages") throw new Error(`unexpected table: ${table}`);

    const filters: Record<string, unknown> = {};
    let ordered = false;
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (k: string, v: unknown) => {
        filters[k] = v;
        return chain;
      },
      neq: () => chain,
      order: () => {
        ordered = true;
        return chain;
      },
      limit: () => chain,
      update: (values: Record<string, unknown>) => {
        packageUpdates.push(values);
        return chain;
      },
    };

    const resolve = () => {
      // The latest-version probe is the one that orders by version.
      if (ordered && filters.dispute_id !== undefined) {
        if (s.latestError) return { data: null, error: s.latestError };
        const id = s.latestId === undefined ? (s.named as { id?: string } | null)?.id ?? null : s.latestId;
        return { data: id ? { id, version: 99 } : null, error: null };
      }
      // Everything else filtered on `id` is the named lookup.
      if (s.namedError) return { data: null, error: s.namedError };
      return { data: s.named, error: null };
    };

    (chain as { single: () => Promise<unknown> }).single = async () => resolve();
    (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = async () => resolve();
    return chain;
  });

  return { client: { from } as never, jobsInsert, packageUpdates };
}
