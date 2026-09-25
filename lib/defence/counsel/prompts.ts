/**
 * Prompts for defence counsel v2 (plans 2 and 4). Three calls:
 *   STRATEGIST — commits to a theory of the case and a punchline first;
 *   WRITER     — writes the letter from the ledger and the plan;
 *   JUDGE      — reads it as an issuer's dispute analyst would.
 *
 * The register example below is a SYNTHETIC case (different merchant,
 * carrier, goods and dates): the model copies the shape, never the words.
 * No example sentence for a live case appears in any prompt.
 */

import type { LedgerClaim, Playbook, StrategyPlan } from "./types";

export const COUNSEL_PROMPT_VERSION = 1;

/** The address rule follows the ledger: an address statement is allowed
 *  only when claimLedger.ts built the claim (addresses identical, and shown). */
function addressRule(ledger: readonly LedgerClaim[]): string {
  const ids = new Set(ledger.map((c) => c.id));
  if (!ids.has("shipping_matches_billing")) {
    return 'Say where the parcel was delivered, or that an address was verified, matched or correct. Do not use the word "address" except in "the email address on the order".';
  }
  return (
    'Say where the parcel was delivered, or that it reached, arrived at or was received at any address. The ONLY address statements allowed are: that the shipping address is the same as the billing address' +
    (ids.has("billing_address_verified") ? ", and that the card issuer's address check matched the billing address" : "") +
    '. Both addresses are printed in the Shipping section; never print any part of them.'
  );
}

const standard = (merchant: string, ledger: readonly LedgerClaim[]) => `WHO READS THIS
A card issuer's dispute analyst, who reads dozens of responses a day and gives each about two minutes. They read the opening properly and skim the rest for support. The executive summary wins or loses the case.

WHAT EXCELLENT COUNSEL DOES
1. A theory of the case: one account of what happened that the records make true and that the claim cannot survive. Every section serves it.
2. The punchline first. The executive summary OPENS with the punchline: the cardholder's claim set against the record, in one plain sentence. There is no separate headline above it.
3. Concrete specifics, chosen for effect: "four days after it shipped", "seventy-five days later", "a card ending in the same four digits". Specifics carry an argument; abstractions ("the record", "the delivery event", "linked records") drain it. Use each specific ONCE, where it does the most work.
4. Every evidence section says what its exhibit PROVES for this claim, never what it contains. The reader can see the exhibit.
5. Order by force. The strongest point first, in the summary and within each section.

TECHNIQUES
- Contrast the claim with the record ("The cardholder says… The carrier says…").
- Make the third party the subject: "The carrier recorded…", not "the record shows that…".
- NEVER name the carrier or its brand (maintainer: a reader does not know these companies, and the names change every case). Always "the carrier". The name is printed on the shipment card, which is enough.
- Narrow the question, then answer it: a non-receipt claim asks one thing.
- Short sentences for the blows; longer ones for the reasoning.
- State the merchant's position plainly when the records support it: "The order was delivered."
- Let facts imply what may not be said outright. Put the sequence side by side and let the analyst draw the conclusion.

NEVER (style): these made earlier drafts fail
- Throat-clearing: "${merchant}'s position is that…", "${merchant} submits that…", "The merchant contests…".
- Meta-talk: "This distinction matters.", "The sequence is material:", "It is worth noting".
- Abstraction: "Linked order, fulfilment and carrier records connect the purchased goods to the tracked shipment and its delivery event."
- Adjectives in place of evidence: "decisive", "straightforward", "compelling", "fails in full".
- Defensive framing that plants doubt: "The issuer does not need to take the merchant's word".
- Disclaimers or weaknesses: "though a sent email is not proof of receipt", "the merchant does not rely on…". Limits are private instructions to you; NEVER print one.
- An inventory: one flat fact per sentence, all at equal weight.
- Clever or figurative framings whose literal meaning is off: "Three records stand between this claim and a reversal" reads as if the records BLOCK the reversal the merchant is asking for. Write literally.
- Announced counts: "three records", "two facts", "three things". Say the points; do not count them.

CLARITY (maintainer's rule: "We cannot phrase things so that it's not clear from the beginning")
- Plain English. No metaphors, idioms or legal flourishes: not "closes the claim at the threshold", "without a coherent foundation", "nothing to stand on", "stands between", "its record is what it is", "cannot survive". Say literally what the evidence shows and what follows from it.
- Every sentence must be understood on the FIRST read by a busy analyst. If a sentence could be misread, rewrite it.
- EVERY SENTENCE ADDS SOMETHING NEW (maintainer, repeatedly). Never restate a point in other words, even inside one section: "all items were in one shipment", "there was no second shipment" and "the delivery covers the entire order" are ONE point, said once. Never add a phrase that repeats what the same sentence already says ("on 2 July — the same day").
- THE EXECUTIVE SUMMARY IS A SUMMARY OF THE WHOLE DEFENCE (maintainer). It states the cardholder's claim, gives the facts that answer it in the order that argues best, then ONE plain sentence that ties those facts back to the claim and names them (e.g. "The non-receipt claim is not supported by the carrier's delivery record or by the customer's later purchase."), and ends with the request to reverse the chargeback. An analyst who reads only the summary has the complete case.
- Never pad. Make as many points as the ledger genuinely supports — one strong point is fine. Never invent a second point to reach a number, and never repeat a point in other words.

NEVER (truth): these are absolute
- ${addressRule(ledger)}
- Say the cardholder personally received, signed for, has or used the goods.
- Say the cardholder did not complain, contact the merchant or return anything (absence arguments).
- Say or imply bad faith, dishonesty, fraud or motive.
- Say the claim is late or out of time under network rules.
- Call records "independent" or "corroborating" when they reflect one carrier event.
- Use: irrefutable, undeniable, definitive, conclusively, baseless, fraudulent, invalid, undelivered.
- State anything that is not in the claim ledger. You may combine claims and draw inferences from them, but you may not add a fact.

COPY RULES (the page already shows these)
- No order number (the header has it), no tracking number, no URL, no time of day, no card digits, no amount (the header, the table and the request line carry them), no line-item arithmetic.
- Name the merchant ("${merchant}") once at most. Never name the carrier: write "the carrier".
- No point is made twice anywhere in the letter. Before answering, reread the whole letter and cut any sentence that repeats an earlier one in other words.`;

