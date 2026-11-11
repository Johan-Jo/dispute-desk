/**
 * The RENDERED dispute page on real production cases (single-source plan 3.1).
 *
 * Fixtures are the real workspace payloads of seven prod disputes, scrubbed
 * (scripts/fixtures/capture-workspace-fixture.mjs), enriched by the SAME
 * `enrichWorkspacePayload` the route uses, and rendered through the production
 * component tree (tests/harness/renderDisputePage.tsx). A page that contradicts
 * its own data fails here, whichever component drew the sentence.
 *
 * One `it.fails` per assertion that the page does not yet meet: a PR that fixes
 * one assertion flips exactly that test (vitest then reports "expected to fail,
 * but passed" and the `.fails` must be removed). Each carries the PR that
 * flips it and a "done when" line. The named list is in the PR 1 body.
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("next/navigation", async () => (await import("../harness/workspaceHookMock")).navigationMock);
vi.mock("@/app/(embedded)/app/disputes/[id]/hooks/useDisputeWorkspace", async (orig) => ({
  ...(await orig<object>()),
  useDisputeWorkspace: (await import("../harness/workspaceHookMock")).useDisputeWorkspaceMock,
}));

import { createTranslator } from "use-intl/core";
import messages from "@/messages/en.json";
import { buildDisputeRecord } from "@/lib/disputes/disputeRecord";
import { createRecordFormat } from "@/lib/disputes/recordFormat";
import { refundStatementTokens, type RefundStatement } from "@/lib/disputes/refundStatement";
import { outcomeExplanationToken, resolveOutcomeExplanation } from "@/lib/disputes/outcomeExplanation";
import { resolveToken } from "@/lib/i18n/resolveToken";
import { recordInputsFromWorkspace, type WorkspaceWithPatterns } from "@/app/(embedded)/app/disputes/[id]/record/recordInputs";
import {
  en,
  fixtureByCase,
  renderDisputePage,
  visibleText,
  workspaceDataOf,
  type WorkspaceFixture,
} from "../harness/renderDisputePage";
import type { HarnessTab } from "../harness/workspaceHookMock";

const t = createTranslator({ locale: "en", messages: messages as never }) as never;
const say = (tok: Parameters<typeof resolveToken>[1]) => resolveToken(t, tok) as string;

function page(f: WorkspaceFixture, tab: HarnessTab = "overview"): string {
  return visibleText(renderDisputePage(workspaceDataOf(f), tab));
}
function recordOf(f: WorkspaceFixture) {
  const data = workspaceDataOf(f) as unknown as WorkspaceWithPatterns;
  return buildDisputeRecord(recordInputsFromWorkspace(data, f.meta.capturedAt), createRecordFormat("en"));
}
/** The hero card's text: from its headline to the "for you only" note that closes it. */
function heroText(f: WorkspaceFixture, tab: HarnessTab = "overview"): string {
  const text = page(f, tab);
  const start = text.indexOf(say(recordOf(f).statusCopy.headline));
  const end = text.indexOf(en("disputes.record.ui.forYouOnly"), start);
  expect(start, "hero headline not on the page").toBeGreaterThanOrEqual(0);
  expect(end, "hero end not found").toBeGreaterThan(start);
  return text.slice(start, end);
}
function expectNoVersionRoleCountsOrChips(hero: string) {
  expect(hero).not.toMatch(/version \d+/i);
  expect(hero).not.toMatch(/ are context in the package| is cited to the bank| are cited to the bank/);
  for (const role of ["cited", "context", "internal", "unavailable"]) {
    expect(hero).not.toMatch(new RegExp(`${en(`disputes.record.role.${role}`)} · \\d`));
  }
}
const ACTION_ACK = en("disputes.record.action.ack");
const ACTION_NONE = en("disputes.record.action.none");
/** `action.none` is a prefix of `action.ack`; "the page says none" means the bare sentence. */
const saysActionNone = (text: string) => text.split(ACTION_ACK).join(" ").includes(ACTION_NONE);
const saysActionAck = (text: string) => text.includes(ACTION_ACK);
const NO_RETURN_INITIATED = en("disputes.signalLabel.no_return_initiated");

