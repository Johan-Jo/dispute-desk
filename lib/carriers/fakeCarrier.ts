/**
 * Test-only fake adapter — plan §9 (PR 1B) / §8 of the revision:
 * proves the framework is carrier-neutral WITHOUT building a second
 * production integration. Never imported by runtime code and never in
 * the default registry; tests register it via `registerCarrierAdapter`
 * and unregister on teardown.
 */

import type {
  CarrierAdapter,
  CarrierLookupResult,
  CarrierMatch,
  TrackingEntryInfo,
} from "@/lib/carriers/types";

export interface FakeCarrierBehavior {
  /** Company substring this fake claims (default "fakecarrier"). */
  companyToken?: string;
  /** Result fetchTimeline resolves with. */
  result: CarrierLookupResult;
  /** Spy hook: records every tracking number fetched. */
  fetched?: string[];
}

export function createFakeCarrierAdapter(
  behavior: FakeCarrierBehavior,
): CarrierAdapter {
  const token = (behavior.companyToken ?? "fakecarrier").toLowerCase();
  return {
    slug: "fake_carrier",
    version: "fake_carrier@test",
    match(info: TrackingEntryInfo): CarrierMatch | null {
      const company = (info.company ?? "").toLowerCase();
      const number = (info.number ?? "").trim();
      if (!company.includes(token) || !number) return null;
      return {
        carrier: "fake_carrier",
        trackingNumber: number,
        matchedFrom: "company_and_number",
        confidence: "medium",
      };
    },
    async fetchTimeline(trackingNumber: string): Promise<CarrierLookupResult> {
      behavior.fetched?.push(trackingNumber);
      return behavior.result;
    },
  };
}
