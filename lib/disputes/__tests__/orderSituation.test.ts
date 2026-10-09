/**
 * The order's return/refund situation (lib/disputes/orderSituation.ts).
 *
 * whj8db-1q #21037 (2026-10-09): Shopify said `returnStatus: IN_PROGRESS`,
 * the store had created return #21037-R1 on 27 August, and the dispute page
 * never showed it while asking for evidence the return made irrelevant.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  hasReturnOnRecord,
  hasReturnOrRefundOnRecord,
  orderSituationFromPackSections,
  resolveOrderSituation,
} from "../orderSituation";
import { packShowsReturnOrRefund, shopifyRecordsReturnOrRefund } from "../returnRequestConfirmation";
import { partitionChronologyEvents } from "@/lib/defence/chronology";

const ROOT = join(__dirname, "..", "..", "..");

describe("resolveOrderSituation", () => {
  it("maps every Shopify return status, and nothing else, to a known state", () => {
    const cases: Array<[string | null, string]> = [
      ["NO_RETURN", "none"],
      ["RETURN_REQUESTED", "requested"],
      ["IN_PROGRESS", "in_progress"],
      ["RETURNED", "returned"],
      ["INSPECTION_COMPLETE", "returned"],
      ["RETURN_FAILED", "failed"],
      ["SOMETHING_NEW", "unknown"],
      [null, "unknown"],
    ];
    for (const [status, expected] of cases) {
      expect(resolveOrderSituation({ returnStatus: status }).returns, String(status)).toBe(expected);
    }
  });

  it("fails closed on the refund: absent or unparseable is unknown, never none", () => {
    expect(resolveOrderSituation({ refundedAmount: "0.0" }).refund).toBe("none");
    expect(resolveOrderSituation({ refundedAmount: 0 }).refund).toBe("none");
    expect(resolveOrderSituation({ refundedAmount: "53.96" }).refund).toBe("some");
    expect(resolveOrderSituation({ refundedAmount: null }).refund).toBe("unknown");
    expect(resolveOrderSituation({ refundedAmount: "" }).refund).toBe("unknown");
    expect(resolveOrderSituation({ refundedAmount: "n/a" }).refund).toBe("unknown");
    expect(resolveOrderSituation({}).refund).toBe("unknown");
  });

  it("dates the return from the earliest 'created return' event, and only that event", () => {
    const events = [
      { message: "Alice added tracking information to return #21037-R1.", createdAt: "2026-08-27T20:01:04Z" },
      { message: "Alice created return #21037-R2.", createdAt: "2026-09-02T10:00:00Z" },
      { message: "Alice created return #21037-R1.", createdAt: "2026-08-27T20:01:04Z" },
      { message: "Alice sent a return instructions email to the customer.", createdAt: "2026-08-27T20:01:05Z" },
      { message: "The carrier reported the shipment returned to sender.", createdAt: "2026-08-01T00:00:00Z" },
      null,
      { message: "Alice created return #21037-R0.", createdAt: "not a date" },
    ];
    expect(resolveOrderSituation({ returnStatus: "IN_PROGRESS", events }).returnOpenedAt).toBe("2026-08-27T20:01:04Z");
    // Another admin language, a trimmed timeline, a POS order: no date, same status.
    expect(resolveOrderSituation({ returnStatus: "IN_PROGRESS", events: [{ message: "Retur #21037-R1 skapades.", createdAt: "2026-08-27T20:01:04Z" }] })).toEqual({
      returns: "in_progress",
      refund: "unknown",
      returnOpenedAt: null,
    });
    expect(resolveOrderSituation({ returnStatus: "IN_PROGRESS" }).returnOpenedAt).toBeNull();
  });

  it("says whether a return, or a return or refund, is on record", () => {
    for (const s of ["RETURN_REQUESTED", "IN_PROGRESS", "RETURNED", "INSPECTION_COMPLETE", "RETURN_FAILED"]) {
      expect(hasReturnOnRecord(resolveOrderSituation({ returnStatus: s, refundedAmount: "0.0" })), s).toBe(true);
    }
    expect(hasReturnOnRecord(resolveOrderSituation({ returnStatus: "NO_RETURN", refundedAmount: "0.0" }))).toBe(false);
    expect(hasReturnOnRecord(resolveOrderSituation({ refundedAmount: "10.0" }))).toBe(false);
    expect(hasReturnOnRecord(null)).toBe(false);
    expect(hasReturnOrRefundOnRecord(resolveOrderSituation({ returnStatus: "NO_RETURN", refundedAmount: "10.0" }))).toBe(true);
    expect(hasReturnOrRefundOnRecord(resolveOrderSituation({ returnStatus: "NO_RETURN", refundedAmount: "0.0" }))).toBe(false);
    expect(hasReturnOrRefundOnRecord(resolveOrderSituation({}))).toBe(false);
  });
});

describe("orderSituationFromPackSections", () => {
  const sections = (order: Record<string, unknown> | null, events: unknown[] = []) => [
    ...(order ? [{ type: "order", labelToken: { key: "packs.section.order" }, data: order }] : []),
    { type: "access_log", labelToken: { key: "packs.section.customerActivityLog" }, data: { timelineEvents: events } },
  ];

  it("reads #21037's pack: a return in progress since 27 August, nothing refunded", () => {
    expect(
      orderSituationFromPackSections(
        sections({ orderName: "#21037", returnStatus: "IN_PROGRESS", totals: { refunded: "0.0" } }, [
          { message: "Alice Sjökvist created return #21037-R1.", createdAt: "2026-08-27T20:01:04Z" },
        ]),
      ),
    ).toEqual({ returns: "in_progress", refund: "none", returnOpenedAt: "2026-08-27T20:01:04Z" });
  });

  it("knows nothing about a pack with no order section, and says so", () => {
    expect(orderSituationFromPackSections(sections(null))).toBeNull();
    expect(orderSituationFromPackSections([])).toBeNull();
    expect(orderSituationFromPackSections(null)).toBeNull();
  });

  it("reads a pack built before the status was stamped as unknown, not as no return", () => {
    expect(orderSituationFromPackSections(sections({ orderName: "#1", totals: { refunded: "0.0" } }))).toEqual({
      returns: "unknown",
      refund: "none",
      returnOpenedAt: null,
    });
  });
});

/* The boolean that hides the return question now reads the resolver. Its
 * answers must not move: it also gates a merchant-facing control. */
