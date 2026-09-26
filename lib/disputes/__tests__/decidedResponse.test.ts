import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en.json";
import {
  HOLD_REASONS,
  classifyHoldReason,
  decidedResponseTokens,
  resolveDecidedResponse,
  type DecidedAuditEvent,
} from "@/lib/disputes/decidedResponse";

/**
 * Fixtures are the audit payloads as they stand in prod
 * (`aokhplydttxtebvbeuzc`, read 2026-09-26), not idealised shapes — prod
 * carries at least eight `auto_save_blocked` payload generations, and a
 * classifier that only knows the newest one misreads the rest.
 */

/** Order #360499, blume-box: the case that prompted this module. */
const EVENTS_360499: DecidedAuditEvent[] = [
  {
    event_type: "auto_save_blocked",
    event_payload: {
      reasons: ["Auto-mode case strength is Weak — auto-submit blocked per PRD §9"],
      case_strength: "weak",
      decision_reason_codes: ["strength_insufficient"],
    },
  },
  {
    event_type: "auto_save_blocked",
    event_payload: {
      source: "defence_build",
      reasons: ["strength_insufficient"],
      coverage: "not_covered",
      decision: "hold_for_deadline",
      fatal_loss: null,
      case_strength: "weak",
      verdict_reason: "strength_insufficient",
    },
  },
  {
    event_type: "auto_save_blocked",
    event_payload: {
      reasons: ["Auto-submit blocked — fatal-loss condition (inr_no_fulfillment) per PRD §5"],
      fatal_loss: "inr_no_fulfillment",
    },
  },
  {
    event_type: "defence_package_blocked_unsafe_claim",
    event_payload: {
      decisionAction: "block",
      fallbackReason: "unsafe_address_claim",
      selectionReason: "coverage_or_concession",
      decisionReasonCodes: ["fatal_loss"],
    },
  },
];

const ROW_360499 = {
  closedAt: "2026-09-17T11:20:31+00:00",
  dueAt: "2026-09-11T23:00:00+00:00",
  evidenceSentOn: "2026-09-12T07:43:03+00:00",
  installedAt: "2026-03-10T00:00:00+00:00",
  weFiledAt: null,
  hasPack: true,
  reviewState: null,
  events: EVENTS_360499,
};

const fmt = (iso: string) => iso.slice(0, 10);

