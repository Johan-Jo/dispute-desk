/**
 * The dispute's frame: who decides it, and at what stage (letter-structure
 * plan §4, docs/plans/defence-letter-structure.plan.md).
 *
 * A PayPal inquiry is not a chargeback and PayPal is not a card network: the
 * Mein Maison #101111 letter (2026-09-28) said "chargeback" and asked for a
 * "reversal of the chargeback" on a PayPal inquiry. Every word in a letter
 * that names the process — the page title, the request, the claim sentence —
 * comes from here.
 */

export type DisputeProvider = "card" | "paypal" | "klarna" | "other";
export type DisputeStage = "chargeback" | "inquiry";

export interface DisputeFrame {
  provider: DisputeProvider;
  /** "PayPal", "Klarna"; null for card disputes. */
  providerName: string | null;
  stage: DisputeStage;
}

export function disputeFrame(args: {
  paymentFamily: string | null | undefined;
  paymentLabel?: string | null;
  phase: string | null | undefined;
}): DisputeFrame {
  const family = (args.paymentFamily ?? "").toLowerCase();
  const provider: DisputeProvider =
    family === "paypal" ? "paypal" : family === "klarna" ? "klarna" : family === "card" || family === "wallet" || family === "" ? "card" : "other";
  const providerName =
    provider === "paypal" ? "PayPal" : provider === "klarna" ? "Klarna" : provider === "other" ? args.paymentLabel?.trim() || null : null;
  const stage: DisputeStage = (args.phase ?? "").toLowerCase() === "inquiry" ? "inquiry" : "chargeback";
  return { provider, providerName, stage };
}

/** The page's running title and eyebrow. */
export function responseTitle(f: DisputeFrame): string {
  if (f.provider !== "card") return "Dispute response";
  return f.stage === "inquiry" ? "Inquiry response" : "Chargeback response";
}

/** What the letter calls the proceeding in running prose. */
export function proceedingNoun(f: DisputeFrame): string {
  if (f.provider !== "card") return "dispute";
  return f.stage === "inquiry" ? "inquiry" : "chargeback";
}

/** The one request, printed after the conclusion and ending the summary. */
export function requestLine(f: DisputeFrame): string {
  if (f.provider === "card") {
    return f.stage === "inquiry"
      ? "The merchant respectfully requests that this inquiry be closed in its favour."
      : "The merchant respectfully requests reversal of the chargeback.";
  }
  const who = f.providerName ?? "the payment provider";
  return `The merchant respectfully requests that ${who} close this dispute in the merchant's favour.`;
}

/** The summary's closing request must match this. */
export function requestPattern(f: DisputeFrame): RegExp {
  return f.provider === "card" && f.stage === "chargeback" ? /\brevers/i : /\bclose[sd]?\b.{0,60}\bfavou?r\b/i;
}

/** Words that misname the proceeding for this frame. */
export function wrongFrameWords(f: DisputeFrame): RegExp | null {
  if (f.provider !== "card") return /\b(?:chargebacks?|cardholders?|card issuers?|issuing bank|issuers?|card networks?|Visa|Mastercard|reason code)\b/i;
  if (f.stage === "inquiry") return /\bchargebacks?\b/i;
  return null;
}

/** The instruction the summary writer gets about naming. */
export function frameRule(f: DisputeFrame): string {
  const request = requestLine(f).replace(/^The merchant respectfully /, "The merchant ");
  if (f.provider !== "card") {
    const who = f.providerName ?? "the payment provider";
    return (
      `This is a ${who} dispute, decided by ${who}; it is not a card chargeback. Call it "the dispute", the person "the customer". ` +
      `Never write "chargeback", "cardholder", "issuer", "card network", "Visa", "Mastercard" or "reason code". End with: "${request}"`
    );
  }
  if (f.stage === "inquiry") {
    return `This is an inquiry, not yet a chargeback. Call it "the inquiry"; never "chargeback". End with: "${request}"`;
  }
  return `This is a card chargeback. End with: "${request}"`;
}
