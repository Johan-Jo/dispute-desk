/**
 * The merchant asks registry (single-source plan section 5).
 *
 * Pins four properties:
 *  1. ids, priorities and order are exactly the plan's table;
 *  2. each ask's `offered` equals the gate the card used before the registry
 *     (frozen copies of the old inline gates below) on every real fixture and
 *     every synthetic record variant - no card changed visibility;
 *  3. the Overview adds only the required, pending parcel/return cards, and
 *     the Evidence tab is untouched;
 *  4. the hero action can never be "none" or the acknowledgement while a
 *     required ask is offered and pending, and removing an ask from the
 *     registry removes what the #17066 assertions need (planted mutation).
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("next/navigation", async () => (await import("../harness/workspaceHookMock")).navigationMock);
vi.mock("@/app/(embedded)/app/disputes/[id]/hooks/useDisputeWorkspace", async (orig) => ({
  ...(await orig<object>()),
  useDisputeWorkspace: (await import("../harness/workspaceHookMock")).useDisputeWorkspaceMock,
}));

import { buildDisputeRecord } from "@/lib/disputes/disputeRecord";
import { createRecordFormat } from "@/lib/disputes/recordFormat";
import {
  ASK_IDS,
  askActionKey,
  isAskOffered,
  primaryAsk,
  resolveMerchantAsks,
  type Ask,
  type MerchantAskInputs,
} from "@/lib/disputes/merchantAsks";
import {
  canOfferCardholderAcknowledgement,
  canOfferParcelOutcome,
  merchantAnsweredParcelOutcomeFromItems,
  merchantSuppliedAcknowledgementFromItems,
} from "@/lib/disputes/heldState";
import { MERCHANT_UI_HIDDEN_FIELDS } from "@/lib/automation/merchantUiHiddenFields";
import { canMerchantUpload } from "@/lib/disputes/presentation/concreteContribution";
import { recordInputsFromWorkspace, type WorkspaceWithPatterns } from "@/app/(embedded)/app/disputes/[id]/record/recordInputs";
import { stageOf, recordStatusOf } from "@/lib/disputes/workspacePayload/recordStage";
import type { WorkspaceData } from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";
import {
  en,
  fixtureByCase,
  loadFixtures,
  renderDisputePage,
  visibleText,
  workspaceDataOf,
  type WorkspaceFixture,
} from "../harness/renderDisputePage";
import { ALL_VARIANTS, workspaceVariant } from "../fixtures/disputeRecordFixture";

beforeAll(() => {
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
});

/* ── Frozen copies of the gates as they stood in the components BEFORE the registry ── */
const legacy = {
  returnRequest: (d: WorkspaceData) => {
    const rr = d.returnRequest;
    if (!rr?.applies) return false;
    if (d.dispute?.finalOutcome) return false;
    if (d.dispute?.submissionState === "submitted_confirmed") return false;
    return true;
  },
  bankClaim: (d: WorkspaceData) => (d.bankClaim?.trigger ?? null) !== null,
  gorgias: (d: WorkspaceData) => {
    const comms = d.gorgiasComms ?? null;
    if (!comms) return false;
    const visibleTickets = (comms.tickets ?? []).filter((tk) => tk.matchStatus !== "rejected_match");
    const run = comms.latestRun;
    if (!run && visibleTickets.length === 0) return false;
    return true;
  },
  parcel: (d: WorkspaceData) =>
    canOfferParcelOutcome({
      returnedToSender: d.workspaceAssessment?.caseStrength?.returnedToSender?.triggered === true,
      merchantAnsweredParcelOutcome: merchantAnsweredParcelOutcomeFromItems(d.pack?.evidenceItems),
      submissionState: d.dispute?.submissionState ?? null,
      finalOutcome: d.dispute?.finalOutcome ?? null,
    }),
  ack: (d: WorkspaceData) =>
    canOfferCardholderAcknowledgement({
      merchantSuppliedAcknowledgement: merchantSuppliedAcknowledgementFromItems(d.pack?.evidenceItems),
      submissionState: d.dispute?.submissionState ?? null,
      finalOutcome: d.dispute?.finalOutcome ?? null,
    }),
  /** `record.canDecide` as `recordInputsFromWorkspace` computed it. */
  canDecide: (d: WorkspaceData) => {
    const status = recordStatusOf(d);
    const stage = stageOf(d, status);
    return status === "open" && (d.presentation?.editable ?? false) && (stage === "prepared_review" || stage === "held" || stage === "needs_attention");
  },
  /** `deriveMissingItems` + the merchant-UI hidden filter, from the effective checklist. */
  missing: (d: WorkspaceData) =>
    (d.pack?.checklistV2 ?? []).some((c) => c.status === "missing" && canMerchantUpload(c) && !MERCHANT_UI_HIDDEN_FIELDS.has(c.field)),
};

