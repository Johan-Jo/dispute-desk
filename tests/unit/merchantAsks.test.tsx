/**
 * The merchant asks registry (single-source plan section 5).
 *
 * Pins five properties:
 *  1. ids, priorities and order are exactly the plan's table;
 *  2. each ask's `offered` equals the gate the card used before the registry
 *     (frozen copies of the old inline gates below) on every real fixture and
 *     every synthetic record variant - no card changed visibility;
 *  3. the Overview adds only the required, pending return-request card, and
 *     the Evidence tab shows no returned-parcel question (removed 2026-11-10);
 *  4. the hero action can never be "none" or the acknowledgement while a
 *     required ask is offered and pending, and removing an ask from the
 *     registry removes what its assertions need (planted mutation);
 *  5. a REQUIRED ask names the module that consumes its answer (`consumedBy`),
 *     and that module exists: we do not ask the merchant for something that
 *     cannot change the outcome.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("next/navigation", async () => (await import("../harness/workspaceHookMock")).navigationMock);
vi.mock("@/app/(embedded)/app/disputes/[id]/hooks/useDisputeWorkspace", async (orig) => ({
  ...(await orig<object>()),
  useDisputeWorkspace: (await import("../harness/workspaceHookMock")).useDisputeWorkspaceMock,
}));

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
  merchantSuppliedAcknowledgementFromItems,
} from "@/lib/disputes/heldState";
import { MERCHANT_UI_HIDDEN_FIELDS } from "@/lib/automation/merchantUiHiddenFields";
import { canMerchantUpload } from "@/lib/disputes/presentation/concreteContribution";
import { stageOf, recordStatusOf } from "@/lib/disputes/workspacePayload/recordStage";
import type { WorkspaceData } from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";
import {
  en,
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
  it("lists exactly the plan's six asks, in order, with the plan's priorities", () => {
    for (const s of subjects) {
      expect((s.data.asks ?? []).map((a) => [a.id, a.priority]), s.name).toEqual([
        ["review_decision", "required"],
        ["bank_claim", "required"],
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
    returnRequest: en("disputes.evidenceTab.returnRequest.title"),
    missing: en("disputes.evidenceTab.sections.missing.title"),
  };
  const fixtures = loadFixtures();
  /** The title of the returned-parcel question, removed 2026-11-10 (its answer reached no letter claim). */
  const REMOVED_PARCEL_QUESTION = "Tell us why this parcel came back";

  function at(f: WorkspaceFixture) {
    vi.setSystemTime(new Date(f.meta.capturedAt));
    return f;
  }

  it("the Evidence tab shows each card exactly when its old gate allows it", () => {
    for (const f of fixtures) {
      const d = workspaceDataOf(at(f));
      const text = visibleText(renderDisputePage(d, "evidence"));
      // The cards also hide while a build runs (client-side render condition); those fixtures are not building.
      expect(text.includes(REMOVED_PARCEL_QUESTION), `${f.meta.case} parcel question was removed`).toBe(false);
      expect(text.includes(titles.returnRequest), `${f.meta.case} return`).toBe(legacy.returnRequest(d));
      expect(text.includes(titles.missing), `${f.meta.case} missing`).toBe(legacy.missing(d));
    }
  });

  it("the Overview adds exactly the required, pending return card and nothing else", () => {
    for (const f of fixtures) {
      const d = workspaceDataOf(at(f));
      const text = visibleText(renderDisputePage(d, "overview"));
      const live = (id: (typeof ASK_IDS)[number]) => (d.asks ?? []).some((a) => a.id === id && a.priority === "required" && a.offered && a.pending);
      // The return title is also the hero action sentence for that ask, so presence on the Overview is the card OR the sentence.
      expect(text.includes(titles.missing), `${f.meta.case} Overview must not gain the missing-evidence section`).toBe(false);
      expect(text.includes(REMOVED_PARCEL_QUESTION), `${f.meta.case} parcel question was removed`).toBe(false);
      if (!live("return_request")) expect(text.includes(titles.returnRequest), `${f.meta.case} return`).toBe(false);
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
    const asks = resolveMerchantAsks({ ...base, returnRequestApplies: true, evidenceItems: [] });
    expect(primaryAsk(asks)?.id).toBe("return_request");
    expect(askActionKey("return_request")).toBe("disputes.evidenceTab.returnRequest.title");
  });

  it("a returned parcel offers no ask of its own (the question was removed 2026-11-10)", () => {
    const asks = resolveMerchantAsks({ ...base, returnedToSender: true });
    expect(asks.filter((a) => a.offered && a.priority === "required")).toEqual([]);
    expect(primaryAsk(asks)?.priority).not.toBe("required");
    expect(ASK_IDS as readonly string[]).not.toContain("parcel_outcome");
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

describe("planted mutation: remove the return_request ask from the registry and its assertions fail", () => {
  // The first real case whose required, pending ask is the return question.
  const subject = fixturesWithReturnAsk()[0];
  function fixturesWithReturnAsk() {
    return loadFixtures().filter((fx) =>
      (workspaceDataOf(fx).asks ?? []).some((a) => a.id === "return_request" && a.priority === "required" && a.offered && a.pending),
    );
  }
  const f = () => {
    vi.setSystemTime(new Date(subject.meta.capturedAt));
    return subject;
  };
  const withoutReturn = (d: WorkspaceData): WorkspaceData => ({ ...d, asks: (d.asks ?? []).filter((a: Ask) => a.id !== "return_request") });

  it("a captured case with a required, pending return question exists", () => {
    expect(subject, "no fixture has a pending return_request ask").toBeDefined();
  });

  it("with the ask: the return card is on the Overview and the ask is on the page's call to action", () => {
    const d = workspaceDataOf(f());
    expect(visibleText(renderDisputePage(d, "overview"))).toContain(en("disputes.evidenceTab.returnRequest.title"));
    expect((d.asks ?? []).some((x) => x.id === "return_request" && x.offered && x.pending)).toBe(true);
  });

  it("without the ask: the card is not required on the Overview and the ask is gone", () => {
    const d = withoutReturn(workspaceDataOf(f()));
    expect((d.asks ?? []).some((x) => x.id === "return_request")).toBe(false);
    expect(primaryAsk(d.asks ?? [])?.id).not.toBe("return_request");
  });
});

describe("a required ask must name the module that consumes its answer", () => {
  // Every input switched on, so every ask is in the list.
  const all = resolveMerchantAsks({
    canDecide: true,
    reviewPending: true,
    bankClaimTrigger: "general_reason",
    bankClaimAnswered: false,
    returnedToSender: true,
    evidenceItems: [],
    submissionState: null,
    finalOutcome: null,
    returnRequestApplies: true,
    returnRequestAnswered: false,
    checklist: [{ field: "x", status: "missing", collectionType: "manual" }],
    gorgiasComms: { latestRun: {}, tickets: [] },
  });
  /** What the consumer file must mention, so a rename or deletion of the consumer fails here. */
  const MARKER: Record<string, string> = {
    review_decision: "review_state",
    bank_claim: "bank_claim",
    return_request: "merchantConfirmedNoRequest",
  };

  it("the registry lists the asks the test knows about", () => {
    expect(all.map((a) => a.id)).toEqual([...ASK_IDS]);
  });

  for (const id of ASK_IDS) {
    it(`${id}: if required, consumedBy is an existing module that reads the answer`, () => {
      const ask = all.find((a) => a.id === id)!;
      if (ask.priority !== "required") return;
      expect(ask.consumedBy, `${id} is required but names no consumer`).toBeTruthy();
      const path = join(process.cwd(), ask.consumedBy!);
      expect(existsSync(path), `${ask.consumedBy} does not exist`).toBe(true);
      expect(MARKER[id], `no marker registered for ${id}`).toBeTruthy();
      expect(readFileSync(path, "utf8")).toContain(MARKER[id]);
    });
  }
});
