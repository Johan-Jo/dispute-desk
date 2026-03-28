/**
 * Canonical resource hub pillars — must match `content_items.primary_pillar` CHECK
 * and marketing routes under `/resources/[pillar]/...`.
 */

export const RESOURCE_HUB_PILLARS = [
  "chargebacks",
  "dispute-resolution",
  "small-claims",
  "mediation-arbitration",
  "dispute-management-software",
] as const;

export type ResourceHubPillar = (typeof RESOURCE_HUB_PILLARS)[number];

const PILLAR_SET = new Set<string>(RESOURCE_HUB_PILLARS);

export function isResourceHubPillar(value: string): value is ResourceHubPillar {
  return PILLAR_SET.has(value);
}

/**
 * Normalize archive/editor input to a valid pillar slug, or null.
 * Handles trim, lowercase, hyphenation, and common aliases.
 */
export function normalizeResourceHubPillar(
  raw: string | null | undefined
): ResourceHubPillar | null {
  if (raw == null || typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase().replace(/\s+/g, "-");
  if (isResourceHubPillar(t)) return t;

  const aliases: Record<string, ResourceHubPillar> = {
    chargeback: "chargebacks",
    "small-claim": "small-claims",
    mediation: "mediation-arbitration",
    arbitration: "mediation-arbitration",
    adr: "mediation-arbitration",
    software: "dispute-management-software",
    saas: "dispute-management-software",
  };
  return aliases[t] ?? null;
}

/** Ordered rules: first match wins (more specific patterns first). */
const KEYWORD_RULES: Array<{ re: RegExp; pillar: ResourceHubPillar }> = [
  {
    re: /chargeback|representment|issuer|dispute\s*response\s*time|card\s*network/i,
    pillar: "chargebacks",
  },
  {
    re: /online\s*dispute\s*resolution|\bodr\b|dispute\s*resolution(?!.*software)/i,
    pillar: "dispute-resolution",
  },
  { re: /small\s*claims|small\s*claim|county\s*court/i, pillar: "small-claims" },
  { re: /mediation|arbitration|\badr\b/i, pillar: "mediation-arbitration" },
  {
    re: /dispute\s*management\s*software|case\s*management\s*platform/i,
    pillar: "dispute-management-software",
  },
];

export function inferResourceHubPillarFromText(text: string): ResourceHubPillar | null {
  const s = text.slice(0, 8000);
  for (const { re, pillar } of KEYWORD_RULES) {
    if (re.test(s)) return pillar;
  }
  return null;
}

/**
 * Resolves a pillar for AI generation inserts. Never returns null — uses inference
 * or a safe default so public URLs always have a valid first segment.
 */
export function resolvePrimaryPillarForGeneration(brief: {
  primaryPillar: string;
  proposedTitle?: string | null;
  targetKeyword?: string | null;
  summary?: string | null;
}): ResourceHubPillar {
  const n = normalizeResourceHubPillar(brief.primaryPillar);
  if (n) return n;

  const corpus = [brief.proposedTitle, brief.targetKeyword, brief.summary]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join("\n");
  const inferred = inferResourceHubPillarFromText(corpus);
  if (inferred) {
    console.warn(
      "[resources] primary_pillar inferred from archive text; update archive row:",
      { raw: brief.primaryPillar, resolved: inferred }
    );
    return inferred;
  }

  console.error(
    "[resources] Unrecognized primary_pillar; defaulting to chargebacks. Update archive:",
    brief.primaryPillar
  );
  return "chargebacks";
}
