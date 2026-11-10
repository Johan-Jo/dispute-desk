/**
 * Owner coverage, keyed by OWNER not by surface (single-source plan 3.2).
 *
 * The workspace payload carries the answers (lifecycle, attention, refund
 * statement, order situation, effective checklist, ...). Each owner key must be
 * READ - looked inside, at a leaf - by at least one live builder: the pure
 * builders (`recordInputsFromWorkspace`, `deriveWorkspace`) and the render
 * harness over every fixture and both tabs. Delete the only reader of an owner,
 * or build a page that never looks at it, and this fails whichever component
 * the reader lived in.
 *
 * The payload is wrapped AFTER enrichment (`enrichWorkspacePayload` is not a
 * live builder). Spreading, enumerating, `JSON.stringify` and passing an object
 * along do not count as reads (tests/harness/trackReads.ts); the planted
 * meta-tests below pin that.
 */
import { describe, expect, it, vi, beforeAll } from "vitest";

vi.mock("next/navigation", async () => (await import("../harness/workspaceHookMock")).navigationMock);
vi.mock("@/app/(embedded)/app/disputes/[id]/hooks/useDisputeWorkspace", async (orig) => ({
  ...(await orig<object>()),
  useDisputeWorkspace: (await import("../harness/workspaceHookMock")).useDisputeWorkspaceMock,
}));

import type { WorkspaceData } from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";
import { loadFixtures, workspaceDataOf } from "../harness/fixtures";
import { runLiveBuilders } from "../harness/runLive";
import { OWNER_EXEMPTIONS, OWNER_KEYS, type OwnerKey } from "../harness/ownerKeys";
import { ownerIsRead, trackReads, valueAtPath } from "../harness/trackReads";

/** Per owner: read by a live builder on at least one fixture. */
function coverage(): Record<OwnerKey, boolean> {
  const out = Object.fromEntries(OWNER_KEYS.map((k) => [k, false])) as Record<OwnerKey, boolean>;
  vi.useFakeTimers();
  try {
    for (const f of loadFixtures()) {
      vi.setSystemTime(new Date(f.meta.capturedAt));
      const plain = workspaceDataOf(f);
      const reads = new Set<string>();
      runLiveBuilders(f, (d) => trackReads(d as unknown as object, reads).proxy as unknown as WorkspaceData);
      for (const k of OWNER_KEYS) if (ownerIsRead(k, reads, valueAtPath(plain, k))) out[k] = true;
    }
  } finally {
    vi.useRealTimers();
  }
  return out;
}

describe("every owner key is read by a live builder", () => {
  let covered: Record<OwnerKey, boolean>;
  beforeAll(() => {
    covered = coverage();
  });

  const KNOWN_GAPS: Partial<Record<OwnerKey, string>> = {
    // KNOWN GAP -> PR 2: the record shows the refund from `orderSituation.refund` and `buildChecklistRows`,
    // never from `refundStatement` (built at route.ts:516, zero readers). done when: passes without .fails.
    "dispute.refundStatement": "PR 2",
  };

  for (const k of OWNER_KEYS) {
    if (k in KNOWN_GAPS) {
      it.fails(`${k} is read (known gap, ${KNOWN_GAPS[k]})`, () => {
        expect(covered[k]).toBe(true);
      });
    } else if (k in OWNER_EXEMPTIONS) {
      it(`${k} is exempt, with a reason, and still unread`, () => {
        expect(OWNER_EXEMPTIONS[k as OwnerKey]?.trim().length).toBeGreaterThanOrEqual(20);
        expect(covered[k], `${k} IS read now - delete its exemption`).toBe(false);
      });
    } else {
      it(`${k} is read`, () => {
        expect(covered[k]).toBe(true);
      });
    }
  }
});

describe("planted meta-tests (the read tracker is real)", () => {
  const payload = () => ({
    presentation: { lifecycle: "saved_to_shopify", attention: "none" },
    dispute: { refundStatement: { kind: "some", amount: "5.0" }, orderSituation: null },
    bankClaim: { trigger: "x", answer: { a: 1 } },
    evidenceLineItems: [{ field: "a" }, { field: "b" }],
  });
  const read = (build: (d: ReturnType<typeof payload>) => unknown) => {
    const p = payload();
    const t = trackReads(p);
    build(t.proxy);
    return (k: string) => ownerIsRead(k, t.reads, valueAtPath(p, k));
  };

  it("a builder that only spreads `data` reads nothing", () => {
    const has = read((d) => ({ ...d }));
    for (const k of OWNER_KEYS) expect(has(k), k).toBe(false);
  });

  it("a builder that spreads or enumerates an owner object reads nothing below it", () => {
    const has = read((d) => ({ ...d.dispute.refundStatement, entries: Object.entries(d.bankClaim), keys: Object.keys(d.presentation) }));
    expect(has("dispute.refundStatement")).toBe(false);
    expect(has("bankClaim")).toBe(false);
    expect(has("presentation.lifecycle")).toBe(false);
  });

  it("JSON.stringify of the payload reads nothing", () => {
    const has = read((d) => JSON.stringify(d));
    for (const k of OWNER_KEYS) expect(has(k), k).toBe(false);
  });

  it("passing an owner object along reads nothing; the `in` operator reads nothing", () => {
    const has = read((d) => {
      const sink: unknown[] = [];
      sink.push(d.dispute.refundStatement, d.bankClaim);
      return "kind" in d.dispute.refundStatement;
    });
    expect(has("dispute.refundStatement")).toBe(false);
    expect(has("bankClaim")).toBe(false);
  });

  it("a builder that reads one leaf counts exactly that owner once", () => {
    const has = read((d) => d.dispute.refundStatement.kind);
    expect(has("dispute.refundStatement")).toBe(true);
    expect(has("bankClaim")).toBe(false);
    expect(has("dispute.orderSituation")).toBe(false);
  });

  it("reading a non-object (string) owner directly counts; reading its parent does not", () => {
    expect(read((d) => d.presentation.lifecycle)("presentation.lifecycle")).toBe(true);
    expect(read((d) => d.presentation)("presentation.lifecycle")).toBe(false);
  });

  it("reading an array owner's element counts", () => {
    expect(read((d) => d.evidenceLineItems.map((l) => l.field))("evidenceLineItems")).toBe(true);
    expect(read((d) => d.evidenceLineItems)("evidenceLineItems")).toBe(false);
  });
});
