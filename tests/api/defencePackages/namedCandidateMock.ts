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
import {
  AMBIGUOUS_NARRATIVE,
  CLEAN_NARRATIVE,
  RETIRED_FACTS,
  UNSAFE_NARRATIVE,
  factJson,
} from "@/tests/fixtures/defencePackageShapes";

/** Re-exported from the single shared fixture module so the route tests and
 *  the predicate tests cannot drift from each other or from production. */
export const FULL_FACT = factJson();
export const RETIRED_FACT = RETIRED_FACTS[0];
export { CLEAN_NARRATIVE, UNSAFE_NARRATIVE, AMBIGUOUS_NARRATIVE };

export interface NamedCandidateScenario {
  /** The row the route loads by id, and the row the preflight judges. */
  named: Record<string, unknown> | null;
  /** Id of the newest version for the dispute. Defaults to `named.id`. */
  latestId?: string | null;
  /** Inject a failure into the named lookup only. */
  namedError?: { message: string } | null;
  /** Inject a failure into the latest-version probe only. */
  latestError?: { message: string } | null;
  /**
   * What the transactional RPC (`finalize_defence_package` /
   * `enqueue_defence_package_save`) returns. Defaults to a successful
   * promotion / enqueue. The RPC's OWN behaviour is tested against a real
   * database in `scripts/db/finalizeDefencePackage.analysis.ts`; here we only
   * pin what each route does with each outcome.
   */
  rpcResult?: unknown;
  /** Make the RPC call itself fail (a transport/database error). */
  rpcError?: { message: string } | null;
}

/** Every candidate carries a content revision; the routes refuse without one. */
export const TEST_REVISION = "11111111-1111-4111-8111-111111111111";

export function mockNamedCandidateClient(s: NamedCandidateScenario) {
  const jobsInsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const packageUpdates: Array<Record<string, unknown>> = [];
  const rpc = vi.fn(async (name: string) => {
    if (s.rpcError) return { data: null, error: s.rpcError };
    // `in`, not truthiness: `null` and `[]` are the malformed replies we most
    // need to be able to inject.
    if ("rpcResult" in s) return { data: s.rpcResult, error: null };
    return {
      data:
        name === "enqueue_defence_package_save"
          ? { outcome: "enqueued", job_id: "job-1" }
          : {
              outcome: "promoted",
              package_id: (s.named as { id?: string } | null)?.id ?? "pkg",
              job_id: "job-1",
            },
      error: null,
    };
  });

  const from = vi.fn((table: string) => {
    if (table === "jobs") return { insert: jobsInsert };
    if (table !== "defence_packages") throw new Error(`unexpected table: ${table}`);

    const filters: Record<string, unknown> = {};
    let ordered = false;
    let updating = false;
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (k: string, v: unknown) => {
        filters[k] = v;
        return chain;
      },
      neq: () => chain,
      not: () => chain,
      order: () => {
        ordered = true;
        return chain;
      },
      limit: () => chain,
      update: (values: Record<string, unknown>) => {
        updating = true;
        packageUpdates.push(values);
        return chain;
      },
      then: (cb: (v: unknown) => unknown) => cb({ data: updating ? [] : [], error: null }),
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
      return {
        data: s.named ? { content_revision: TEST_REVISION, ...s.named } : s.named,
        error: null,
      };
    };

    (chain as { single: () => Promise<unknown> }).single = async () => resolve();
    (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = async () => resolve();
    return chain;
  });

  return { client: { from, rpc } as never, jobsInsert, packageUpdates, rpc };
}