beforeAll(() => {
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
});
function at(f: WorkspaceFixture) {
  vi.setSystemTime(new Date(f.meta.capturedAt));
  return f;
}

describe("#17066 returned-to-sender, nothing to argue (7aa8536c)", () => {
  const f = () => at(fixtureByCase("17066-returned-to-sender"));
  // The returned-parcel question was removed 2026-11-10: its answer reached no letter claim,
  // so the page states the true situation instead of asking (docs/plans/dispute-status-copy.plan.md section 10 H).
  const REMOVED = [
    "Tell us why this parcel came back",
    "why did this parcel come back to you",
    "Answer two questions",
    "Takes under a minute",
    "your answer is added to the response",
    "Needed to respond",
    "Returned Parcel Outcome",
  ];
  for (const tab of ["overview", "evidence"] as const) {
    it(`the ${tab} tab does not ask the parcel question, show its button, or name it as a missing item`, () => {
      const text = page(f(), tab);
      for (const phrase of REMOVED) expect(text, phrase).not.toContain(phrase);
      expect(text).not.toContain(en("disputes.record.status.action.ack"));
      expect(text).not.toContain(en("disputes.record.status.optional.ack"));
      expect(text).not.toContain(ACTION_ACK);
    });
    it(`the hero on the ${tab} tab says what is true: the parcel came back, DisputeDesk is not filing, Shopify still responds`, () => {
      const hero = heroText(f(), tab);
      expect(hero).toContain(en("disputes.record.status.headline.nothingToArgue"));
      expect(hero).toContain("Inquiry · SEK 3,021.65 · Shopify's deadline is today, 10 Nov 2026");
      expect(hero).toContain(en("disputes.record.status.label.happened"));
      expect(hero).toContain(en("disputes.record.status.fact.returnedToSender"));
      expect(hero).toContain("If nothing has changed, it files nothing, and Shopify still sends a response from the order's own data.");
      expect(hero).not.toContain(en("disputes.record.status.label.need"));
      expect(hero).not.toContain(en("disputes.record.status.next.expectLoss"));
    });
    it(`the hero on the ${tab} tab has no version number, role-count sentence or count chips`, () => {
      expectNoVersionRoleCountsOrChips(heroText(f(), tab));
    });
  }
  it("the record's action is not the parcel question, and the page does not say action.none or offer the acknowledgement", () => {
    expect(recordOf(f()).facts.action?.key ?? null).not.toBe("disputes.evidenceTab.parcelOutcome.title");
    expect(saysActionNone(page(f(), "overview"))).toBe(false);
    expect(saysActionAck(page(f(), "overview"))).toBe(false);
  });
  it("the delivery row says Returned to sender, not that delivery is unconfirmed", () => {
    const text = page(f(), "overview");
    expect(text).toContain(`${en("disputes.record.item.delivery.label")} ${en("disputes.deliveryProof.returnedToSender")}`);
    expect(text).not.toContain("has not confirmed delivery");
  });
  it("What happens next is one coherent sentence: a re-check on the deadline day, nothing filed if unchanged, Shopify still responds", () => {
    const hero = heroText(f(), "overview");
    expect(hero).toContain(
      "DisputeDesk checks the record once more on the deadline day, 10 Nov 2026. If nothing has changed, it files nothing, and Shopify still sends a response from the order's own data.",
    );
    expect(hero).not.toContain("build the response again");
    expect(hero).not.toContain(en("disputes.record.status.next.shopifySends"));
  });
  it("there is no 'Your decision' row (nothing could be filed), and no 'No return was received' row", () => {
    for (const tab of ["overview", "evidence"] as const) {
      const text = page(f(), tab);
      expect(text).not.toContain(en("disputes.record.ui.decideTitle"));
      expect(text).not.toContain(en("disputes.record.ui.decideSave"));
      expect(text).not.toContain(en("disputes.record.ui.decideNone"));
    }
    expect(page(f(), "overview")).not.toContain("No return was received");
  });
  it("the timeline says the record was checked and no response written, with no package version", () => {
    const text = page(f(), "overview");
    expect(text).toContain("Record checked 10 Nov 2026 · DisputeDesk checked the record on 10 Nov 2026 and wrote no response.");
    expect(text).not.toMatch(/version \d+/);
    expect(text).not.toContain("Defence package prepared");
    expect(text).not.toContain("prepared defence package");
  });
  it("the registry offers no ask for it", () => {
    expect((workspaceDataOf(f()).asks ?? []).filter((a) => a.offered && a.priority === "required" && a.pending)).toEqual([]);
  });
});