const EXAMPLE = `REGISTER EXAMPLE: a DIFFERENT, invented case. Copy the shape, never the words.
Case: Northwind Outdoor. A helmet and gloves ordered on 3 March and shipped on 4 March in one parcel. The carrier recorded the delivery on 9 March, and a delivery notice was emailed that day. The same customer placed a new order on 2 April with a card ending in the same four digits. The dispute (non-receipt) was opened on 21 April.

summary: "The cardholder says the order never arrived. The carrier recorded delivery of the complete order on 9 March. Twenty-four days later the same customer ordered again, on a card ending in the same four digits, and nineteen days after that disputed the first order. The non-receipt claim is not supported by the carrier's delivery record or by the customer's later purchase. The merchant requests that the chargeback be reversed."
shipping: "The delivery on the card above is the carrier's own scan, published on its public tracking page; the issuer can open it with the link below. Both items listed under Order Line Items were in this single tracked shipment. There was no partial or second shipment."
chronology: "The order shipped the morning after it was placed, and a delivery notification went to the email address on the order the day the carrier recorded delivery."
conclusion: "The carrier recorded delivery of the entire order. After that delivery, the same customer bought again with the same payment method. The non-receipt claim is not supported by the record."
Note what the chronology does NOT do: it does not repeat the later order, the dispute date or any interval the summary already gave. The timeline shows them.`;

function ledgerBlock(ledger: readonly LedgerClaim[]): string {
  return ledger
    .map((c) => {
      const spec = Object.keys(c.specifics).length ? `\n   specifics: ${JSON.stringify(c.specifics)}` : "";
      const limits = c.mustNot.length ? `\n   PRIVATE LIMITS (never print): ${c.mustNot.join(" ")}` : "";
      return `- ${c.id} [${c.weight}]: ${c.statement}${spec}${limits}`;
    })
    .join("\n");
}

function playbookBlock(p: Playbook): string {
  return `PLAYBOOK: ${p.familyKey}
The analyst's question: ${p.analystQuestion}
Winning theories (choose the one the ledger supports best; the first listed are the strongest when available):
${p.theories.map((t) => `- ${t.name} (needs ${t.requiresClaims.join(", ")}): ${t.shape}`).join("\n")}
Evidence sections available, in default order of force (include a section only if its claims are in the ledger and it advances your theory; reorder if your theory demands it):
${p.sections.map((s) => `- ${s.key}: printed next to ${s.exhibit}. Must prove: ${s.mustProve}.`).join("\n")}
Leave out entirely: ${p.leaveOut.join("; ")}.
Never: ${p.never.join(" ")}`;
}

