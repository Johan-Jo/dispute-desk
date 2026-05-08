/**
 * Tier + archetype model for the resource generation pipeline.
 *
 * Tiers control the *length* of the article (target word range, ceiling, floor).
 * Archetypes control the *required structural commitments* injected into the
 * model prompt so each article gets a unique, archetype-appropriate originality
 * block — not the same generic anti-template lecture for every page.
 *
 * Both signals are optional overrides on `content_archive_items`
 * (`tier_override`, `archetype`). When absent, both are inferred from
 * `content_type` + `is_hub_article`.
 */

export type ContentTier = "A" | "B" | "C";

export type ContentArchetype =
  | "authority_pillar"
  | "merchant_playbook"
  | "evidence_deep_dive"
  | "regulatory_explainer"
  | "comparative_analysis"
  | "decision_framework"
  | "checklist_actionable"
  | "template_fillin"
  | "faq_qna"
  | "case_study"
  | "policy_implementation"
  | "tooling_overview"
  | "definition_glossary";

const ARCHETYPE_VALUES: ReadonlyArray<ContentArchetype> = [
  "authority_pillar",
  "merchant_playbook",
  "evidence_deep_dive",
  "regulatory_explainer",
  "comparative_analysis",
  "decision_framework",
  "checklist_actionable",
  "template_fillin",
  "faq_qna",
  "case_study",
  "policy_implementation",
  "tooling_overview",
  "definition_glossary",
];

export interface TierRange {
  /** Default min/max for the tier before complexity / intent adjustments. */
  base: readonly [number, number];
  /** Hard upper bound; the prompt will never ask for more than this. */
  ceiling: number;
  /** Hard lower bound; the prompt will never ask for less than this. */
  floor: number;
}

/**
 * Tier ranges per the resource-hub overhaul PRD.
 * Tier A is the dominant change vs the legacy MAX_CEILING=2600 — pillars
 * have to be allowed to reach genuine depth before the audit's "thin"
 * verdict can change.
 */
export const TIER_RANGES: Record<ContentTier, TierRange> = {
  A: { base: [3500, 5000], ceiling: 6000, floor: 3000 },
  B: { base: [1800, 2400], ceiling: 3000, floor: 1500 },
  C: { base: [1000, 1400], ceiling: 1800, floor: 800 },
};

export function inferTierFromContentType(
  contentType: string,
  isHubArticle?: boolean | null
): ContentTier {
  if (isHubArticle) return "A";
  const t = contentType.trim().toLowerCase();
  if (t === "pillar_page") return "A";
  if (t === "cluster_article" || t === "case_study" || t === "legal_update") return "B";
  return "C";
}

export function inferArchetypeFromContentType(
  contentType: string,
  isHubArticle?: boolean | null
): ContentArchetype {
  if (isHubArticle) return "authority_pillar";
  switch (contentType.trim().toLowerCase()) {
    case "pillar_page":
      return "authority_pillar";
    case "checklist":
      return "checklist_actionable";
    case "template":
      return "template_fillin";
    case "faq_entry":
      return "faq_qna";
    case "glossary_entry":
      return "definition_glossary";
    case "legal_update":
      return "regulatory_explainer";
    case "case_study":
      return "case_study";
    case "cluster_article":
    default:
      return "merchant_playbook";
  }
}

export function normalizeTier(raw: string | null | undefined): ContentTier | null {
  const s = raw?.trim().toUpperCase();
  if (s === "A" || s === "B" || s === "C") return s;
  return null;
}

export function normalizeArchetype(raw: string | null | undefined): ContentArchetype | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase() as ContentArchetype;
  return ARCHETYPE_VALUES.includes(s) ? s : null;
}

/**
 * Returns the tier-appropriate target range; honours an explicit override on the brief.
 * Centralising tier resolution here means the prompt builder and the validators
 * both see the same numbers.
 */
export function resolveTier(input: {
  tier?: string | null;
  contentType: string;
  isHubArticle?: boolean | null;
}): ContentTier {
  return normalizeTier(input.tier) ?? inferTierFromContentType(input.contentType, input.isHubArticle);
}

export function resolveArchetype(input: {
  archetype?: string | null;
  contentType: string;
  isHubArticle?: boolean | null;
}): ContentArchetype {
  return (
    normalizeArchetype(input.archetype) ??
    inferArchetypeFromContentType(input.contentType, input.isHubArticle)
  );
}