describe("the hero of every captured case", () => {
  const cases = [
    "17066-returned-to-sender",
    "21037-return-in-progress",
    "23750-stamped-saved-save-failed",
    "24285-latest-build-failed",
    "24612-return-received-cnp-won",
    "review-awaiting",
    "won-filed",
  ];
  for (const name of cases) {
    it(`${name}: headline, sub-line and no empty labelled part; no version, role sentence or chips`, () => {
      const f = at(fixtureByCase(name));
      const copy = recordOf(f).statusCopy;
      const hero = heroText(f);
      expect(hero).toContain(say(copy.subline));
      expect(copy.parts.length).toBeGreaterThan(0);
      for (const p of copy.parts) {
        expect(p.lines.length + p.actions.length).toBeGreaterThan(0);
        expect(hero).toContain(say(p.label));
      }
      expectNoVersionRoleCountsOrChips(hero);
    });
  }
});

describe("#23750 pack stamped saved, every save failed (e38c8d87)", () => {
  const f = () => at(fixtureByCase("23750-stamped-saved-save-failed"));
  it("the stage is not 'saved'", () => {
    expect(recordOf(f()).stage).not.toBe("saved");
  });
  // Fixed by the action-first hero: a stamp Shopify never confirmed reads "has not confirmed", not "saved".
  it("does not show headline.saved", () => {
    expect(page(f(), "overview")).not.toContain(en("disputes.record.headline.saved"));
    expect(page(f(), "overview")).toContain(en("disputes.record.status.headline.unconfirmed"));
  });
  it("does not show a package version number as saved", () => {
    expect(page(f(), "overview")).not.toMatch(/defence package version \d+ to Shopify/);
  });
  // The `save_failed` assertion is added only when #23750 is re-captured after Track S is on prod (plan 3.1).
});

describe("#24612 return received, credit not processed, won (2903f245)", () => {
  const f = () => at(fixtureByCase("24612-return-received-cnp-won"));
  it("shows that the return was received", () => {
    expect(page(f(), "overview")).toContain(en("disputes.record.item.return.returned"));
  });
  it("shows the refund line from refundStatement", () => {
    const stmt = workspaceDataOf(f()).dispute.refundStatement as RefundStatement;
    const { title, detail } = refundStatementTokens(stmt);
    const text = page(f(), "overview");
    expect(text.includes(say(title)) || text.includes(say(detail))).toBe(true);
  });
  it("does not say 'No return initiated' (either tab)", () => {
    expect(page(f(), "overview")).not.toContain(NO_RETURN_INITIATED);
    expect(page(f(), "evidence")).not.toContain(NO_RETURN_INITIATED);
  });
});

describe("#21037 return in progress (defa8294)", () => {
  const f = () => at(fixtureByCase("21037-return-in-progress"));
  it("shows that the return is in progress", () => {
    expect(page(f(), "overview")).toContain(en("disputes.record.item.return.inProgress"));
  });
  it("does not say 'No return initiated' (either tab)", () => {
    expect(page(f(), "overview")).not.toContain(NO_RETURN_INITIATED);
    expect(page(f(), "evidence")).not.toContain(NO_RETURN_INITIATED);
  });
  it("does not offer the cardholder acknowledgement", () => {
    const text = page(f(), "overview");
    expect(saysActionAck(text)).toBe(false);
    expect(text).not.toContain(en("disputes.record.help.ack.title"));
  });
});