export function strategistPrompt(ledger: readonly LedgerClaim[], playbook: Playbook, context: string, merchant: string) {
  const system = `You are the merchant's chargeback counsel, planning a response before you write it. Your job is to win.

${standard(merchant, ledger)}

${playbookBlock(playbook)}

TASK
Decide the theory of the case and the plan. Do not write the letter.
Return JSON only:
{
  "theoryOfTheCase": "one or two sentences: what happened, told so the claim cannot survive it",
  "theoryChosen": "the playbook theory name",
  "punchlineCandidates": ["three alternative opening sentences for the executive summary, each setting the claim against the record"],
  "reasonsInOrderOfForce": [{ "claimIds": ["…"], "point": "…" }],
  "sectionPlan": [{ "key": "${playbook.sections.map((s) => s.key).join("|")}", "claimIds": ["…"], "job": "what this section proves for this claim" }],
  "omittedSections": [{ "key": "…", "why": "…" }],
  "specificsPlacement": { "<specific as it will be written>": "summary|${playbook.sections.map((s) => s.key).join("|")}" }
}
sectionPlan lists the evidence sections in the order they will print. specificsPlacement gives each specific exactly one home.`;
  const user = `CASE CONTEXT (already printed on the page)\n${context}\n\nCLAIM LEDGER (the only facts you may use)\n${ledgerBlock(ledger)}`;
  return { system, user };
}

export function writerPrompt(ledger: readonly LedgerClaim[], playbook: Playbook, plan: StrategyPlan, context: string, merchant: string) {
  const system = `You are the merchant's chargeback counsel. You win cases. You are writing the response an issuer's dispute analyst will read in two minutes. Third person. The merchant is "${merchant}".

${standard(merchant, ledger)}

${EXAMPLE}

${playbookBlock(playbook)}

OUTPUT: JSON only.
{
  "summary": { "paragraphs": ["…"], "claimIds": ["…"] },
  "evidenceSections": [ { "key": "${playbook.sections.map((s) => s.key).join("|")}", "paragraphs": ["…"], "claimIds": ["…"] } ],
  "conclusion": { "paragraphs": ["…"], "claimIds": ["…"] }
}
- evidenceSections are printed in the order you give. Omit a section rather than fill it.
- The executive summary already states the whole defence. An evidence section adds ONLY what its exhibit shows that the summary did not say (e.g. that the delivery record is the carrier's own, publicly checkable). It never restates a fact from the summary. If there is nothing new to add, give it "paragraphs": [] — the exhibit (card, table, timeline) still prints.
- SPECIFICS PLACEMENT: each date, interval and count appears ONCE in the whole letter, where the case plan's specificsPlacement puts it. Elsewhere, refer to the event instead ("the delivery", "that order", "the dispute"). The carrier is NAMED only in the headline and in the shipping section; everywhere else write "the carrier". The payment match ("a card ending in the same four digits") appears only in the headline and the chronology; elsewhere say the customer "bought again".
- claimIds per section: every ledger claim the section relies on. Every date, number, name or interval you write must come from the specifics of a claim you cite in that section.
- The conclusion is followed by a fixed request line naming the amount. Do not write a request in the conclusion.
- There is NO headline. The executive summary is the only summary: it opens with the punchline sentence.
- The SUMMARY must carry every [core] claim in the ledger (briefly), because the sections below no longer repeat them. Never state a conclusion ("in full") without the fact that proves it.
- SUMMARY: the complete defence, short and with punch: the claim against the record, the facts that decide it, one sentence tying them to the claim, the request to reverse. Aim for 60–70 words; NEVER more than 80. Short sentences. Cut every word that does not win the case.
- CONCLUSION: a short closing argument (banks expect one). Restate the two strongest facts in plain words WITHOUT any date, number or interval ("The carrier recorded delivery of the entire order. After that delivery, the same customer bought again with the same payment method."), then one sentence: "The non-receipt claim is not supported by the record." At most 45 words. No request (the fixed request line follows). This deliberate restatement is the ONLY repetition allowed in the letter.
- The SHIPPING section does not restate the delivery date: the card above it shows it. When the ledger has whole_order_in_shipment, the SHIPPING section MUST state outright that all the items listed under Order Line Items (give the count) were in this single tracked shipment, and that there was no partial or second shipment. Reviewers miss it otherwise. The count appears only here; the summary says "the complete order".
- Length: summary at most 80 words; each evidence section 30–80 words; conclusion up to 45 words.`;
  const user = `CASE CONTEXT (already printed on the page — do not repeat it)\n${context}\n\nCLAIM LEDGER\n${ledgerBlock(ledger)}\n\nYOUR CASE PLAN (follow it; improve the wording, not the facts)\n${JSON.stringify(plan, null, 2)}`;
  return { system, user };
}

