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
  central_argument:
    "Most lost Shopify chargebacks are operational losses, not evidence losses — issuers care about the assembly, not the data.",
  primary_operational_sequence: [
    {
      step: "New dispute appears in Settings → Payments → Manage in Shopify Admin",
      what_can_go_wrong:
        "Merchant doesn't see the dispute for 12+ hours; staff with insufficient permissions can't open it.",
      why_it_matters:
        "The 10-day response window starts ticking on Shopify Payments' clock, not when the merchant notices.",
      merchant_action:
        "Set up dispute notifications and assign Manage Orders permissions before disputes hit.",
    },
    {
      step: "Evidence assembly across Gorgias / Zendesk / carrier portal / Shopify Admin notes",
      what_can_go_wrong:
        "Tracking number is in Shippo; signature confirmation lives in FedEx; customer thread is in Gorgias.",
      why_it_matters: "Late assembly means evidence arrives after the response is filed.",
      merchant_action: "Centralize all evidence into the dispute pack before day 5.",
    },
  ],
  evidence_tensions: [
    {
      tension:
        "AVS Y looks strong but does not prove the cardholder personally received the order",
      strong_side:
        "AVS Y on the cardholder's billing address shown in the Order's payment summary proves the billing identity matched at authorization. Issuers see this as a baseline authentication signal.",
      weak_side:
        "AVS Y proves nothing about possession of the goods. In high-AOV physical-goods fraud, issuers regularly rule against merchants whose only fraud-defense is AVS — they want delivery proof tied to the cardholder, not to a billing match.",
      how_to_frame_it:
        "Cite AVS Y alongside delivery confirmation and IP geolocation; never as a standalone fraud defense.",
    },
  ],
  developed_scenarios: [
    {
      scenario:
        "Beauty brand, $90 AOV, $189 fraud chargeback (10.4 unauthorized) on a 3-item order",
      timeline: [
        "Day 0: order placed at 11:42pm, AVS Y, CVV Y, IP from cardholder city",
        "Day 2: shipped via FedEx Ground, signature required",
        "Day 4: delivered, signed by 'M. ROOMER' (cardholder is M. ROOMERS)",
        "Day 19: chargeback filed, reason 10.4 unauthorized",
      ],
      evidence_available: [
        "AVS Y match",
        "CVV Y match",
        "IP geolocation matching billing city",
        "FedEx tracking + signature",
      ],
      why_the_case_is_vulnerable:
        "The signature is one letter off from the cardholder name. Issuers reading 'signed by another party' default to rejection in unauthorized-use cases. AVS Y doesn't compensate; the issuer focuses on possession.",
      better_response:
        "Include a written narrative explicitly addressing the signature variance (typo on FedEx side; same address; proof of cardholder presence via subsequent purchases or login activity).",
    },
  ],
  inline_variance_constraints: [
    "Shopify Payments shows AVS in the Order's payment summary; Stripe surfaces it differently in the Dashboard.",
    "Visa and Mastercard may weigh AVS differently depending on processor routing — confirm with your processor.",
  ],
  positioning_constraints: [
    "DisputeDesk pack assembly handles fragmented evidence consolidation; merchants still own high-risk review.",
    "Automation improves consistency, not certainty.",
  ],
};

/* ── Pass 1 system prompt ────────────────────────────────────────────── */

describe("PASS_ONE_SYSTEM_PROMPT", () => {
  it("does NOT mention 'pillar' / 'guide' / 'complete' / 'comprehensive overview'", () => {
    const p = PASS_ONE_SYSTEM_PROMPT;
    expect(/\bpillar\b/i.test(p)).toBe(false);
    expect(p).toContain("NOT blog articles, guides");
    expect(p).not.toContain("complete guide");
    expect(p.toLowerCase()).not.toContain("authority pillar");
  });

  it("forbids article packaging in Pass 1 output", () => {
    expect(PASS_ONE_SYSTEM_PROMPT).toMatch(/NOT writing article sections/i);
  });

  it("requires the new deeper source-material schema", () => {
    expect(PASS_ONE_SYSTEM_PROMPT).toContain('"central_argument"');
    expect(PASS_ONE_SYSTEM_PROMPT).toContain('"primary_operational_sequence"');
    expect(PASS_ONE_SYSTEM_PROMPT).toContain('"evidence_tensions"');
    expect(PASS_ONE_SYSTEM_PROMPT).toContain('"developed_scenarios"');
    expect(PASS_ONE_SYSTEM_PROMPT).toContain('"inline_variance_constraints"');
    expect(PASS_ONE_SYSTEM_PROMPT).toContain('"positioning_constraints"');
    // Old shallow-bullet schema fields should be gone:
    expect(PASS_ONE_SYSTEM_PROMPT).not.toContain('"observations"');
    expect(PASS_ONE_SYSTEM_PROMPT).not.toContain('"failure_modes"');
    expect(PASS_ONE_SYSTEM_PROMPT).not.toContain('"messy_examples"');
    expect(PASS_ONE_SYSTEM_PROMPT).not.toContain('"evidence_hierarchy"');
    expect(PASS_ONE_SYSTEM_PROMPT).not.toContain('"shopify_workflow_notes"');
    expect(PASS_ONE_SYSTEM_PROMPT).not.toContain('"variance_constraints"');
  });

  it("inherits the banned-phrase blocklist from the voice core", () => {
    expect(PASS_ONE_SYSTEM_PROMPT).toContain("Hard-banned anywhere in your output:");
    expect(PASS_ONE_SYSTEM_PROMPT).toContain("comprehensive overview");
    expect(PASS_ONE_SYSTEM_PROMPT).toContain("leveraging");
  });

  it("instructs to prefer fewer richer entries over many shallow bullets", () => {
    expect(PASS_ONE_SYSTEM_PROMPT).toMatch(/FEWER, RICHER entries/);
    expect(PASS_ONE_SYSTEM_PROMPT).toMatch(/150–250 words/);
  });
});