const offered = (d: WorkspaceData, id: (typeof ASK_IDS)[number]) => isAskOffered(d.asks, id);

const subjects: Array<{ name: string; data: WorkspaceData; at: string }> = [
  ...loadFixtures().map((f) => ({ name: f.meta.case, data: workspaceDataOf(f), at: f.meta.capturedAt })),
  ...ALL_VARIANTS.map((v) => ({ name: `variant:${v}`, data: workspaceVariant(v) as unknown as WorkspaceData, at: "2026-11-06T12:00:00Z" })),
];

describe("the registry's shape", () => {
  it("lists exactly the plan's seven asks, in order, with the plan's priorities", () => {
    for (const s of subjects) {
      expect((s.data.asks ?? []).map((a) => [a.id, a.priority]), s.name).toEqual([
        ["review_decision", "required"],
        ["bank_claim", "required"],
        ["parcel_outcome", "required"],
        ["return_request", "required"],
        ["missing_evidence", "optional"],
        ["gorgias_review", "optional"],
        ["cardholder_ack", "optional"],
      ]);
    }
  });

  it("a pending ask is always an offered ask", () => {
    for (const s of subjects) for (const a of s.data.asks ?? []) if (a.pending) expect(a.offered, `${s.name}:${a.id}`).toBe(true);
  });
});

describe("parity: every ask is offered exactly when its card's old gate said so", () => {
  const cases: Array<[(typeof ASK_IDS)[number], (d: WorkspaceData) => boolean]> = [
    ["review_decision", legacy.canDecide],
    ["bank_claim", legacy.bankClaim],
    ["parcel_outcome", legacy.parcel],
    ["return_request", legacy.returnRequest],
    ["missing_evidence", legacy.missing],
    ["gorgias_review", legacy.gorgias],
    ["cardholder_ack", legacy.ack],
  ];
  for (const [id, gate] of cases) {
    it(id, () => {
      for (const s of subjects) expect(offered(s.data, id), `${s.name}`).toBe(gate(s.data));
    });
  }
});

describe("parity: rendered cards", () => {
  const titles = {
    parcel: en("disputes.evidenceTab.parcelOutcome.title"),
    returnRequest: en("disputes.evidenceTab.returnRequest.title"),
    missing: en("disputes.evidenceTab.sections.missing.title"),
  };
  const fixtures = loadFixtures();

  function at(f: WorkspaceFixture) {
    vi.setSystemTime(new Date(f.meta.capturedAt));
    return f;
  }

  it("the Evidence tab shows each card exactly when its old gate allows it", () => {
    for (const f of fixtures) {
      const d = workspaceDataOf(at(f));
      const text = visibleText(renderDisputePage(d, "evidence"));
      // The cards also hide while a build runs (client-side render condition); those fixtures are not building.
      expect(text.includes(titles.parcel), `${f.meta.case} parcel`).toBe(legacy.parcel(d));
      expect(text.includes(titles.returnRequest), `${f.meta.case} return`).toBe(legacy.returnRequest(d));
      expect(text.includes(titles.missing), `${f.meta.case} missing`).toBe(legacy.missing(d));
    }
  });

  it("the Overview adds exactly the required, pending parcel / return cards and nothing else", () => {
    for (const f of fixtures) {
      const d = workspaceDataOf(at(f));
      const text = visibleText(renderDisputePage(d, "overview"));
      const live = (id: (typeof ASK_IDS)[number]) => (d.asks ?? []).some((a) => a.id === id && a.priority === "required" && a.offered && a.pending);
      // The parcel title is also the hero action sentence for that ask, so presence on the Overview is the card OR the sentence.
      expect(text.includes(titles.missing), `${f.meta.case} Overview must not gain the missing-evidence section`).toBe(false);
      if (!live("parcel_outcome")) expect(text.includes(titles.parcel), `${f.meta.case} parcel`).toBe(false);
      if (!live("return_request")) expect(text.includes(titles.returnRequest), `${f.meta.case} return`).toBe(false);
      if (live("parcel_outcome")) expect(text.includes(titles.parcel), `${f.meta.case} parcel`).toBe(true);
      if (live("return_request")) expect(text.includes(titles.returnRequest), `${f.meta.case} return`).toBe(true);
    }
  });
});