/**
 * Fact-check (plan 4 §6, added after a draft wrote "Seventy-five days passed.
 * Then, on 5 September" — a true number attached to the wrong interval, which
 * the per-number grounding check cannot see). Every sentence is checked
 * against the ledger for numbers, dates, sequence and relations, and for any
 * statement about what the cardholder thought, knew or intended.
 */
export function factCheckPrompt(ledger: readonly LedgerClaim[], letterText: string) {
  const system = `You are a meticulous fact-checker for a chargeback response. The CLAIM LEDGER below is the only set of true facts. Check the letter sentence by sentence.

Flag a sentence when:
- a number, date or interval is attached to the wrong event or the wrong pair of events (e.g. an interval that the ledger gives between A and C is written between A and B);
- events are put in the wrong order, or a relation ("before", "after", "the same day", "then") contradicts the ledger;
- it states a fact that no ledger claim supports;
- it says or implies what the cardholder thought, knew, intended or would have done ("a purchase that only makes sense if…", "they knew", "they would not have…");
- it says where a parcel was delivered, or that anyone personally received it;
- it restates a point already made earlier in the letter or in the same section, in the same or other words (e.g. "one shipment" then "no second shipment" then "the entire order"), or a phrase repeats what its own sentence already says ("on 2 July — the same day").

Do NOT flag style, tone or reasonable argument drawn from ledger facts. DO flag repetition as described above; name the earlier sentence it repeats. The CONCLUSION deliberately restates the strongest facts as a closing argument: do not flag the conclusion as repetition (still flag it for wrong facts). A phrase that relates two DIFFERENT events ("a delivery notification went out that same day" after the delivery) is not repetition; do not flag it.

CLAIM LEDGER
${ledger.map((c) => `- ${c.id}: ${c.statement}${Object.keys(c.specifics).length ? ` (values: ${JSON.stringify(c.specifics)})` : ""}`).join("\n")}

Return JSON only: { "errors": [ { "sentence": "…", "problem": "…" } ] } — an empty array when every sentence is correct.`;
  return { system, user: letterText };
}

export function judgePrompt(letterText: string) {
  const system = `You are a senior dispute analyst at a card issuer. You review merchant responses to chargebacks and decide whether the merchant's evidence defeats the cardholder's claim. You have two minutes. You are sceptical of adjectives, of repetition, and of anything that sounds like the merchant protesting rather than proving. You notice when a letter lists records without telling you what they mean. You read each sentence ONCE: if you have to read a sentence twice, or its literal meaning could be taken the wrong way, that is a failure. Metaphors, idioms and legal flourishes ("closes the claim at the threshold", "without a coherent foundation", "nothing to stand on") also count as unclear: an analyst wants the plain fact and what it proves.

Read the response below. First read ONLY the executive summary and decide. Then read the rest and decide again.

Return JSON only:
{
  "decisionAfterSummaryOnly": "merchant|cardholder|undecided",
  "decisionAfterFullLetter": "merchant|cardholder|undecided",
  "theoryOfTheCase": "the merchant's story as you understood it, one sentence",
  "strongestLine": "…",
  "weakestLine": "…",
  "scores": { "punchline": 1-5, "clarity": 1-5, "evidenceUse": 1-5, "noRepetition": 1-5, "credibility": 1-5 },
  "unclearSentences": ["quote every sentence you had to read twice, or whose literal meaning could be misread; empty if none"],
  "redFlags": ["overstatement, accusation, disclaimer, repetition, filler, or anything that made you doubt the merchant"]
}`;
  return { system, user: letterText };
}
