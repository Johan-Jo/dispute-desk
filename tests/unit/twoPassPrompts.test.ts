import { describe, it, expect } from "vitest";
import {
  PASS_ONE_SYSTEM_PROMPT,
  PASS_TWO_SYSTEM_PROMPT,
  buildPassOneUserPrompt,
  buildPassTwoUserPrompt,
  validatePassOneShape,
  type PassOneSourceMaterial,
  type TwoPassBriefContext,
} from "@/lib/resources/generation/twoPassPrompts";

const ctx: TwoPassBriefContext = {
  topic: "Shopify chargebacks operations",
  targetKeyword: "Shopify chargebacks",
  contextSummary: "End-to-end Shopify chargeback handling, Admin paths, response windows.",
  notes: '{"audience":"Shopify merchants","shopify_specifics":["Disputes section in Admin"]}',
  locale: "en-US",
  localeInstruction: "Write in American English. Direct tone.",
};

const validMaterial: PassOneSourceMaterial = {
  observations: ["Most lost disputes are operational losses, not evidence losses."],
  failure_modes: [
    {
      name: "Scattered evidence",
      what_it_looks_like: "Tracking lives in carrier portal, comms in Gorgias, payment in Shopify.",
      why_it_loses: "Late assembly misses the response window.",
      what_to_do: "Centralize before day 5.",
    },
  ],
  messy_examples: [
    {
      scenario: "Beauty brand, AOV $90, fraud chargeback on $189 order",
      what_happened: "AVS Y, tracking delivered, but signature was a roommate's; cardholder claims unauthorized.",
      decision: "Submitted with tracking + AVS, no signed contract.",
      outcome: "Lost. Issuer cited 'signed by another party'.",
    },
  ],
  evidence_hierarchy: [
    {
      type: "AVS",
      strong: "AVS Y on cardholder's billing address",
      moderate: "AVS Y but VPN-flagged IP",
      weak: "AVS only, no shipping match",
      edge_cases: "Shopify Payments displays AVS in payment summary; third-party gateways vary",
    },
  ],
  shopify_workflow_notes: ["Disputes appear in Settings → Payments → Manage."],
  processor_network_caveats: ["Confirm response windows with your processor."],
  positioning_constraints: ["Automation improves consistency, not certainty."],
};

/* ── Pass 1 system prompt ────────────────────────────────────────────── */

describe("PASS_ONE_SYSTEM_PROMPT", () => {
  it("does NOT mention 'pillar' / 'guide' / 'complete' / 'comprehensive overview'", () => {
    const p = PASS_ONE_SYSTEM_PROMPT;
    expect(/\bpillar\b/i.test(p)).toBe(false);
    // "guide" appears once in negative framing ("NOT blog articles, guides…") which is fine
    expect(p).toContain("NOT blog articles, guides");
    expect(p).not.toContain("complete guide");
    expect(p.toLowerCase()).not.toContain("authority pillar");
  });

  it("forbids article packaging in Pass 1 output", () => {
    expect(PASS_ONE_SYSTEM_PROMPT).toMatch(/NOT writing an article/i);
    expect(PASS_ONE_SYSTEM_PROMPT).toMatch(/NOT producing prose, HTML, a title/i);
  });

  it("requires the source-material schema", () => {
    expect(PASS_ONE_SYSTEM_PROMPT).toContain('"observations"');
    expect(PASS_ONE_SYSTEM_PROMPT).toContain('"failure_modes"');
    expect(PASS_ONE_SYSTEM_PROMPT).toContain('"messy_examples"');
    expect(PASS_ONE_SYSTEM_PROMPT).toContain('"evidence_hierarchy"');
    expect(PASS_ONE_SYSTEM_PROMPT).toContain('"shopify_workflow_notes"');
    // Renamed from disputedesk_positioning_notes to reduce schema-leakage to headings.
    expect(PASS_ONE_SYSTEM_PROMPT).toContain('"positioning_constraints"');
    expect(PASS_ONE_SYSTEM_PROMPT).not.toContain('"disputedesk_positioning_notes"');
  });

  it("inherits the banned-phrase blocklist from the voice core", () => {
    expect(PASS_ONE_SYSTEM_PROMPT).toContain("Hard-banned anywhere in your output:");
    expect(PASS_ONE_SYSTEM_PROMPT).toContain("comprehensive overview");
    expect(PASS_ONE_SYSTEM_PROMPT).toContain("leveraging");
  });
});

/* ── Pass 2 system prompt ────────────────────────────────────────────── */

