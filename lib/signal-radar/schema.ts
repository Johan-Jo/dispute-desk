import { z } from "zod";

export const SIGNAL_CATEGORIES = [
  "migration_intent",
  "transparency_frustration",
  "operational_overload",
  "reserve_fear",
  "evidence_confusion",
  "support_failure",
  "competitor_frustration",
  "general_discussion",
  "spam",
  "trolling",
] as const;

export const MERCHANT_TYPES = [
  "dropshipping",
  "digital_goods",
  "subscription",
  "high_ticket_physical",
  "pod",
  "supplements",
  "unknown",
] as const;

export const MERCHANT_STAGES = [
  "small",
  "scaling",
  "distressed",
  "high_risk",
  "unknown",
] as const;

export const COMPETITORS = [
  "chargeflow",
  "disputifier",
  "chargepay",
  "justt",
  "midigator",
  "signifyd",
  "riskified",
  "nofraud",
] as const;

export const SignalAnalysisSchema = z.object({
  merchant_relevance: z.boolean(),
  frustration_score: z.number().int().min(0).max(10),
  emotional_intensity_score: z.number().int().min(0).max(10),
  signal_score: z.number().int().min(0).max(10),
  source_confidence_score: z.number().int().min(0).max(10),
  category: z.enum(SIGNAL_CATEGORIES),
  competitor: z.enum(COMPETITORS).nullable(),
  merchant_stage: z.enum(MERCHANT_STAGES),
  merchant_type: z.enum(MERCHANT_TYPES),
  merchant_scale_signals: z.array(z.string().max(60)).max(6),
  suggested_angle: z.string().nullable(),
  why_this_matters: z.string().min(1),
  summary: z.string().min(1),
});

export type SignalAnalysisOutput = z.infer<typeof SignalAnalysisSchema>;

export const SIGNAL_ANALYSIS_JSON_SCHEMA = {
  name: "signal_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "merchant_relevance",
      "frustration_score",
      "emotional_intensity_score",
      "signal_score",
      "source_confidence_score",
      "category",
      "competitor",
      "merchant_stage",
      "merchant_type",
      "merchant_scale_signals",
      "suggested_angle",
      "why_this_matters",
      "summary",
    ],
    properties: {
      merchant_relevance: { type: "boolean" },
      frustration_score: { type: "integer", minimum: 0, maximum: 10 },
      emotional_intensity_score: { type: "integer", minimum: 0, maximum: 10 },
      signal_score: { type: "integer", minimum: 0, maximum: 10 },
      source_confidence_score: { type: "integer", minimum: 0, maximum: 10 },
      category: { type: "string", enum: [...SIGNAL_CATEGORIES] },
      competitor: {
        type: ["string", "null"],
        enum: [...COMPETITORS, null],
      },
      merchant_stage: { type: "string", enum: [...MERCHANT_STAGES] },
      merchant_type: { type: "string", enum: [...MERCHANT_TYPES] },
      merchant_scale_signals: {
        type: "array",
        maxItems: 6,
        items: { type: "string", maxLength: 60 },
      },
      suggested_angle: { type: ["string", "null"] },
      why_this_matters: { type: "string", minLength: 1 },
      summary: { type: "string", minLength: 1 },
    },
  },
} as const;