describe("shopifyRecordsReturnOrRefund keeps its answers", () => {
  it("matches the rule it had before", () => {
    const before = (returnStatus: string | null | undefined, totalRefunded: number | string | null | undefined) => {
      const refunded = Number.parseFloat(String(totalRefunded ?? "0"));
      if (Number.isFinite(refunded) && refunded > 0) return true;
      return returnStatus != null && returnStatus !== "NO_RETURN";
    };
    const statuses = [null, undefined, "NO_RETURN", "RETURN_REQUESTED", "IN_PROGRESS", "RETURNED", "INSPECTION_COMPLETE", "RETURN_FAILED", "SOMETHING_NEW"];
    const refunds = [null, undefined, "", "0", "0.0", 0, "12.5", 12.5, "n/a"];
    for (const returnStatus of statuses) {
      for (const totalRefunded of refunds) {
        expect(shopifyRecordsReturnOrRefund({ returnStatus, totalRefunded }), `${String(returnStatus)} / ${String(totalRefunded)}`).toBe(
          before(returnStatus, totalRefunded),
        );
      }
    }
  });

  it("still reads a persisted pack", () => {
    const pack = (data: Record<string, unknown>) => [{ labelToken: { key: "packs.section.order" }, data }];
    expect(packShowsReturnOrRefund(pack({ returnStatus: "IN_PROGRESS", totals: { refunded: "0.0" } }))).toBe(true);
    expect(packShowsReturnOrRefund(pack({ returnStatus: "NO_RETURN", totals: { refunded: "0.0" } }))).toBe(false);
    expect(packShowsReturnOrRefund(pack({ totals: { refunded: "0.0" } }))).toBe(false);
    expect(packShowsReturnOrRefund(pack({ returnStatus: "NO_RETURN", totals: { refunded: "5.0" } }))).toBe(true);
  });
});

/* MERCHANT-ONLY, structurally. The note states that a return was opened and
 * that no refund followed: true, and not something to volunteer to a bank.
 * Nothing that builds a bank-facing document may read the situation or the
 * note's copy. */
describe("the order situation never reaches a bank-facing output", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : walk(p);
      return /\.(ts|tsx)$/.test(name) ? [p] : [];
    });

  it("is imported by no letter, PDF, pack-building or Shopify-payload code", () => {
    const bankFacing = [
      join(ROOT, "lib", "defence"),
      join(ROOT, "lib", "packs"),
      join(ROOT, "lib", "argument"),
      join(ROOT, "lib", "shopify"),
      join(ROOT, "lib", "jobs"),
    ].flatMap(walk);
    const offenders = bankFacing.filter((f) => /orderSituation/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("is not rendered inside the view that mirrors the bank document", () => {
    const mirror = readFileSync(
      join(ROOT, "app", "(embedded)", "app", "disputes", "[id]", "tabs", "sections", "DefencePackageHtmlView.tsx"),
      "utf8",
    );
    expect(mirror).not.toMatch(/OrderSituationNote|orderSituation/);
    const pdf = walk(join(ROOT, "lib", "defence", "pdf")).filter((f) => /orderSituation/i.test(readFileSync(f, "utf8")));
    expect(pdf).toEqual([]);
  });

  it("leaves the bank timeline's allow-list dropping every return event", () => {
    const { kept, droppedUnknown } = partitionChronologyEvents([
      { at: "2026-08-27T20:01:04Z", text: "Alice Sjökvist created return #21037-R1." },
      { at: "2026-08-27T20:01:04Z", text: "Alice Sjökvist added tracking information to return #21037-R1." },
      { at: "2026-08-27T20:01:04Z", text: "Alice Sjökvist sent a return instructions email to the customer." },
    ] as never);
    expect(kept).toEqual([]);
    expect(droppedUnknown).toHaveLength(3);
  });

  it("has its copy in all six locales, under the merchant-only overview namespace", () => {
    for (const locale of ["en", "de", "es", "fr", "pt", "sv"]) {
      const copy = JSON.parse(readFileSync(join(ROOT, "messages", `${locale}.json`), "utf8")).disputes.overviewExtra.orderSituation;
      expect(Object.keys(copy.title).sort(), locale).toEqual(["failed", "in_progress", "requested", "returned"]);
      expect(Object.keys(copy.refund).sort(), locale).toEqual(["none", "some"]);
      for (const k of ["opened", "asOf"]) expect(copy[k], `${locale}.${k}`).toContain("{date}");
      expect(copy.privateNote.length, locale).toBeGreaterThan(20);
    }
  });
});