/* ── Pass 2 system prompt ────────────────────────────────────────────── */

describe("PASS_TWO_SYSTEM_PROMPT", () => {
  it("does NOT mention 'pillar' as a generation instruction", () => {
    expect(/\bpillar\b/i.test(PASS_TWO_SYSTEM_PROMPT)).toBe(false);
  });

  it("instructs to PRESERVE source material wording, not invent", () => {
    expect(PASS_TWO_SYSTEM_PROMPT).toMatch(/Preserve.*source.material.wording/i);
    expect(PASS_TWO_SYSTEM_PROMPT).toMatch(/Do NOT invent new operational claims/);
  });

  it("requires the assembly output schema (title / faq / meta / body)", () => {
    expect(PASS_TWO_SYSTEM_PROMPT).toContain('"title"');
    expect(PASS_TWO_SYSTEM_PROMPT).toContain('"meta_title"');
    expect(PASS_TWO_SYSTEM_PROMPT).toContain('"faq"');
    expect(PASS_TWO_SYSTEM_PROMPT).toContain('"keyTakeaways"');
    expect(PASS_TWO_SYSTEM_PROMPT).toContain('"mainHtml"');
  });

  it("caps section count at 3-5 and requires multi-paragraph development", () => {
    expect(PASS_TWO_SYSTEM_PROMPT).toMatch(/3–5 SECTIONS/);
    expect(PASS_TWO_SYSTEM_PROMPT).toMatch(/develop a scenario across MULTIPLE paragraphs/);
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

  it("instructs JSON only and points at deep-source-material framing", () => {
    const p = buildPassOneUserPrompt(ctx);
    expect(p).toMatch(/JSON only — no article/i);
    expect(p).toMatch(/DEEP source material/);
  });
});

/* ── Pass 2 user prompt ──────────────────────────────────────────────── */

describe("buildPassTwoUserPrompt", () => {
  it("embeds source material as authoritative input", () => {
    const p = buildPassTwoUserPrompt(ctx, validMaterial);
    expect(p).toContain("SOURCE MATERIAL");
    expect(p).toContain(validMaterial.central_argument);
    expect(p).toContain(validMaterial.developed_scenarios[0].scenario);
  });

  it("includes topic + context + locale", () => {
    const p = buildPassTwoUserPrompt(ctx, validMaterial);
    expect(p).toContain("TOPIC: Shopify chargebacks operations");
    expect(p).toContain("LOCALE: en-US");
  });

  it("instructs to preserve wording and cap at 3–5 sections", () => {
    const p = buildPassTwoUserPrompt(ctx, validMaterial);
    expect(p).toMatch(/Preserve the source material's wording/);
    expect(p).toMatch(/Do NOT invent new operational claims/);
    expect(p).toMatch(/3–5 sections only/);
  });
});

/* ── Pass 1 shape validator ──────────────────────────────────────────── */

describe("validatePassOneShape", () => {
  it("accepts a fully populated source material object", () => {
    expect(validatePassOneShape(validMaterial)).toBe(true);
  });

  it("rejects missing top-level keys", () => {
    const broken = { ...validMaterial } as Record<string, unknown>;
    delete broken.central_argument;
    expect(validatePassOneShape(broken)).toBe(false);
  });

  it("tolerates the legacy v1 schema (observations + failure_modes) during transition", () => {
    const legacyShape: Record<string, unknown> = {
      observations: ["string"],
      failure_modes: [{}],
      messy_examples: [{}],
      evidence_hierarchy: [{}],
      shopify_workflow_notes: ["x"],
      variance_constraints: ["x"],
      positioning_constraints: ["x"],
    };
    expect(validatePassOneShape(legacyShape)).toBe(true);
  });

  it("rejects non-array fields in the new schema", () => {
    expect(
      validatePassOneShape({ ...validMaterial, evidence_tensions: "not-array" })
    ).toBe(false);
  });

  it("rejects null / non-object input", () => {
    expect(validatePassOneShape(null)).toBe(false);
    expect(validatePassOneShape(undefined)).toBe(false);
    expect(validatePassOneShape("string")).toBe(false);
    expect(validatePassOneShape(42)).toBe(false);
  });
});
