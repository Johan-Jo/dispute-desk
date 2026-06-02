/**
 * The CE 3.0 Email Course — the 5-email nurture sequence that runs after a
 * lead downloads the Liability-Shift Playbook from /playbook.
 *
 * Education *is* the funnel: each email teaches one liability-shift concept and
 * ties it to a DisputeDesk capability, ending pointed at the Cal teardown link.
 *
 * Ported verbatim from the GTM design bundle (`nurture-app.jsx`). English-only
 * by design — this long-form copy lives outside `messages/` so it is exempt
 * from the 6-locale i18n parity check (English serves all markets for now).
 *
 * Single source of truth for both:
 *   - the welcome send at capture time (/api/playbook/lead),
 *   - the daily follow-up cron (/api/cron/playbook-nurture),
 *   - the internal preview page (/playbook/sequence).
 *
 * `step` is the lead's `nurture_step` value the email corresponds to (1 = the
 * welcome email, sent immediately). `sendAfterDays` is the number of days after
 * capture (`created_at`) the email becomes due; the cron sends the lowest due
 * step a lead has not yet received.
 */

export type NurtureBlock =
  | { t: "p"; c: string }
  | { t: "sign"; c: string };

/**
 * A call-to-action button. `kind` makes the destination explicit so the
 * renderer can style + label it unambiguously — the merchant must always know
 * whether a button installs the app or books a meeting.
 */
export interface NurtureCta {
  label: string;
  href: string;
  kind: "install" | "meeting" | "read";
}

export interface NurtureEmail {
  /** Maps to playbook_leads.nurture_step (1 = welcome). */
  step: number;
  /** Days after capture this email is due. Step 1 = 0 (sent at capture). */
  sendAfterDays: number;
  /** Human label for the cadence map / preview UI. */
  send: string;
  /** Trigger note for the preview UI ("—" when time-based). */
  trigger: string;
  /** One-line strategic goal (preview UI only). */
  goal: string;
  subject: string;
  preview: string;
  /** Short label of the concept taught (preview UI chip). */
  teaches: string;
  /**
   * The dominant action — always offered. Every email lets the merchant get
   * the app right away. (Welcome leads with "read the Playbook" but still
   * offers install as secondary.)
   */
  primaryCta: NurtureCta;
  /** Optional second action (e.g. book a meeting). Clearly labeled as such. */
  secondaryCta?: NurtureCta;
  body: NurtureBlock[];
}

/**
 * Resolve the real CTA URLs once. `playbookUrl` is the public Playbook reader;
 * `calUrl` is the same Cal booking link used on the contact page.
 */
