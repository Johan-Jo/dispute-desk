/**
 * JSON Schema for Anthropic structured outputs (`output_config.format`) used by
 * both the sync generation path (callClaudeChat) and the Message Batches path.
 *
 * Why this exists: Sonnet, asked to emit raw JSON via a prompt instruction, does
 * not reliably escape double-quotes that appear inside the article HTML (e.g.
 * sample lines like `<em>"The order was placed..."</em>`, field names like
 * `"Response deadline"`). That produced `JSON.parse` failures on long articles
 * — observed as 4/6 locales failing with "model returned non-JSON" even though
 * the model's content was complete and `stop_reason` was `end_turn`. The retry
 * loop used to mask this (3 attempts), but retries re-bill tokens.
 *
 * Structured outputs make the API itself guarantee schema-valid, properly-escaped
 * JSON — no prefill, no fragile string repair, no retries. Supported on
 * claude-sonnet-4-6, no beta header, works in the Batches API.
 *
 * Schema constraints (per Anthropic structured-outputs docs): every object must
 * set `additionalProperties: false`; numeric/string length constraints are NOT
 * supported (we use none). Shape matches GeneratedContent (generate.ts) and
 * RegenDraft (expandInPlace.ts).
 */
export const ARTICLE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    excerpt: { type: "string" },
    slug: { type: "string" },
    meta_title: { type: "string" },
    meta_description: { type: "string" },
    body_json: {
      type: "object",
      additionalProperties: false,
      properties: {
        mainHtml: { type: "string" },
        keyTakeaways: { type: "array", items: { type: "string" } },
        faq: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              q: { type: "string" },
              a: { type: "string" },
            },
            required: ["q", "a"],
          },
        },
        disclaimer: { type: "string" },
      },
      required: ["mainHtml", "keyTakeaways", "faq", "disclaimer"],
    },
  },
  required: ["title", "excerpt", "slug", "meta_title", "meta_description", "body_json"],
} as const;

/** The `output_config` value to attach to a Messages API request body for guaranteed JSON. */
export const ARTICLE_OUTPUT_CONFIG = {
  format: { type: "json_schema", schema: ARTICLE_JSON_SCHEMA },
} as const;
