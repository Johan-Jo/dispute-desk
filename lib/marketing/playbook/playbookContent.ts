/**
 * The Liability-Shift Playbook — structured content for the web reader at
 * /playbook/read.
 *
 * Ported verbatim from the GTM design bundle (`The Liability-Shift Playbook.html`),
 * an 8-page editorial field guide. English-only by design: this long-form copy
 * lives outside `messages/` so it is exempt from the 6-locale i18n parity check
 * (English serves all markets for now). The landing-page *chrome* IS translated
 * via the `playbook` namespace; only the long-form body is English.
 *
 * Brazil note: all PT-BR / "Brazil moat" framing was intentionally removed from
 * these assets. FPT region eligibility appears only as a neutral factual note.
 *
 * Block types map 1:1 to renderers in components/marketing/PlaybookReader.tsx.
 * `html: true` on a paragraph/list/quote means the string carries inline
 * <strong>/<em> markup that the reader renders with dangerouslySetInnerHTML
 * (content is static and authored here — no user input).
 */

export type PlaybookBlock =
  | { t: "lead"; c: string; html?: boolean }
  | { t: "p"; c: string; html?: boolean; drop?: boolean }
  | { t: "h3"; c: string }
  | { t: "rule" }
  | { t: "callout"; variant: "blue" | "wax"; marker: string; title: string; body: string; html?: boolean }
  | { t: "list"; items: string[]; html?: boolean }
  | { t: "tags"; items: string[] }
  | {
      t: "table";
      head: [string, string, string];
      rows: { label: string; visa: string; mc: string }[];
    }
  | { t: "steps"; steps: { num: string; title: string; body: string; q?: string; html?: boolean }[] };

export interface PlaybookSection {
  id: string;
  /** Dark slate surface (cover + final CTA) vs paper. */
  dark?: boolean;
  /** Running-header right label (page sections only). */
  runHead?: string;
  /** Page number badge. */
  pageNo?: string;
  kicker?: string;
  eyebrow?: string;
  heading: string;
  /** When true, heading uses the large serif cover/title treatment with <em>. */
  coverTitle?: boolean;
  blocks: PlaybookBlock[];
}

export const PLAYBOOK_META = {
  title: "The Liability-Shift Playbook",
  edition: "2026 · DP-LM-01",
  pages: 8,
  readingTime: "12-minute read",
};

