/**
 * Shared ingest-time gates used by every SignalSourceAdapter.
 *
 * Three gates, applied in order:
 *   1. AutoModerator / bot signature filter — drops automod removal text,
 *      "[deleted]"/"[removed]" placeholders, "I am a bot" templates, etc.
 *   2. Shopify-context gate — text must explicitly mention Shopify, OR the
 *      adapter must declare its content as implicit-Shopify (the Shopify
 *      Community forum, the official Shopify subreddit). Without this,
 *      generic ecommerce chatter from agnostic communities slips through.
 *   3. Shopify-pain gate — text must mention at least one of: chargeback,
 *      dispute, reserve, payout, fraud-tooling, AVS/CVV/3DS, INR, or one
 *      of the named Shopify-ecosystem competitors (Chargeflow, Disputifier,
 *      etc.). Without this, generic Shopify operational chat (sales tips,
 *      shipping logistics) fills the dashboard.
 *
 * Adapters that pull from a domain that is implicitly Shopify-context
 * (community.shopify.com; r/shopify) skip gate 2 by passing the source's
 * `implicitShopifyContext` flag. Adapters that pull from mixed-context
 * sources (Reddit search across all subs, r/ecommerce) must apply gate 2.
 */

const AUTOMOD_PATTERNS: RegExp[] = [
  /this action was performed automatically/i,
  /please contact the moderators of (this|the) subreddit/i,
  /your (post|submission|comment) has been (automatically )?removed/i,
  /you (don'?t|do not) have enough (karma|post karma|comment karma)/i,
  /^\s*\[removed\]\s*$/i,
  /^\s*\[deleted\]\s*$/i,
  /i am a bot/i,
  /this is an automated/i,
];

export const BOT_AUTHORS = new Set<string>([
  "AutoModerator",
  "automoderator",
  "[deleted]",
  "RemindMeBot",
]);

export function looksLikeAutomod(text: string): boolean {
  if (!text) return false;
  return AUTOMOD_PATTERNS.some((re) => re.test(text));
}

const SHOPIFY_PAIN_TERMS: RegExp[] = [
  // Disputes / chargebacks
  /\bchargeback(s|ed|ing)?\b/i,
  /\bcharge[- ]back(s|ed|ing)?\b/i,
  /\bdispute(s|d|ing)?\b/i,
  /\brepresentment\b/i,
  /\bfriendly[- ]?fraud\b/i,
  /\binquiry\b/i,
  /\bretrieval\b/i,
  // Shopify Payments mechanics
  /\b(shopify[- ]?)?payouts?\b/i,
  /\b(rolling[- ])?reserve(s)?\b/i,
  /\bfunds (held|frozen|on hold)\b/i,
  /\bhigh[- ]?risk\b/i,
  /\bpayout (hold|frozen|delayed)\b/i,
  /\bshopify protect\b/i,
  // Evidence / representment vocabulary
  /\bevidence pack\b/i,
  /\bavs\b/i,
  /\bcvv\b/i,
  /\b3[- ]?d[- ]?secure\b/i,
  /\b3ds\b/i,
  /\bissuer (rejected|won|lost)\b/i,
  // INR / fulfillment
  /\bitem not received\b/i,
  /\bINR\b/,
  /\bproduct not received\b/i,
  /\bnot as described\b/i,
  // Competitor mentions
  /\bchargeflow\b/i,
  /\bdisputifier\b/i,
  /\bchargepay\b/i,
  /\bjustt\b/i,
  /\bmidigator\b/i,
  /\bsignifyd\b/i,
  /\briskified\b/i,
  /\bnofraud\b/i,
  // Generic dispute-tooling intent
  /\bchargeback (app|tool|software|service|management|prevention|automation)\b/i,
  /\bfraud (prevention|detection|filter)\b/i,
  /\bdispute (app|tool|software|service|management)\b/i,
];

export function passesShopifyPainGate(text: string): boolean {
  if (!text) return false;
  return SHOPIFY_PAIN_TERMS.some((re) => re.test(text));
}

const SHOPIFY_LITERAL = /\bshopify\b/i;

/**
 * Shopify-context gate. Pass the source's implicitContext flag to skip the
 * literal check (e.g. r/shopify subreddit, community.shopify.com forum).
 */
export function isShopifyContext(
  text: string,
  implicitContext: boolean
): boolean {
  if (implicitContext) return true;
  return SHOPIFY_LITERAL.test(text);
}

/**
 * One-stop combined gate. Returns the reason text was rejected, or null if it passes.
 * Used by adapter mapItem functions to keep filtering logic uniform.
 */
export type GateRejection =
  | "bot_author"
  | "automod_text"
  | "empty_content"
  | "off_topic_shopify"
  | "off_topic_pain";

export interface GateInput {
  author: string | null;
  title: string | null;
  content: string;
  /** True for sources that are implicitly Shopify (community.shopify.com, r/shopify). */
  implicitShopifyContext: boolean;
}

export function applyIngestGates(input: GateInput): GateRejection | null {
  const { author, title, content, implicitShopifyContext } = input;
  if (author && BOT_AUTHORS.has(author)) return "bot_author";
  if (looksLikeAutomod(title ?? "")) return "automod_text";
  if (looksLikeAutomod(content)) return "automod_text";

  const trimmed = content.trim();
  if (!title && trimmed.length < 4) return "empty_content";
  if (title === null && trimmed.length < 4) return "empty_content";

  const blob = `${title ?? ""}\n${content}`;
  if (!isShopifyContext(blob, implicitShopifyContext)) return "off_topic_shopify";
  if (!passesShopifyPainGate(blob)) return "off_topic_pain";

  return null;
}
