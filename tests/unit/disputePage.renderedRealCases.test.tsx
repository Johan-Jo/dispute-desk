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

describe("#17066 returned-to-sender, unanswered (7aa8536c)", () => {
  const f = () => at(fixtureByCase("17066-returned-to-sender"));
  // KNOWN GAP -> PR 3 (asks registry puts the parcel ask on Overview). done when: passes without .fails
  it.fails("shows the parcel ask on the Overview", () => {
    expect(page(f(), "overview")).toContain(en("disputes.evidenceTab.parcelOutcome.title"));
  });
  // KNOWN GAP -> PR 3. done when: passes without .fails
  it.fails("the record's action token is the parcel ask, not a generic one", () => {
    const key = recordOf(f()).facts.action?.key;
    expect(["disputes.record.action.none", "disputes.record.action.ack", "disputes.record.action.evidence"]).not.toContain(key);
  });
  it("does not say action.none", () => {
    expect(saysActionNone(page(f(), "overview"))).toBe(false);
  });
  // KNOWN GAP -> PR 3. done when: passes without .fails
  it.fails("does not offer the cardholder acknowledgement as the primary action", () => {
    expect(saysActionAck(page(f(), "overview"))).toBe(false);
  });
});

describe("#23750 pack stamped saved, every save failed (e38c8d87)", () => {
  const f = () => at(fixtureByCase("23750-stamped-saved-save-failed"));
  // KNOWN GAP -> PR 2 (stage reads presentation.lifecycle). done when: passes without .fails
  it.fails("the stage is not 'saved'", () => {
    expect(recordOf(f()).stage).not.toBe("saved");
  });
  // KNOWN GAP -> PR 2. done when: passes without .fails
  it.fails("does not show headline.saved", () => {
    expect(page(f(), "overview")).not.toContain(en("disputes.record.headline.saved"));
  });
  // KNOWN GAP -> PR 2. done when: passes without .fails
  it.fails("does not show a package version number as saved", () => {
    expect(page(f(), "overview")).not.toMatch(/defence package version \d+ to Shopify/);
  });
  // The `save_failed` assertion is added only when #23750 is re-captured after Track S is on prod (plan 3.1).
});

describe("#24612 return received, credit not processed, won (2903f245)", () => {
  const f = () => at(fixtureByCase("24612-return-received-cnp-won"));
  it("shows that the return was received", () => {
    expect(page(f(), "overview")).toContain(en("disputes.record.item.return.returned"));
  });
  // KNOWN GAP -> PR 2 (refund line is refundStatement). done when: passes without .fails
  it.fails("shows the refund line from refundStatement", () => {
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
  // KNOWN GAP -> PR 2 (stage from resolveBuildAttempt). done when: passes without .fails
  it.fails("shows the build-failed state", () => {
    const text = page(f(), "overview");
    expect(text.includes(en("disputes.record.state.failed")) || text.includes(en("disputes.record.headline.failed"))).toBe(true);
  });
  // KNOWN GAP -> PR 2. done when: passes without .fails
  it.fails("does not show prepared.version", () => {
    expect(page(f(), "overview")).not.toMatch(/prepared (the )?defence package version \d+/);
  });
});

describe("won and filed (d00d141b)", () => {
  const f = () => at(fixtureByCase("won-filed"));
  it("shows the outcome line", () => {
    const text = page(f(), "overview");
    expect(text).toContain("The bank decided in your favour on 31 Oct 2026");
  });
  // KNOWN GAP -> PR 2 (outcomeExplanation added beside the outcome line). done when: passes without .fails
  it.fails("shows the outcome explanation when there is one", () => {
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

describe("review-awaiting (fc1971af)", () => {
  const f = () => at(fixtureByCase("review-awaiting"));
  // KNOWN GAP -> PR 3 (review_decision ask). done when: passes without .fails
  it.fails("the review ask is the action", () => {
    expect(recordOf(f()).facts.action?.key).toBe("disputes.record.action.review");
  });
  it("does not say action.none", () => {
    expect(saysActionNone(page(f(), "overview"))).toBe(false);
  });
});