export interface ArchetypeRequirements {
  /** Originality block injected verbatim into the user prompt for this archetype. */
  originalityBlock: string;
  /**
   * Concrete must-have signals an article of this archetype needs to clear
   * the editorial bar. Surfaced into the prompt as a bullet list and
   * exposed to PR 3 validators for post-hoc checks.
   */
  mustHaves: string[];
}

export const ARCHETYPE_REQUIREMENTS: Record<ContentArchetype, ArchetypeRequirements> = {
  authority_pillar: {
    originalityBlock: `Authority Pillar (Tier A) — required structural commitments:
- Open with a specific operational fact about Shopify chargebacks within the first two paragraphs (e.g. response window, who decides, exact path inside Shopify Admin).
- Include at minimum:
  - One concrete merchant scenario walkthrough (name the dispute reason, dollar value, and outcome decision).
  - One section that names exact Shopify Admin paths, fields, or API/GraphQL identifiers.
  - One section explaining what counts as "Strong", "Moderate", and "Weak" evidence and why.
  - One section on edge cases or where rules vary by processor / region / Shopify Payments vs third-party gateway.
  - A "common mistakes that lose disputes" section with at least three concrete failure modes.
- Use a fresh, topic-specific opening — never start with "Chargebacks are a [growing/major] problem", "In today's ecommerce landscape", "Businesses of all sizes", or any variant.
- Mention sibling DisputeDesk topics in plain prose only — never as <a> tags.`,
    mustHaves: [
      "Mention 'Shopify' specifically in the first 200 words.",
      "Cite at least one Shopify Admin path, button label, or settings page by name.",
      "Include numbered or named sections with operational substance — not 'Introduction / Conclusion / FAQ' shells.",
    ],
  },
  merchant_playbook: {
    originalityBlock: `Merchant Playbook (operational walkthrough) — required commitments:
- The article must read as a step-by-step playbook a merchant could execute today.
- Open with "When this happens, do this" framing — not background context.
- Include at least one "Decision point" callout where the merchant must choose between two paths, with the consequences of each.
- Include sample copy/text the merchant can adapt (customer email line, evidence narrative line, internal note) — short, specific, never generic boilerplate.
- Avoid abstract paragraphs about "the importance of" anything.`,
    mustHaves: [
      "Use imperative-mood instructions in at least one section.",
      "Include at least one concrete sample of merchant-facing or evidence-facing text.",
      "Identify at least one explicit decision point with named consequences.",
    ],
  },
  evidence_deep_dive: {
    originalityBlock: `Evidence Deep-Dive — required commitments:
- Pick one evidence type (AVS, CVV, tracking, screenshot, IP, 3DS, signed contract, etc.) and stay on it.
- Specify the exact field name(s) where this evidence lives (Shopify field, transaction object property, GraphQL field, etc.).
- Show what a "Strong" version of this evidence looks like in concrete terms (sample value, sample structure, sample wording).
- Show what reduces this evidence from Strong to Moderate or Weak.
- Note which dispute reason families this evidence helps the most and which it does nothing for.`,
    mustHaves: [
      "Name the specific evidence field or property.",
      "Include at least one sample value or sample wording.",
      "Map the evidence to dispute reason families.",
    ],
  },
  regulatory_explainer: {
    originalityBlock: `Regulatory / Network Rule Explainer — required commitments:
- Cite the rule by its formal name (e.g. Visa CE 3.0, Mastercard Dispute Resolution Initiative) and effective date in the first section.
- State which networks / regions / merchant categories the rule applies to.
- Include a "What changed for merchants" section enumerating concrete operational impacts.
- Be candid where the rule's effect varies by processor or acquirer; never present as universal when it isn't.
- Never invent rule details, fees, or windows — if you are not sure, say the merchant should confirm with their processor.`,
    mustHaves: [
      "Name the rule and its effective date.",
      "List concrete operational impacts (not abstract benefits).",
    ],
  },
  comparative_analysis: {
    originalityBlock: `Comparative Analysis (X vs Y) — required commitments:
- Frame the article as a real choice the merchant has to make.
- Include a structured comparison covering at least: cost / time / outcome confidence / when each option applies.
- Recommend a default with rationale, then list the conditions under which the other option is better.
- Avoid "both are valuable" weasel framing.`,
    mustHaves: [
      "Include an explicit recommendation with reasoning.",
      "Include a structured comparison (table or parallel lists).",
    ],
  },
  decision_framework: {
    originalityBlock: `Decision Framework — required commitments:
- Present a small set of clear questions a merchant can answer to reach a decision.
- For each question, name the likely answers and what they imply.
- End with a decision summary (a flowchart described in prose, or a numbered decision list).`,
    mustHaves: [
      "Articulate explicit decision criteria.",
      "Include a summary decision rule the reader can apply.",
    ],
  },
  checklist_actionable: {
    originalityBlock: `Actionable Checklist — required commitments:
- Use numbered or bulleted operational steps; one action per step.
- Each step must be verifiable (the reader can check whether they did it).
- Include "Common mistakes" and "Revisit when…" sections.
- Avoid filler prose between steps.`,
    mustHaves: [
      "Each top-level step is independently verifiable.",
      "Include a 'Common mistakes' section.",
    ],
  },
  template_fillin: {
    originalityBlock: `Fill-in Template / Playbook — required commitments:
- Provide ready-to-use structure with placeholders in [BRACKETS] the merchant replaces.
- Cover: Overview / When to use / Step-by-step / Fill-in template body.
- Make the placeholder names self-explanatory ([CUSTOMER FIRST NAME], not [VAR1]).
- Show one fully filled example below the template.`,
    mustHaves: [
      "Use [BRACKETED] placeholders with descriptive names.",
      "Show one filled example.",
    ],
  },
  faq_qna: {
    originalityBlock: `FAQ Q&A — required commitments:
- 5–8 question/answer pairs.
- Questions must be phrased the way a real merchant would type them, not the way a marketer would.
- Each answer is 2–4 sentences, concrete, and ideally references where in Shopify Admin / Shopify Payments the action happens.
- Avoid Q&A pairs whose answer is "It depends." — give the most common answer and note the exception explicitly.`,
    mustHaves: [
      "Between 5 and 8 Q&A pairs.",
      "Each answer is concrete and 2–4 sentences.",
    ],
  },
  case_study: {
    originalityBlock: `Case Study — required commitments:
- Anonymize the merchant. Use a plausible store profile (vertical, AOV, dispute volume).
- Walk the timeline: trigger → response → outcome.
- Name the specific evidence used and why it mattered.
- Note what would have happened if a different decision had been made.
- Never invent a real merchant or imply a real outcome you don't know.`,
    mustHaves: [
      "Anonymized store profile (vertical, AOV).",
      "Specific evidence types named.",
    ],
  },
  policy_implementation: {
    originalityBlock: `Policy Implementation — required commitments:
- Specify exactly which Shopify Admin pages or fields hold each policy element.
- Provide ready-to-paste copy snippets the merchant can adapt.
- Note compliance implications (consumer-protection regulation, card network requirements).
- Include a "How to verify it's saved correctly" check.`,
    mustHaves: [
      "Reference specific Shopify Admin paths.",
      "Include copy snippets the merchant can adapt.",
    ],
  },
  tooling_overview: {
    originalityBlock: `Tooling Overview — required commitments:
- For each tool: what it does, when it helps, when it doesn't, what it costs (qualitatively if exact pricing is unstable).
- Be candid about overlap with native Shopify capabilities.
- Don't rank by hype; rank by operational fit.
- Disclose DisputeDesk's product role honestly without turning the article into a sales page.`,
    mustHaves: [
      "Honest overlap analysis with native Shopify capabilities.",
      "Operational-fit rationale for each tool.",
    ],
  },
  definition_glossary: {
    originalityBlock: `Definition / Glossary — required commitments:
- Lead with a one-sentence plain-language definition.
- Follow with: how it appears in Shopify, why merchants encounter it, related terms, an example.
- Avoid circular definitions ("a chargeback is when a chargeback happens").`,
    mustHaves: [
      "One-sentence plain-language definition.",
      "Concrete example.",
    ],
  },
};

/** Minimum word count an article of this tier must reach to clear the editorial bar (PR 3 validator). */
export function tierMinimumWords(tier: ContentTier): number {
  return TIER_RANGES[tier].floor;
}

/** Maximum the prompt will ever ask for, regardless of complexity / intent uplifts. */
export function tierMaximumWords(tier: ContentTier): number {
  return TIER_RANGES[tier].ceiling;
}