describe("#24285 latest build failed (d65b7220)", () => {
  const f = () => at(fixtureByCase("24285-latest-build-failed"));
  // Fixed by the action-first hero: the build-failed state reads from resolveBuildAttempt, not the old stage text.
  it("shows the build-failed state", () => {
    expect(page(f(), "overview")).toContain(en("disputes.record.status.headline.buildFailed"));
  });
  // Fixed 2026-11-10: a latest build that wrote no response prints "checked the record ... wrote no response", never a version.
  it("does not show prepared.version", () => {
    expect(page(f(), "overview")).not.toMatch(/prepared (the )?defence package version \d+/);
  });
});

describe("won and filed (d00d141b)", () => {
  const f = () => at(fixtureByCase("won-filed"));
  it("shows the outcome line", () => {
    const text = page(f(), "overview");
    expect(text).toContain("The bank decided in your favour on 31 Oct 2026");
  });
  it("shows the outcome explanation when there is one", () => {
    const fx = f();
    const rows = fx.sourceRows.outcomeInputs;
    expect(rows, "fixture must carry the submitted package").not.toBeNull();
    const explanation = resolveOutcomeExplanation({ outcome: "won", reason: "FRAUDULENT", pack: rows });
    const fmt = createRecordFormat("en");
    const token = outcomeExplanationToken(explanation, "won", rows?.submittedAt ? fmt.date(rows.submittedAt) : null);
    expect(token, "the explanation must be non-null for this fixture").not.toBeNull();
    expect(page(fx, "overview")).toContain(say(token as never));
  });
  it("does not say filed.none", () => {
    expect(page(f(), "overview")).not.toContain(en("disputes.record.filed.none"));
  });
});

describe("the header chip and the hero agree (one state)", () => {
  it("#24285: no 'Held until the deadline' chip beside 'has not been able to write this response yet'", () => {
    const f = at(fixtureByCase("24285-latest-build-failed"));
    for (const tab of ["overview", "evidence"] as const) {
      const text = page(f, tab);
      expect(text).not.toContain(en("disputes.record.chip.held"));
      expect(text).toContain(en("disputes.record.status.headline.buildFailed"));
      expect(text).toContain(en("disputes.record.status.chip.build_failed"));
    }
  });
  it("#17066: the sub-line says 'deadline is today' and the acknowledgement is not suggested", () => {
    const f = at(fixtureByCase("17066-returned-to-sender"));
    const text = page(f, "overview");
    expect(text).toContain("Shopify's deadline is today, 10 Nov 2026");
    expect(text).toContain(en("disputes.record.status.chip.nothing_to_argue"));
    expect(text).not.toContain(en("disputes.record.help.ack.title"));
    expect(text).not.toContain(en("disputes.record.status.action.ack"));
    expect(text).not.toContain(en("disputes.record.status.optional.ack"));
    expect(text).not.toContain(ACTION_ACK);
  });
  it("whenever the 'Your decision' row is hidden, the hero carries Approve and Don't add a response", () => {
    for (const name of ["review-awaiting", "24285-latest-build-failed"]) {
      const f = at(fixtureByCase(name));
      const r = recordOf(f);
      const text = page(f, "overview");
      const rowShown = text.includes(en("disputes.record.ui.decideTitle"));
      if (r.canDecide && !rowShown) {
        const hero = heroText(f);
        expect(hero, name).toContain(en("disputes.record.status.action.approve"));
        expect(hero, name).toContain(en("disputes.record.status.action.concede"));
      }
    }
    const f = at(fixtureByCase("review-awaiting"));
    expect(recordOf(f).canDecide).toBe(true);
    expect(page(f, "overview")).not.toContain(en("disputes.record.ui.decideTitle"));
    expect(heroText(f)).toContain(en("disputes.record.status.action.approve"));
  });
});

describe("review-awaiting (fc1971af)", () => {
  const f = () => at(fixtureByCase("review-awaiting"));
  it("the review ask is the action", () => {
    expect(recordOf(f()).facts.action?.key).toBe("disputes.record.action.review");
  });
  it("does not say action.none", () => {
    expect(saysActionNone(page(f(), "overview"))).toBe(false);
  });
});