function lookup(key: string): string | undefined {
  let node: unknown = enMessages;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

function render(tokens: ReturnType<typeof decidedResponseTokens>): string {
  return tokens
    .map((t) => {
      let s = lookup(t.key);
      expect(s, `missing en message ${t.key}`).toBeTypeOf("string");
      for (const [k, v] of Object.entries(t.params ?? {})) s = s!.split(`{${k}}`).join(String(v));
      return s!;
    })
    .join(" ");
}

describe("decidedResponse — order #360499", () => {
  it("says Shopify responded and we held it because the order never shipped", () => {
    const resp = resolveDecidedResponse(ROW_360499);
    expect(resp.responder).toBe("shopify");
    expect(resp.holdReason).toBe("not_shipped");
    expect(resp.decidedBeforeDeadline).toBe(false);

    const text = render(decidedResponseTokens(resp, fmt));
    expect(text).toContain("sent through Shopify on 2026-09-12");
    expect(text).toContain("the order was never shipped");
    // The sentence this replaced — false on this case.
    expect(text).not.toContain("decided before DisputeDesk");
  });

  it("an order-record fact outranks the earlier weak-strength hold", () => {
    expect(classifyHoldReason({ events: EVENTS_360499, hasPack: true, reviewState: null })).toBe(
      "not_shipped",
    );
  });
});

describe("decidedResponse — who responded", () => {
  it("our own save wins over Shopify's evidenceSentOn", () => {
    const resp = resolveDecidedResponse({
      ...ROW_360499,
      weFiledAt: "2026-09-10T08:00:00+00:00",
    });
    expect(resp.responder).toBe("we");
    expect(resp.filedAt).toBe("2026-09-10T08:00:00+00:00");
    expect(resp.holdReason).toBeNull();
    // `outcomeExplanation` owns the filed copy.
    expect(decidedResponseTokens(resp, fmt)).toEqual([]);
  });

  it("a case closed before install is before_install, even with a response on file", () => {
    // The 390 historical imports carry submission_state='submitted_confirmed'.
    const resp = resolveDecidedResponse({
      ...ROW_360499,
      installedAt: "2026-10-01T00:00:00+00:00",
      hasPack: false,
      events: [],
    });
    expect(resp.responder).toBe("before_install");
    expect(render(decidedResponseTokens(resp, fmt))).toBe(
      "This dispute was decided before DisputeDesk was installed.",
    );
  });

  it("a response sent before install is not blamed on a hold (6a8848 #92361)", () => {
    // Sent 2026-08-24, shop installed 2026-08-29, decided 2026-09-19.
    const resp = resolveDecidedResponse({
      closedAt: "2026-09-19T10:00:00+00:00",
      dueAt: "2026-08-24T23:00:00+00:00",
      evidenceSentOn: "2026-08-23T23:28:05+00:00",
      installedAt: "2026-08-29T09:00:00+00:00",
      weFiledAt: null,
      hasPack: false,
      reviewState: null,
      events: [],
    });
    expect(resp.responder).toBe("sent_before_install");
    expect(render(decidedResponseTokens(resp, fmt))).toContain("before DisputeDesk was installed");
  });

  it("nothing sent and decided before the deadline says exactly that (6a8848 #102014)", () => {
    const resp = resolveDecidedResponse({
      closedAt: "2026-09-19T10:00:00+00:00",
      dueAt: "2026-10-07T23:00:00+00:00",
      evidenceSentOn: null,
      installedAt: "2026-08-29T09:00:00+00:00",
      weFiledAt: null,
      hasPack: true,
      reviewState: null,
      events: [
        {
          event_type: "parked_for_review",
          event_payload: { reason: "Rule action is review — awaiting merchant approval" },
        },
      ],
    });
    expect(resp.responder).toBe("none");
    expect(resp.decidedBeforeDeadline).toBe(true);
    const text = render(decidedResponseTokens(resp, fmt));
    expect(text).toContain("The decision came on 2026-09-19, before the response deadline");
    expect(text).toContain("waiting for your review");
  });

  it("nothing sent after the deadline does not claim the bank was early", () => {
    const resp = resolveDecidedResponse({
      ...ROW_360499,
      evidenceSentOn: null,
    });
    expect(resp.responder).toBe("none");
    expect(resp.decidedBeforeDeadline).toBe(false);
    expect(render(decidedResponseTokens(resp, fmt))).toMatch(/^No evidence was filed on this case\./);
  });

  it("a missing deadline never counts as 'decided before the deadline'", () => {
    const resp = resolveDecidedResponse({ ...ROW_360499, evidenceSentOn: null, dueAt: null });
    expect(resp.decidedBeforeDeadline).toBe(false);
  });
});

describe("decidedResponse — hold reasons (prod payload shapes)", () => {
  const classify = (events: DecidedAuditEvent[], hasPack = true, reviewState: string | null = null) =>
    classifyHoldReason({ events, hasPack, reviewState });

  it("a merchant concession outranks every pipeline hold", () => {
    expect(
      classify([
        ...EVENTS_360499,
        {
          event_type: "review_conceded",
          event_payload: { reason: "parcel returned to sender 2026-09-07" },
        },
      ]),
    ).toBe("merchant_conceded");
    expect(classify([], true, "conceded")).toBe("merchant_conceded");
  });

  it("quota and plan blocks explain a case with no pack", () => {
    const skip = (reason: string): DecidedAuditEvent => ({
      event_type: "auto_build_skipped",
      event_payload: { reason },
    });
    expect(classify([skip("quota_exceeded")], false)).toBe("plan_limit");
    expect(classify([skip("feature_blocked")], false)).toBe("plan_limit");
    expect(classify([skip("auto_build_off")], false)).toBe("auto_build_off");
    expect(
      classify([{ event_type: "billing_blocked_email_sent", event_payload: { reason: "quota_exceeded" } }], false),
    ).toBe("plan_limit");
  });

  it("…but not once a pack exists — the skip was replayed and is history", () => {
    expect(
      classify([{ event_type: "auto_build_skipped", event_payload: { reason: "quota_exceeded" } }], true),
    ).toBeNull();
  });

  it("both parked_for_review payload generations mean awaiting review", () => {
    expect(
      classify([
        {
          event_type: "parked_for_review",
          event_payload: { reason: "Auto-mode case strength is Moderate — parked for merchant review per PRD §9" },
        },
      ]),
    ).toBe("awaiting_review");
    expect(classify([{ event_type: "auto_save_blocked", event_payload: { decision: "park_for_review" } }])).toBe(
      "awaiting_review",
    );
  });

  it("an approval clears 'waiting for your review'", () => {
    const parked: DecidedAuditEvent = {
      event_type: "parked_for_review",
      event_payload: { reason: "Rule action is review — awaiting merchant approval" },
    };
    expect(classify([parked, { event_type: "review_approved", event_payload: {} }])).toBeNull();
    expect(classify([parked], true, "approved")).toBeNull();
  });

  it("refund and coverage holds are named", () => {
    expect(
      classify([{ event_type: "auto_save_blocked", event_payload: { fatal_loss: "refund_issued" } }]),
    ).toBe("refunded");
    expect(
      classify([{ event_type: "auto_save_blocked", event_payload: { coverage: "covered_shopify" } }]),
    ).toBe("covered");
  });

  it("an unrecognised payload names no reason rather than guessing", () => {
    expect(classify([{ event_type: "auto_save_blocked", event_payload: { something: "new" } }])).toBeNull();
    expect(classify([{ event_type: "auto_save_blocked", event_payload: null }])).toBeNull();
  });
});

describe("decidedResponse — copy", () => {
  const LOCALES = ["en", "de", "es", "fr", "pt", "sv"] as const;

  it("every message exists in all six locales, with {date} intact", async () => {
    const en = (enMessages as { disputes: { decidedResponse: Record<string, unknown> } }).disputes
      .decidedResponse;
    for (const loc of LOCALES) {
      const m = (await import(`@/messages/${loc}.json`)).default;
      const block = m.disputes.decidedResponse as Record<string, unknown>;
      expect(block, `${loc} missing decidedResponse`).toBeTruthy();
      expect(Object.keys(block).sort()).toEqual(Object.keys(en).sort());
      for (const key of ["sentBeforeInstall", "shopifySent", "noneBeforeDeadline"]) {
        expect(block[key], `${loc}.${key}`).toContain("{date}");
      }
      const reasons = block.holdReason as Record<string, string>;
      expect(Object.keys(reasons).sort()).toEqual([...HOLD_REASONS].sort());
    }
  });

  it("never names a card network or a gateway code to the merchant", () => {
    const text = JSON.stringify(
      (enMessages as { disputes: { decidedResponse: unknown } }).disputes.decidedResponse,
    );
    // (Phrases split with \s+ so this file does not trip the CI forbidden-copy grep.)
    expect(text).not.toMatch(/\bAVS\b|\bCVV\b|card\s+network|submit\s+response/i);
  });
});