export function buildNurtureSequence(opts: {
  playbookUrl: string;
  calUrl: string;
  installUrl: string;
}): NurtureEmail[] {
  const { playbookUrl, calUrl, installUrl } = opts;

  return [
    {
      step: 1,
      sendAfterDays: 0,
      send: "Immediately on signup",
      trigger: "Playbook download",
      goal: "Deliver the promise, set the tone, start the relationship.",
      subject: "Your Liability-Shift Playbook (+ the one test that matters)",
      preview: "The 5-minute test is on page 6 — but read this first.",
      teaches: "Reframe: fightable vs. liability-shift eligible",
      primaryCta: { label: "Read the Playbook", href: playbookUrl, kind: "read" },
      secondaryCta: { label: "Install DisputeDesk free on Shopify", href: installUrl, kind: "install" },
      body: [
        { t: "p", c: "Here's your copy of the Liability-Shift Playbook — it's yours to keep, and you can read it any time at the link below." },
        { t: "p", c: "Before you dive in, one idea that reframes everything: most merchants ask \"can I fight this dispute?\" The answer is almost always yes. The better question — the one almost nobody asks — is \"is this dispute liability-shift eligible?\"" },
        { t: "p", c: "Fightable means you're allowed to respond. Eligible means the network's own rules force the issuer to eat the loss, if you supply the right evidence. One is hope. The other is leverage." },
        { t: "p", c: "The five-minute test on page 6 tells you which is which. Run it on your next dispute and you'll never look at a chargeback the same way. And when you want it run automatically on every dispute, DisputeDesk is free to install on Shopify — no credit card." },
        { t: "sign", c: "— The DisputeDesk team\nP.S. Reply and tell me your rough monthly dispute volume — I read every one, and it helps me send you the right things." },
      ],
    },
    {
      step: 2,
      sendAfterDays: 2,
      send: "Day 2",
      trigger: "—",
      goal: "Teach CE 3.0 concretely; tie the lesson to a capability.",
      subject: "Why you lost that \"obvious\" Visa dispute",
      preview: "Two matching data points isn't enough. Here's the catch.",
      teaches: "CE 3.0 anchor requirement (IP / device)",
      primaryCta: { label: "Install DisputeDesk free on Shopify", href: installUrl, kind: "install" },
      secondaryCta: { label: "Book a 20-min dispute teardown", href: calUrl, kind: "meeting" },
      body: [
        { t: "p", c: "Quick one today, because it's the single most expensive misunderstanding in Visa disputes." },
        { t: "p", c: "Compelling Evidence 3.0 lets you win Visa 10.4 fraud disputes if the cardholder has a history with you — 2 prior undisputed orders in the 120–365 day window, with 2+ matching data points across orders." },
        { t: "p", c: "Here's where merchants lose: they match shipping address and customer name, feel confident, and submit. Rejected. Why? CE 3.0 requires that at least one of your matching points be IP address or device fingerprint. That's the anchor. Name + address alone doesn't clear the bar." },
        { t: "p", c: "So the question isn't \"do I have a returning customer?\" It's \"do I have the IP or device match to prove it?\" DisputeDesk captures device and IP per order and checks the anchor for you on every dispute — install it free on Shopify to see your own verdicts. Prefer a human first? Book a teardown below." },
        { t: "sign", c: "— The DisputeDesk team\nP.S. Not sure whether your store captures device and IP per order? That's exactly what DisputeDesk checks first — install it free, or bring it to a teardown." },
      ],
    },
    {
      step: 3,
      sendAfterDays: 5,
      send: "Day 5",
      trigger: "—",
      goal: "Teach FPT; its broad edge is winning new-customer disputes.",
      subject: "The Mastercard program that wins new-customer disputes",
      preview: "First-Party Trust needs no purchase history. CE 3.0 does.",
      teaches: "FPT three categories — no priors required",
      primaryCta: { label: "Install DisputeDesk free on Shopify", href: installUrl, kind: "install" },
      secondaryCta: { label: "Book a 20-min dispute teardown", href: calUrl, kind: "meeting" },
      body: [
        { t: "p", c: "Visa gets all the attention, but Mastercard built its own liability-shift program — First-Party Trust — and it has one property that makes it quietly powerful." },
        { t: "p", c: "FPT doesn't require prior transactions. Where CE 3.0 needs a returning customer with 2+ matching orders, FPT can win a dispute for a brand-new buyer on their very first purchase. For any store with a steady stream of first-time customers, that's a whole category of disputes CE 3.0 simply can't touch." },
        { t: "p", c: "The trade-off: you need evidence across all three categories — Device, Delivery, and Identity. Strong on two and blank on the third and it sinks. FPT rewards breadth where CE 3.0 rewards matched priors." },
        { t: "p", c: "Reason codes to watch: Mastercard 4837 (No Cardholder Authorization) and 4863 (Cardholder Does Not Recognize). See those and you're likely in FPT territory. DisputeDesk runs both the CE 3.0 and FPT checks on every dispute automatically — install it free on Shopify and see which of your disputes qualify in about ten minutes." },
        { t: "sign", c: "— The DisputeDesk team" },
      ],
    },
    {
      step: 4,
      sendAfterDays: 9,
      send: "Day 9",
      trigger: "—",
      goal: "Proof. Show the product doing the work, transparently.",
      subject: "What Shopify's default dispute tool doesn't tell you",
      preview: "It'll auto-generate evidence. It won't tell you if you can win.",
      teaches: "Positioning vs. generic representment; transparency",
      primaryCta: { label: "Install DisputeDesk free on Shopify", href: installUrl, kind: "install" },
      secondaryCta: { label: "Book a 20-min dispute teardown", href: calUrl, kind: "meeting" },
      body: [
        { t: "p", c: "Shopify's built-in dispute tool — and most chargeback apps — operate on the legacy model: they help you assemble tracking, customer comms, and policies, then hand it off. Some now add AI-generated evidence." },
        { t: "p", c: "None of them answer the only question that predicts the outcome: is this dispute liability-shift eligible, and why? They'll happily help you build a pack for a dispute you can't win." },
        { t: "p", c: "That's the gap DisputeDesk fills. For every dispute, it checks the CE 3.0 and FPT rulebooks and gives you a verdict — qualifies, partial, or not applicable — with the exact reasoning. Then it builds the formatted package. You see precisely what's being sent and why. No black box." },
        { t: "p", c: "We're also honest about the edges: you submit the finished pack via Shopify Admin — we don't submit directly to the networks — and the issuer always makes the final call. We'd rather tell you that than oversell it." },
        { t: "p", c: "It's free to install on Shopify, so the easiest way to see the verdicts is on your own disputes — install below. If you'd rather watch us run a few of yours live first, book a teardown." },
        { t: "sign", c: "— The DisputeDesk team" },
      ],
    },
    {
      step: 5,
      sendAfterDays: 14,
      send: "Day 14",
      trigger: "—",
      goal: "The ask. Install-first, with the teardown as a warm alternative.",
      subject: "Two ways to put this to work (one is free)",
      preview: "Install DisputeDesk free, or bring me 3 disputes for a teardown.",
      teaches: "Conversion: install free vs. the dispute teardown",
      primaryCta: { label: "Install DisputeDesk free on Shopify", href: installUrl, kind: "install" },
      secondaryCta: { label: "Book a 20-min dispute teardown", href: calUrl, kind: "meeting" },
      body: [
        { t: "p", c: "Over the last two weeks you've gotten the full liability-shift framework — CE 3.0, FPT, the anchor rule, the three categories, the five-minute test. That's more than most agencies know. Here are the two ways to put it to work." },
        { t: "p", c: "1. Install DisputeDesk free on Shopify. It's the fastest path — about ten minutes — and you'll see your own qualification verdicts on real disputes right away. Free plan, no credit card; you only upgrade if it's pulling its weight." },
        { t: "p", c: "2. Or book a 20-minute dispute teardown. Bring 2–3 of your real, recent disputes and we'll run each one through the test live — network, reason code, eligibility, what evidence you have, what's missing. You walk away knowing exactly which are liability-shift eligible, whether or not you ever use DisputeDesk. No pitch deck, no pressure." },
        { t: "p", c: "Most people start by installing and book a teardown later if they want a second pair of eyes. Either works — pick what fits." },
        { t: "sign", c: "— The DisputeDesk team\nP.S. Even if now isn't the time, keep the Playbook handy. The next 10.4 that lands in your inbox is the one to run the test on." },
      ],
    },
  ];
}

/** Total number of emails in the sequence (used by cron + UI). */
export const NURTURE_SEQUENCE_LENGTH = 5;