describe("the hero action", () => {
  const base: MerchantAskInputs = {
    canDecide: false,
    reviewPending: false,
    bankClaimTrigger: null,
    bankClaimAnswered: false,
    returnedToSender: false,
    evidenceItems: [],
    submissionState: null,
    finalOutcome: null,
    returnRequestApplies: false,
    returnRequestAnswered: false,
    checklist: [],
    gorgiasComms: null,
  };

  it("names a required ask before an optional one", () => {
    const asks = resolveMerchantAsks({ ...base, returnedToSender: true });
    expect(primaryAsk(asks)?.id).toBe("parcel_outcome");
    expect(askActionKey("parcel_outcome")).toBe("disputes.evidenceTab.parcelOutcome.title");
  });

  it("is never none or the acknowledgement while a required ask is offered and pending (every input combination)", () => {
    let combos = 0;
    for (let bits = 0; bits < 128; bits++) {
      const b = (n: number) => (bits & (1 << n)) !== 0;
      const asks = resolveMerchantAsks({
        ...base,
        canDecide: b(0),
        reviewPending: b(0) && b(1),
        bankClaimTrigger: b(2) ? "general_reason" : null,
        bankClaimAnswered: b(3),
        returnedToSender: b(4),
        returnRequestApplies: b(5),
        returnRequestAnswered: b(6),
      });
      const required = asks.filter((a) => a.priority === "required" && a.offered && a.pending);
      const picked = primaryAsk(asks);
      if (required.length > 0) {
        combos++;
        expect(picked?.priority).toBe("required");
        expect(picked?.id).toBe(required[0].id);
        expect(askActionKey(picked!.id)).not.toBe("disputes.record.action.ack");
        expect(askActionKey(picked!.id)).not.toBeNull();
      }
    }
    expect(combos).toBeGreaterThan(20);
  });

  it("an answered bank claim / return question / decided review is still offered but is not the call to action", () => {
    const asks = resolveMerchantAsks({ ...base, bankClaimTrigger: "reopened", bankClaimAnswered: true, returnRequestApplies: true, returnRequestAnswered: true, canDecide: true, evidenceItems: [{ payload: { kind: "cardholder_acknowledgement" } }] });
    expect(asks.filter((a) => a.offered).map((a) => a.id)).toEqual(["review_decision", "bank_claim", "return_request"]);
    expect(primaryAsk(asks)).toBeNull();
  });
});

describe("planted mutation: remove parcel_outcome from the registry and the #17066 assertions fail", () => {
  const f = () => {
    const fx = fixtureByCase("17066-returned-to-sender");
    vi.setSystemTime(new Date(fx.meta.capturedAt));
    return fx;
  };
  const withoutParcel = (d: WorkspaceData): WorkspaceData => ({ ...d, asks: (d.asks ?? []).filter((a: Ask) => a.id !== "parcel_outcome") });
  const actionKey = (d: WorkspaceData) =>
    buildDisputeRecord(recordInputsFromWorkspace(d as unknown as WorkspaceWithPatterns, f().meta.capturedAt), createRecordFormat("en")).facts.action?.key;

  it("with the ask: the parcel card is on the Overview and is the action", () => {
    const d = workspaceDataOf(f());
    expect(visibleText(renderDisputePage(d, "overview"))).toContain(en("disputes.evidenceTab.parcelOutcome.title"));
    expect(actionKey(d)).toBe("disputes.evidenceTab.parcelOutcome.title");
  });

  it("without the ask: neither holds", () => {
    const d = withoutParcel(workspaceDataOf(f()));
    expect(visibleText(renderDisputePage(d, "overview"))).not.toContain(en("disputes.evidenceTab.parcelOutcome.title"));
    expect(actionKey(d)).not.toBe("disputes.evidenceTab.parcelOutcome.title");
  });
});
