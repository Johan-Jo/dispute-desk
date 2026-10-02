/**
 * The store's return window, extracted from its published refund policy
 * (docs/plans/defence-letter-structure.plan.md §2.2.1; D9 decided by
 * provider 2026-09-28: used for card and PayPal).
 *
 * A model reads the policy (any of six languages) into a fixed schema, and
 * code verifies it: the sentence it quotes must be in the policy text, the
 * window's number must be in that sentence, and the sentence must say the
 * window runs from delivery. Anything unverified builds no claim.
 */

import { parseJson } from "../modelJson";

export interface ReturnWindow {
  windowDays: number;
  /** The policy sentence the window was read from (original language). */
  sourceSentence: string;
}

export type ModelText = (system: string, user: string) => Promise<string>;

export const RETURN_WINDOW_SYSTEM = `You read a shop's refund or return policy. Return JSON only:
{ "returnsOffered": true|false, "windowDays": number|null, "windowStartsAt": "delivery"|"order"|"unclear", "sourceSentence": "the one sentence of the policy, copied exactly, that states the return window" }
Copy the sentence character for character from the policy, in its original language. If the policy states no return window, return windowDays null.`;

/** Words that tie a return window to delivery, in the six active locales. */
const DELIVERY_WORDS = /\b(?:deliver(?:y|ed)|receiv(?:e|ed|ing)|receipt)\b|lieferung|geliefert|erhalt|empfang|livraison|réception|entrega|recepción|recebimento|leverans|mottag/i;

const norm = (t: string) => t.replace(/\s+/g, " ").trim();

export function verifyReturnWindow(policyText: string, extracted: unknown): ReturnWindow | null {
  const e = (extracted && typeof extracted === "object" ? extracted : {}) as Record<string, unknown>;
  if (e.returnsOffered !== true || e.windowStartsAt !== "delivery") return null;
  const days = Number(e.windowDays);
  const sentence = typeof e.sourceSentence === "string" ? norm(e.sourceSentence) : "";
  if (!Number.isInteger(days) || days <= 0 || days > 365 || sentence.length < 10) return null;
  if (!norm(policyText).includes(sentence)) return null;
  if (!new RegExp(`\\b${days}\\b`).test(sentence)) return null;
  if (!DELIVERY_WORDS.test(sentence)) return null;
  return { windowDays: days, sourceSentence: sentence };
}

export async function extractReturnWindow(policyText: string, model: ModelText): Promise<ReturnWindow | null> {
  const raw = await model(RETURN_WINDOW_SYSTEM, policyText.slice(0, 10_000));
  try {
    return verifyReturnWindow(policyText, parseJson<unknown>(raw));
  } catch {
    return null;
  }
}