export const PLAYBOOK_SECTIONS: PlaybookSection[] = [
  // ── Cover ──────────────────────────────────────────────────────────────
  {
    id: "cover",
    dark: true,
    eyebrow: "§ DisputeDesk · Field Guide for Shopify Merchants",
    heading: "The Liability-<em>Shift</em> Playbook",
    coverTitle: true,
    blocks: [
      {
        t: "lead",
        c: "How to tell which chargebacks are <strong>liability-shift eligible</strong> under Visa Compelling Evidence 3.0 and Mastercard First-Party Trust — and stop losing the ones you should win.",
        html: true,
      },
    ],
  },

  // ── Page 1 — The problem ───────────────────────────────────────────────
  {
    id: "the-problem",
    runHead: "§ 01 · Why you lose winnable disputes",
    pageNo: "01",
    kicker: "The problem",
    heading: "You're sending evidence to a rulebook that retired.",
    blocks: [
      {
        t: "p",
        drop: true,
        html: true,
        c: "Most Shopify merchants fight chargebacks the same way they did in 2018: attach the tracking number, paste the customer's order confirmation, write a paragraph explaining the product was delivered, and hope. That's the <strong>legacy representment model</strong> — and for first-party fraud (the \"I don't recognize this charge\" disputes), it loses far more than it wins.",
      },
      {
        t: "p",
        html: true,
        c: "Here's the part nobody tells you: the card networks built entirely new programs to handle exactly these disputes — and those programs don't reward a good paragraph. They reward <strong>specific, structured evidence that matches a precise rulebook</strong>. Send the right data and liability legally shifts to the issuer. Send a tracking number, and you're playing a game that no longer exists.",
      },
      {
        t: "callout",
        variant: "blue",
        marker: "i",
        title: "The distinction that matters",
        html: true,
        body: "<strong>Fightable</strong> means you're allowed to respond. <strong>Liability-shift eligible</strong> means the network's own rules force the issuer to eat the loss <em>if</em> you supply the qualifying evidence. Every merchant fights. Almost none check eligibility first — so they fight disputes they can't win and fumble the ones they could.",
      },
      { t: "h3", c: "Why this is getting worse, not better" },
      {
        t: "p",
        c: "First-party fraud — friendly fraud, where a real customer disputes a charge they actually made — is the fastest-growing category of chargebacks. The networks know it. That's why Visa and Mastercard each shipped a dedicated program to let merchants push back with hard evidence. The merchants who learn the rules win. The merchants who keep attaching tracking numbers subsidize everyone else.",
      },
      {
        t: "p",
        c: "This playbook gives you the two rulebooks in plain language, plus a five-minute test you can run on your next dispute to know — before you spend an hour writing — whether it's winnable, and how.",
      },
    ],
  },

  // ── Page 2 — The big idea ──────────────────────────────────────────────
  {
    id: "the-big-idea",
    runHead: "§ 02 · What liability shift actually is",
    pageNo: "02",
    kicker: "The big idea",
    heading: "Don't argue the dispute. Disqualify it.",
    blocks: [
      {
        t: "p",
        html: true,
        c: "A normal representment <em>argues</em>: \"we believe this charge was legitimate, here's why.\" A liability-shift submission does something colder and more effective — it demonstrates that, under the network's published criteria, <strong>this transaction no longer qualifies as fraud at all.</strong> The issuer isn't being persuaded; they're being shown a rule.",
      },
      {
        t: "p",
        html: true,
        c: "Both Visa and Mastercard built this around one insight: <strong>a genuine fraudster doesn't have a history with you.</strong> If the same person who's disputing this charge has bought from you before, from the same device, same IP, shipping to the same address — that's not card-absent fraud. It's a customer with buyer's remorse, a forgotten subscription, or a family member's purchase. The evidence of <em>relationship</em> is what shifts liability.",
      },
      { t: "rule" },
      { t: "h3", c: "The two programs you need to know" },
      {
        t: "tags",
        items: [
          "Visa → Compelling Evidence 3.0 (CE 3.0)",
          "Mastercard → First-Party Trust (FPT)",
        ],
      },
      {
        t: "p",
        html: true,
        c: "They solve the same problem on different networks, with different rules. The single most valuable habit you can build is a <strong>30-second triage</strong> at the top of every dispute: <em>which network, which reason code, which program — if any?</em> Get that right and everything downstream gets easier. The next two pages give you each rulebook; the page after that turns them into a test.",
      },
      {
        t: "callout",
        variant: "wax",
        marker: "!",
        title: "An honest caveat, up front",
        html: true,
        body: "No tool — including DisputeDesk — can <em>guarantee</em> a liability shift. The issuer makes the final call. What you <strong>can</strong> control is whether your evidence actually meets the criteria before you submit. That's the entire game, and it's almost entirely winnable with discipline.",
      },
    ],
  },

  // ── Page 3 — Programs at a glance ──────────────────────────────────────
  {
    id: "at-a-glance",
    runHead: "§ 03 · The two rulebooks, side by side",
    pageNo: "03",
    kicker: "At a glance",
    heading: "CE 3.0 vs. First-Party Trust",
    blocks: [
      {
        t: "p",
        c: "Tape this to your wall. Before you write a single word of evidence, find your dispute in this table.",
      },
      {
        t: "table",
        head: ["", "Visa CE 3.0", "Mastercard FPT"],
        rows: [
          { label: "Network", visa: "Visa only", mc: "Mastercard only" },
          {
            label: "Trigger reason code",
            visa: "10.4 — Other Fraud, Card-Absent",
            mc: "4837 / 4863 — first-party fraud",
          },
          {
            label: "Needs prior transactions?",
            visa: "Yes — at least 2 undisputed priors",
            mc: "No — a brand-new customer can qualify",
          },
          {
            label: "The time window",
            visa: "Priors must fall 120–365 days before the disputed order",
            mc: "Not prior-dependent",
          },
          {
            label: "The core test",
            visa: "2+ matching data points across orders, with at least one being IP or device",
            mc: "Evidence across all three categories: Device, Delivery, Identity",
          },
          {
            label: "Region",
            visa: "Global",
            mc: "US (2024) · rolling out to more markets (2025+)",
          },
          {
            label: "Shortcut",
            visa: "3DS / Visa Secure authenticated orders are auto-qualified",
            mc: "Strong device + identity signals can carry a new customer",
          },
        ],
      },
      {
        t: "callout",
        variant: "blue",
        marker: "i",
        title: "The two programs cover different customers",
        html: true,
        body: "Notice the asymmetry: CE 3.0 wins disputes from <strong>returning</strong> customers (it needs the prior orders), while FPT can win disputes from <strong>brand-new</strong> ones (it doesn't). Run both checks and between them you cover most friendly-fraud disputes that land in your queue.",
      },
    ],
  },

  // ── Page 4 — CE 3.0 deep dive ──────────────────────────────────────────
  {
    id: "ce30-deep-dive",
    runHead: "§ 04 · Visa Compelling Evidence 3.0",
    pageNo: "04",
    kicker: "Deep dive · Visa",
    heading: "Compelling Evidence 3.0, in plain English",
    blocks: [
      {
        t: "p",
        html: true,
        c: "CE 3.0 applies to exactly one reason code: <strong>Visa 10.4</strong> (Other Fraud — Card-Absent Environment), the most common card-not-present fraud code. If your dispute isn't Visa 10.4, CE 3.0 is off the table — go check FPT instead. If it <em>is</em>, here is the test, in order.",
      },
      {
        t: "steps",
        steps: [
          {
            num: "1",
            title: "Find two prior undisputed orders from the same cardholder",
            body: "The same customer must have bought from you at least twice before, and those orders must not themselves have been disputed.",
            q: "Q: Has this customer ordered ≥2 times before, cleanly?",
          },
          {
            num: "2",
            title: "Confirm those priors fall in the 120–365 day window",
            body: "The qualifying prior orders must be at least 120 days old but no more than 365 days before the disputed transaction. Too recent or too old and they don't count.",
            q: "Q: Are the priors between 4 and 12 months before the dispute?",
          },
          {
            num: "3",
            title: "Match at least two data points — one of them an anchor",
            html: true,
            body: "Across the disputed order and the priors, at least two of {IP address, device fingerprint, shipping address, customer account ID} must match — and <strong>at least one must be IP or device</strong>. That's the anchor requirement, and it's where most \"obvious\" cases quietly fail.",
            q: "Q: Do 2+ data points match, including IP or device?",
          },
        ],
      },
      {
        t: "callout",
        variant: "wax",
        marker: "★",
        title: "The 2025–2026 shortcut (and its catch)",
        html: true,
        body: "Since <strong>October 17, 2025</strong>, any transaction authenticated with Visa Secure (3DS2) or Visa Data Only is <strong>automatically pre-qualified</strong> for CE 3.0 — no priors, no matching packet required. The catch: from <strong>April 17, 2026</strong>, Visa charges a per-qualification fee on successful auto-qualifications. Net: turning on 3DS is still one of the highest-leverage things you can do, but know the fee exists.",
      },
    ],
  },

  // ── Page 5 — FPT deep dive ─────────────────────────────────────────────
  {
    id: "fpt-deep-dive",
    runHead: "§ 05 · Mastercard First-Party Trust",
    pageNo: "05",
    kicker: "Deep dive · Mastercard",
    heading: "First-Party Trust, in plain English",
    blocks: [
      {
        t: "p",
        html: true,
        c: "FPT covers Mastercard first-party-fraud disputes — most commonly reason codes <strong>4837</strong> (No Cardholder Authorization) and <strong>4863</strong> (Cardholder Does Not Recognize). Unlike CE 3.0, it does <strong>not</strong> require prior transactions, which means it can win disputes for brand-new customers. The trade-off: you must show evidence across <em>all three</em> categories.",
      },
      { t: "h3", c: "The three categories — you need strength in each" },
      {
        t: "list",
        html: true,
        items: [
          "<b>Device</b> — the signals that identify the machine and connection used: device fingerprint, IP address, user agent, login state at checkout.",
          "<b>Delivery</b> — proof the goods or services reached the cardholder: tracking with delivery confirmation, delivery address consistency, access logs for digital goods.",
          "<b>Identity</b> — proof the buyer is who the account says: account age, login history, AVS / CVV match, email and phone on file, purchase history.",
        ],
      },
      {
        t: "p",
        html: true,
        c: "An empty category sinks the submission — strong Device and Delivery won't save you if Identity is blank. FPT rewards <strong>breadth</strong>, where CE 3.0 rewards <strong>matched priors</strong>.",
      },
      {
        t: "callout",
        variant: "blue",
        marker: "i",
        title: "Region eligibility — check before you build",
        html: true,
        body: "FPT went live in the US in Oct 2024 and has been rolling out to additional markets since 2025 (Canada, parts of LATAM and APAC); it is <em>not</em> yet available in the EU. A perfect evidence package in an ineligible region still loses — region is a gate, not a tiebreaker, so confirm your market first.",
      },
    ],
  },

  // ── Page 6 — The self-audit ────────────────────────────────────────────
  {
    id: "the-self-audit",
    runHead: "§ 06 · The five-minute self-audit",
    pageNo: "06",
    kicker: "The centerpiece · run this on every dispute",
    heading: "The five-minute eligibility test",
    blocks: [
      {
        t: "p",
        c: "Before you write anything, walk these five gates in order. The first \"no\" tells you exactly where you stand — and saves you from fighting a dispute you can't win.",
      },
      {
        t: "steps",
        steps: [
          {
            num: "A",
            title: "Which network?",
            body: "Visa → check CE 3.0 (gate B). Mastercard → check FPT (gate D). Amex / other → liability shift doesn't apply; fall back to a strong standard representment.",
          },
          {
            num: "B",
            title: "Visa: is the reason code 10.4?",
            body: "Yes → continue to C. No → CE 3.0 is out; build the best standard rebuttal you can, speaking the specific reason code's language (e.g. 13.1 Merchandise Not Received needs delivery proof).",
          },
          {
            num: "C",
            title: "Visa 10.4: priors + match + anchor?",
            html: true,
            body: "2 undisputed priors in the 120–365 day window, 2+ matching data points, at least one IP or device? <strong>Yes → CE 3.0 eligible.</strong> Authenticated via 3DS? Auto-qualified — skip the priors entirely.",
          },
          {
            num: "D",
            title: "Mastercard: eligible code + region?",
            html: true,
            body: "Reason code 4837 / 4863 <em>and</em> your market is FPT-live (US plus expanding markets)? Yes → continue to E. No → standard representment.",
          },
          {
            num: "E",
            title: "FPT: evidence in all three categories?",
            html: true,
            body: "Non-trivial Device <em>and</em> Delivery <em>and</em> Identity evidence? <strong>Yes → FPT eligible.</strong> Any category empty → gather it first, or fall back to standard.",
          },
        ],
      },
      {
        t: "callout",
        variant: "blue",
        marker: "i",
        title: "What \"eligible\" buys you",
        body: "An eligible dispute submitted with qualifying evidence isn't a coin flip — it's the issuer being shown their own rule. That's the difference between a ~stable single-digit win rate on friendly fraud and a materially higher one. Eligibility is the leverage.",
      },
    ],
  },

  // ── Page 7 — Capture now + mistakes ────────────────────────────────────
  {
    id: "capture-and-mistakes",
    runHead: "§ 07 · Start capturing · common mistakes",
    pageNo: "07",
    kicker: "Forward-looking",
    heading: "The evidence you should be capturing today",
    blocks: [
      {
        t: "p",
        html: true,
        c: "Here's the catch with both programs: you can't go back and collect IP, device, and session data for an order that already happened. Eligibility for <em>future</em> disputes is built by what you capture <strong>now</strong>. The merchants with high qualification rates didn't get lucky — they started logging the right signals before the disputes arrived.",
      },
      {
        t: "list",
        html: true,
        items: [
          "<b>IP address per order</b> — the most common anchor for CE 3.0 matching.",
          "<b>Device fingerprint &amp; user agent</b> — the second anchor, and an FPT Device signal.",
          "<b>Login state &amp; account ID at checkout</b> — ties the order to a known customer.",
          "<b>Delivery confirmation, not just tracking</b> — \"shipped\" isn't \"delivered.\"",
          "<b>AVS / CVV results &amp; account age</b> — the backbone of FPT Identity.",
        ],
      },
      { t: "rule" },
      { t: "h3", c: "Five mistakes that cost merchants winnable disputes" },
      {
        t: "list",
        html: true,
        items: [
          "<b>Fighting everything.</b> Submitting on ineligible disputes burns time and can hurt your win-rate metrics. Triage first.",
          "<b>Missing the anchor.</b> Two matching data points that are both <em>address</em> fail CE 3.0 — you need IP or device.",
          "<b>Treating \"shipped\" as \"delivered.\"</b> A tracking number without delivery confirmation is a weak Delivery signal.",
          "<b>Generic reason-code language.</b> \"The customer claims they didn't receive it\" is weaker than citing the exact code and proof.",
          "<b>Leaving an FPT category empty.</b> Breadth wins FPT; one blank category sinks an otherwise strong case.",
        ],
      },
    ],
  },

  // ── Page 8 — Next step (dark CTA) ──────────────────────────────────────
  {
    id: "next-step",
    dark: true,
    runHead: "§ 08 · What to do next",
    pageNo: "08",
    eyebrow: "§ Your next move",
    heading:
      "You now know more about liability shift than most merchants — and most agencies.",
    blocks: [
      {
        t: "p",
        c: "The hard part isn't understanding the rules. It's running the five-minute test on every dispute, every time, while you're also running a business. That's the part worth automating.",
      },
      {
        t: "p",
        html: true,
        c: "<strong>DisputeDesk</strong> is the only Shopify-native tool that checks each dispute against the CE 3.0 and FPT rulebooks automatically — it tells you, per dispute, whether it qualifies and exactly why, then builds the formatted evidence package. We're transparent about what we send and honest about what we can't: you submit the finished pack via Shopify Admin, the issuer still decides, and we don't claim otherwise.",
      },
    ],
  },
];
