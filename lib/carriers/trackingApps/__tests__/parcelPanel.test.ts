/**
 * ParcelPanel source + mapper.
 *
 * Plan: docs/plans/tracking-app-delivery-signals.plan.md §13, tests 1-5, 9, 10.
 *
 * Fixtures are REAL payloads pulled from the live endpoint on 2026-09-16 —
 * the `threeDs.test.ts` discipline. `dispute-4b81afe1-returned.json` is the
 * parcel that caused this work (30 events, ends returned-to-sender);
 * `order-100094-delivered.json` is a genuinely delivered parcel from the same
 * shop and carrier, so a mapper that just says "Returned" for YunExpress
 * fails here.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { electSignal, mapCheckpoint } from "../parcelPanelMap";
import {
  fetchParcelPanelState,
  resetPacingForTest,
  MIN_REQUEST_INTERVAL_MS,
} from "../parcelPanelSource";
import returnedFixture from "./fixtures/dispute-4b81afe1-returned.json";
import deliveredFixture from "./fixtures/order-100094-delivered.json";

const checkpointsOf = (f: unknown) =>
  (f as { data: { tracking: Array<{ trackinfo: unknown[] }> } }).data.tracking[0]
    .trackinfo as Parameters<typeof electSignal>[0];

/** A fetch stub that never touches the network. */
function stubFetch(res: {
  status?: number;
  json?: unknown;
  throws?: Error;
}): typeof fetch {
  return (async () => {
    if (res.throws) throw res.throws;
    return {
      status: res.status ?? 200,
      ok: (res.status ?? 200) >= 200 && (res.status ?? 200) < 300,
      json: async () => {
        if (res.json === undefined) throw new Error("not json");
        return res.json;
      },
    } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => resetPacingForTest());

describe("mapping the real returned parcel (test 1)", () => {
  it("elects exactly one Returned signal at the final return event", () => {
    const r = electSignal(checkpointsOf(returnedFixture));
    expect(r.status).toBe("Returned");
    expect(r.at).toBe("2026-09-07 09:17:41");
    expect(r.conflict).toBe(false);
  });

  it("is not fooled by 'Zugestellt' on a return event", () => {
    // The trap: the final event's text begins with the German for DELIVERED
    // and only the parenthetical says it went back to the sender.
    const final = checkpointsOf(returnedFixture)[0] as { StatusDescription: string };
    expect(final.StatusDescription).toContain("Zugestellt");
    expect(mapCheckpoint(final as never)).toBe("Returned");
  });
});

describe("the same carrier, genuinely delivered", () => {
  it("elects Delivered — the mapper is not just saying 'Returned' for YunExpress", () => {
    const r = electSignal(checkpointsOf(deliveredFixture));
    expect(r.status).toBe("Delivered");
    expect(r.conflict).toBe(false);
  });
});

describe("same-timestamp tie (test 2)", () => {
  it("the real 08-31 11:17:41 FailedAttempt + Exception_008 pair yields Returned", () => {
    const pair = checkpointsOf(returnedFixture).filter(
      (c) => (c as { date_carbon?: string }).date_carbon === "2026-08-31 11:17:41",
    );
    expect(pair).toHaveLength(2);
    const r = electSignal(pair);
    expect(r.status).toBe("Returned");
    expect(r.conflict).toBe(false);
  });

  it("Delivered vs Returned at one identical timestamp yields NO signal plus a conflict", () => {
    const r = electSignal([
      { date_carbon: "2026-09-07 09:17:41", checkpoint_status: "delivered", substatus: "Delivered_001", StatusDescription: "Delivered" },
      { date_carbon: "2026-09-07 09:17:41", checkpoint_status: "exception", substatus: "Exception_008", StatusDescription: "Rücksendung an Absender" },
    ]);
    expect(r.conflict).toBe(true);
    expect(r.status).toBeNull();
  });
});

describe("empty substatus (test 3)", () => {
  it("falls back to checkpoint_status and never invents a terminal signal", () => {
    // The real payload DOES carry blank substatus — 4 of 30 events on this
    // parcel alone — which is why the mapper must never key solely on it.
    const all = checkpointsOf(returnedFixture) as Array<{ substatus?: string }>;
    expect(all.filter((c) => !String(c.substatus ?? "").trim()).length).toBeGreaterThan(0);
    // ...and none of those blanks produced the elected signal.
    expect(electSignal(checkpointsOf(returnedFixture)).status).toBe("Returned");

    // Synthetic: blank substatus, in-transit checkpoint → no signal.
    expect(
      mapCheckpoint({
        date_carbon: "2026-09-01 10:00:00",
        checkpoint_status: "blank",
        substatus: "",
        StatusDescription: "Verladen auf Bewegungs- / Tourfahrzeug",
      }),
    ).toBeNull();

    // Blank substatus but a delivered checkpoint → Delivered.
    expect(
      mapCheckpoint({
        date_carbon: "2026-09-01 10:00:00",
        checkpoint_status: "delivered",
        substatus: "",
        StatusDescription: "Ihre Bestellung wurde zugestellt",
      }),
    ).toBe("Delivered");
  });
});

describe("latest valid state by event time, NOT most severe (test 9)", () => {
  it("a Delivered AFTER a Returned wins", () => {
    // The rule an earlier draft got wrong: severity ranking would pin this at
    // Returned forever and ignore the redelivery.
    const r = electSignal([
      { date_carbon: "2026-09-01 09:00:00", checkpoint_status: "exception", substatus: "Exception_008", StatusDescription: "Rückgabe an Absender" },
      { date_carbon: "2026-09-05 12:00:00", checkpoint_status: "delivered", substatus: "Delivered_001", StatusDescription: "Zugestellt" },
    ]);
    expect(r.status).toBe("Delivered");
    expect(r.at).toBe("2026-09-05 12:00:00");
  });

  it("a later event clears an earlier tie rather than inheriting its conflict", () => {
    const r = electSignal([
      { date_carbon: "2026-09-01 09:00:00", checkpoint_status: "delivered", substatus: "Delivered_001", StatusDescription: "Zugestellt" },
      { date_carbon: "2026-09-01 09:00:00", checkpoint_status: "exception", substatus: "Exception_008", StatusDescription: "Rücksendung an Absender" },
      { date_carbon: "2026-09-09 11:00:00", checkpoint_status: "delivered", substatus: "Delivered_001", StatusDescription: "Zugestellt" },
    ]);
    expect(r.conflict).toBe(false);
    expect(r.status).toBe("Delivered");
  });

  it("in-transit is never a negative signal", () => {
    const r = electSignal([
      { date_carbon: "2026-09-01 09:00:00", checkpoint_status: "blank", substatus: "InTransit_001", StatusDescription: "unterwegs" },
      { date_carbon: "2026-09-02 09:00:00", checkpoint_status: "transit", substatus: "InTransit_004", StatusDescription: "Zollabwicklung" },
    ]);
    expect(r.status).toBeNull();
    expect(r.conflict).toBe(false);
  });
});

describe("the three-outcome contract (test 5)", () => {
  const input = { shopDomain: "meinmaison.de", trackingNumber: "YT2622600704220350" };

  it("403 is UNAVAILABLE, never 'no return' — it cannot be told from an unknown parcel", async () => {
    const r = await fetchParcelPanelState({ ...input, fetchImpl: stubFetch({ status: 403 }) });
    expect(r.outcome).toBe("unavailable");
    if (r.outcome === "unavailable") expect(r.reason).toBe("http_403");
  });

  it("a fetched, still-moving parcel is no_terminal_state — a FACT, not an absence", async () => {
    const r = await fetchParcelPanelState({
      ...input,
      fetchImpl: stubFetch({
        json: {
          code: 200,
          data: {
            tracking: [
              {
                trackinfo: [
                  { date_carbon: "2026-09-01 10:00:00", checkpoint_status: "blank", substatus: "InTransit_001", StatusDescription: "unterwegs" },
                ],
              },
            ],
          },
        },
      }),
    });
    expect(r.outcome).toBe("no_terminal_state");
  });

  it("a changed response shape degrades to unavailable, never to a wrong answer", async () => {
    for (const json of [
      { code: 500, data: {} },
      { code: 200, data: { tracking: [] } },
      { code: 200, data: {} },
      { nope: true },
    ]) {
      resetPacingForTest(); // the limiter is real; don't pay it per assertion
      const r = await fetchParcelPanelState({ ...input, fetchImpl: stubFetch({ json }) });
      expect(r.outcome).toBe("unavailable");
      if (r.outcome === "unavailable") expect(r.reason).toBe("shape_mismatch");
    }
  });

  it("5xx and network failures are unavailable", async () => {
    resetPacingForTest();
    const a = await fetchParcelPanelState({ ...input, fetchImpl: stubFetch({ status: 503 }) });
    expect(a.outcome).toBe("unavailable");
    resetPacingForTest();
    const b = await fetchParcelPanelState({
      ...input,
      fetchImpl: stubFetch({ throws: new Error("ECONNRESET") }),
    });
    expect(b.outcome).toBe("unavailable");
    if (b.outcome === "unavailable") expect(b.reason).toBe("network");
  });

  it("returns a signal with provenance for the real returned payload", async () => {
    const r = await fetchParcelPanelState({
      ...input,
      fetchImpl: stubFetch({ json: returnedFixture }),
    });
    expect(r).toMatchObject({
      outcome: "signal",
      status: "Returned",
      at: "2026-09-07 09:17:41",
      source: "tracking_app_parcelpanel",
    });
  });

  it("an unresolvable same-timestamp conflict is unavailable, not a guess", async () => {
    const r = await fetchParcelPanelState({
      ...input,
      fetchImpl: stubFetch({
        json: {
          code: 200,
          data: {
            tracking: [
              {
                trackinfo: [
                  { date_carbon: "2026-09-07 09:00:00", checkpoint_status: "delivered", substatus: "Delivered_001", StatusDescription: "Zugestellt" },
                  { date_carbon: "2026-09-07 09:00:00", checkpoint_status: "exception", substatus: "Exception_008", StatusDescription: "Rücksendung an Absender" },
                ],
              },
            ],
          },
        },
      }),
    });
    expect(r.outcome).toBe("unavailable");
  });
});

describe("pacing is the MEASURED rate, not a guess", () => {
  it("is at or below the characterised sustainable interval", () => {
    // Measured 2026-09-16 against the live endpoint: 40 requests at 2s
    // throttled at #29; 40 at 4s were clean. 5s sits below that boundary
    // with margin, because the budget's shape is still unknown.
    expect(MIN_REQUEST_INTERVAL_MS).toBeGreaterThanOrEqual(4_000);
  });

  it("serialises consecutive requests to the same shop", async () => {
    const started: number[] = [];
    const f = (async () => {
      started.push(Date.now());
      return { status: 200, ok: true, json: async () => returnedFixture } as Response;
    }) as unknown as typeof fetch;

    const input = { shopDomain: "paced.example", trackingNumber: "X", fetchImpl: f };
    await fetchParcelPanelState(input);
    await fetchParcelPanelState(input);

    expect(started).toHaveLength(2);
    expect(started[1] - started[0]).toBeGreaterThanOrEqual(MIN_REQUEST_INTERVAL_MS - 50);
  }, 20_000);
});