describe("PASS_TWO_SYSTEM_PROMPT", () => {
  it("does NOT mention 'pillar' as a generation instruction", () => {
    expect(/\bpillar\b/i.test(PASS_TWO_SYSTEM_PROMPT)).toBe(false);
  });

  it("instructs to PRESERVE source material wording, not invent", () => {
    expect(PASS_TWO_SYSTEM_PROMPT).toMatch(/Preserve the source material/);
    expect(PASS_TWO_SYSTEM_PROMPT).toMatch(/Do NOT invent new operational claims/);
  });

  it("requires the assembly output schema (title / faq / meta / body)", () => {
    expect(PASS_TWO_SYSTEM_PROMPT).toContain('"title"');
    expect(PASS_TWO_SYSTEM_PROMPT).toContain('"meta_title"');
    expect(PASS_TWO_SYSTEM_PROMPT).toContain('"faq"');
    expect(PASS_TWO_SYSTEM_PROMPT).toContain('"keyTakeaways"');
    expect(PASS_TWO_SYSTEM_PROMPT).toContain('"mainHtml"');
  });

  it("forbids explanatory section headings", () => {
    expect(PASS_TWO_SYSTEM_PROMPT).toMatch(/No section heading starting with "Understanding"/);
  });

  it("inherits the banned-phrase blocklist", () => {
    expect(PASS_TWO_SYSTEM_PROMPT).toContain("Hard-banned anywhere in your output:");
  });
});

/* ── Pass 1 user prompt ──────────────────────────────────────────────── */

describe("buildPassOneUserPrompt", () => {
  it("includes topic, locale, target keyword, context, notes", () => {
    const p = buildPassOneUserPrompt(ctx);
    expect(p).toContain("LOCALE: en-US");
    expect(p).toContain("TOPIC: Shopify chargebacks operations");
    expect(p).toContain("TARGET KEYWORD: Shopify chargebacks");
    expect(p).toContain("CONTEXT: End-to-end Shopify chargeback handling");
    expect(p).toContain("BRIEF NOTES");
    expect(p).toContain("audience");
  });

  it("instructs JSON only, no article", () => {
    const p = buildPassOneUserPrompt(ctx);
    expect(p).toMatch(/JSON only — no article/i);
    expect(p).toMatch(/Pass 1 schema/);
  });
});

/* ── Pass 2 user prompt ──────────────────────────────────────────────── */

describe("buildPassTwoUserPrompt", () => {
  it("embeds source material as authoritative input", () => {
    const p = buildPassTwoUserPrompt(ctx, validMaterial);
    expect(p).toContain("SOURCE MATERIAL");
    expect(p).toContain("Most lost disputes are operational losses");
    expect(p).toContain("Scattered evidence");
    expect(p).toContain("AVS Y on cardholder's billing address");
  });

  it("includes topic + context + locale", () => {
    const p = buildPassTwoUserPrompt(ctx, validMaterial);
    expect(p).toContain("TOPIC: Shopify chargebacks operations");
    expect(p).toContain("LOCALE: en-US");
  });

  it("instructs to preserve wording", () => {
    const p = buildPassTwoUserPrompt(ctx, validMaterial);
    expect(p).toMatch(/Preserve the source material/);
    expect(p).toMatch(/Do NOT invent new operational claims/);
  });
});

/* ── Pass 1 shape validator ──────────────────────────────────────────── */

describe("validatePassOneShape", () => {
  it("accepts a fully populated source material object", () => {
    expect(validatePassOneShape(validMaterial)).toBe(true);
  });

  it("rejects missing top-level keys", () => {
    const broken = { ...validMaterial } as Record<string, unknown>;
    delete broken.observations;
    expect(validatePassOneShape(broken)).toBe(false);
  });

  it("tolerates the legacy disputedesk_positioning_notes key during transition", () => {
    const legacyShape: Record<string, unknown> = {
      ...validMaterial,
      disputedesk_positioning_notes: validMaterial.positioning_constraints,
    };
    delete legacyShape.positioning_constraints;
    expect(validatePassOneShape(legacyShape)).toBe(true);
  });

  it("rejects non-array fields", () => {
    expect(validatePassOneShape({ ...validMaterial, observations: "not-array" })).toBe(false);
  });

  it("rejects null / non-object input", () => {
    expect(validatePassOneShape(null)).toBe(false);
    expect(validatePassOneShape(undefined)).toBe(false);
    expect(validatePassOneShape("string")).toBe(false);
    expect(validatePassOneShape(42)).toBe(false);
  });
});
