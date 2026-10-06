import { describe, it, expect } from "vitest";
import { buildWinnabilityResultEmail } from "../resultEmail";
import { scoreWinnability, scoreRatio, ctaFor } from "../scoring";

const BASE = "https://disputedesk.app";
const UNSUB = "https://disputedesk.app/api/playbook/unsubscribe?token=abc.def";

function build(answers: Record<string, string | number>) {
  return buildWinnabilityResultEmail({ answers, baseUrl: BASE, unsubscribeUrl: UNSUB });
}

describe("winnability scoring", () => {
  it("scores the full friendly-fraud win path", () => {
    const a = { reason: "ff", returning: "yes", window: "yes", anchor: "yes" };
    expect(scoreWinnability(a).state).toBe("win");
  });

  it("any 'not sure' on the win path → borderline", () => {
    const a = { reason: "ff", returning: "yes", window: "unsure", anchor: "yes" };
    expect(scoreWinnability(a).state).toBe("borderline");
  });

  it("missing anchor → not winnable", () => {
    const a = { reason: "ff", returning: "yes", window: "yes", anchor: "none" };
    expect(scoreWinnability(a).state).toBe("no");
  });

  it("genuine fraud → not winnable, fraud lane", () => {
    const w = scoreWinnability({ reason: "fraud" });
    expect(w.state).toBe("no");
    expect(w.lane).toBe("fraud");
  });

  it("INR / NAD → different lane", () => {
    expect(scoreWinnability({ reason: "inr" }).state).toBe("other");
    expect(scoreWinnability({ reason: "nad" }).state).toBe("other");
  });

  // Bands follow Visa VAMP (programmeThresholds.ts): Excessive 1.5% since
  // 2026-04-01, early-warning 0.9%. They used to follow the retired VDMP
  // (0.65% / 0.9%), which called a healthy 0.7% store "amber".
  it("ratio bands at the VAMP thresholds", () => {
    expect(scoreRatio({ disputes: 16, orders: 1000 }).band).toBe("red"); // 1.6%
    expect(scoreRatio({ disputes: 12, orders: 900 }).band).toBe("amber"); // 1.33%
    expect(scoreRatio({ disputes: 7, orders: 1000 }).band).toBe("green"); // 0.7% — fine under VAMP
    expect(scoreRatio({ disputes: 3, orders: 1000 }).band).toBe("green"); // 0.3%
    expect(scoreRatio({ disputes: 1, orders: 0 }).band).toBe("unknown");
  });

  it("ratio band edges are exact (fractions, not float percents)", () => {
    expect(scoreRatio({ disputes: 9, orders: 1000 }).band).toBe("amber"); // exactly 0.9%
    expect(scoreRatio({ disputes: 899, orders: 100000 }).band).toBe("green"); // 0.899%
    expect(scoreRatio({ disputes: 15, orders: 1000 }).band).toBe("red"); // exactly 1.5%
    expect(scoreRatio({ disputes: 1499, orders: 100000 }).band).toBe("amber"); // 1.499%
  });
});

describe("winnability result email", () => {
  it("subject carries the verdict label", () => {
    const { subject } = build({ reason: "ff", returning: "yes", window: "yes", anchor: "yes" });
    expect(subject).toBe("Your chargeback result: Winnable");
  });

  it("email CTA matches the on-screen CTA (same shared map)", () => {
    const answers = { reason: "ff", returning: "yes", window: "yes", anchor: "yes" };
    const cta = ctaFor(scoreWinnability(answers));
    const { html } = build(answers);
    // Primary CTA label + absolutized href both present in the email.
    expect(html).toContain(cta.primary.label);
    expect(html).toContain(`${BASE}/#pricing`);
  });

  it("names VAMP and the 1.5% line, never the retired Dispute Monitoring Program", () => {
    const { html, text } = build({ reason: "ff", returning: "yes", window: "yes", anchor: "yes", disputes: 12, orders: 900 });
    for (const body of [html, text]) {
      expect(body).toContain("VAMP");
      expect(body).toContain("1.5%");
      expect(body).not.toContain("Dispute Monitoring Program");
      expect(body).not.toContain("danger line sits at ~0.9%");
    }
  });

  it("absolutizes relative CTA hrefs and includes the hosted shield + unsubscribe", () => {
    const { html } = build({ reason: "fraud" });
    expect(html).toContain(`${BASE}/shield-icon.png`);
    expect(html).toContain(UNSUB);
    expect(html).toContain(`${BASE}/demo`); // fraud lane → /demo primary
  });

  it("renders a verdict + ratio for every state without throwing", () => {
    const cases: Record<string, string | number>[] = [
      { reason: "ff", returning: "yes", window: "yes", anchor: "yes", disputes: 12, orders: 900 },
      { reason: "ff", returning: "yes", window: "unsure", anchor: "yes", disputes: 7, orders: 1000 },
      { reason: "ff", returning: "yes", window: "yes", anchor: "none", disputes: 3, orders: 1000 },
      { reason: "inr" },
      { reason: "fraud" },
    ];
    for (const a of cases) {
      const { subject, html, text } = build(a);
      expect(subject.startsWith("Your chargeback result: ")).toBe(true);
      expect(html).toContain("YOUR RESULT");
      expect(text).toContain("YOUR RESULT");
    }
  });
});
