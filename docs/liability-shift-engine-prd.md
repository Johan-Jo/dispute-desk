# DisputeDesk — Liability-Shift Engine

**Status:** Planning (v2 — supersedes v1)
**Owner:** Johan
**Last updated:** May 14, 2026
**Document type:** Internal planning PRD

---

## 0. What changed from v1

The v1 PRD assumed DisputeDesk could submit CE 3.0 and FPT evidence end-to-end through Shopify. Investigation against primary sources changed that picture.

### Update: research confirmation (2026-05-14)

Primary-source research against Verifi (Visa-owned), Visa public PDFs, Checkout.com, cside.com, and Chargebacks911 confirmed the core CE 3.0 rules (120–365 day window, 2 priors, 4 matching elements with IP/Device anchor). It also surfaced three material findings that the original PRD did not capture:

1. **October 17, 2025: Visa Secure auto-qualification.** Transactions authenticated via Visa Secure (3DS2) or Visa Data Only (frictionless 3DS data exchange) are now **automatically pre-qualified** for CE 3.0. The 2-priors-plus-matching packet is not required for these — Visa attaches the qualification metadata directly. The merchant still submits rebuttal evidence, but the qualification verdict short-circuits to "network pre-qualified." **April 17, 2026: Visa introduces a per-qualification fee** for successful auto-qualifications. LSE-1 must branch on 3DS state and surface the fee implication. (Source: cside.com / Visa Business News Update)
2. **Subscription / MIT exception.** When the disputed order is a recurring billing where IP / device legitimately differ between bills (customer signed up once, gets charged monthly), the merchant may use the **initial subscription billing transaction** as the matching anchor instead of arbitrary priors in the window. This is significant for Shopify subscription merchants — LSE-1 treats this as a distinct qualification branch.
3. **Operational matching strictness.** Acquirers enforce tighter matching than the rule technically requires: shipping addresses generally need exact match (not just normalized), IP matching has acceptable ISP/subnet-level fallback but exact-string is stronger, and device fingerprints must be deterministic (reproducible browser-layer capture — not opportunistic third-party scripts). LSE-1 / LSE-4 encode these tolerances explicitly.

§4 (Pillar 1 — Qualification Engine) and the LSE-1 epic doc are updated to reflect these findings.

- **Shopify's dispute evidence API has no structured fields for CE 3.0.** No prior transaction IDs, no IP matching fields, no device fingerprint, no customer account ID matching. The schema is the legacy representment model: policies, tracking, customer comms, plus a free-text and free-file catch-all. CE 3.0 data can only be passed as unstructured text/PDF, which the issuer is unlikely to recognize as CE 3.0.
- **Shopify's December 2025 evidence form refresh did not add CE 3.0 fields.** They added AI-generated evidence and PDF transparency, but stayed on the legacy schema. Strong signal that CE 3.0 support is not imminent on Shopify's roadmap, and that Shopify's own AI feature is now a competing surface in the same space.
- **FPT pre-authorization (via 3DS Identity Check Insights) is structurally unavailable to a Shopify app.** Shopify Payments owns the authorization path. A third-party app cannot inject data into the 3DS message.
- **FPT post-dispute (via Ethoca Consumer Clarity) requires commercial Ethoca enrollment.** Mastercard requests evidence from Ethoca, not from merchants or apps directly. Becoming an Ethoca data partner is a business-development effort, not a developer signup.

The strategy is still correct. The execution plan needed to be more honest about what's buildable now vs. what's gated on partnerships or platform changes.

The v2 PRD reframes accordingly: **DisputeDesk is a CE 3.0 / FPT readiness, evidence-intelligence, and workflow platform**, not an automated submission engine. Submission is a later phase, gated on Verifi/Ethoca partnerships or Shopify platform changes.

---

## 1. Strategy

### One-paragraph thesis

Visa CE 3.0 and Mastercard FPT shift dispute liability to the issuer when specific evidence conditions are met. Almost no Shopify-native tool generates evidence that actually qualifies under these programs — most still operate on the legacy "submit tracking + customer comms" representment model. DisputeDesk's wedge is to become the system of record for CE 3.0 / FPT readiness on Shopify: capture the right data, qualify each dispute against the right program, generate compliant evidence packages, and route submission through whatever channels are available today — with direct network submission as the long-term roadmap. The Brazil / Portuguese-language angle is a parallel moat: FPT just expanded to Latin America, and no PT-BR-native chargeback tool exists.

### What success looks like in 12 months

- Merchants can see, for each dispute, whether it would qualify for CE 3.0 or FPT and why
- DisputeDesk generates CE 3.0– and FPT–formatted evidence packages and submits them through the best available channel
- At least one partnership signed with a Verifi or Ethoca-connected channel for direct network submission
- Documented improvement in merchant win rate on Visa 10.4 disputes vs. baseline
- Bilingual product (EN + PT-BR) live; remaining four languages on schedule
- Newsletter has built a top-of-funnel pipeline of educated merchants who understand CE 3.0 / FPT and why DisputeDesk matters

### What success does *not* require in 12 months

- Direct Mastercard FPT API access
- Direct Visa VROL pre-arbitration access
- Shopify Payments adding CE 3.0 schema fields
- Pre-authorization FPT submission

These are upside, not baseline.

---

## 2. Background: how the programs actually work

### Visa Compelling Evidence 3.0

**Applies to:** Visa reason code 10.4 (Other Fraud — Card-Absent Environment). Most common CNP fraud code.

**Qualification rules:**
- At least **2 prior undisputed transactions** with the same cardholder
- Occurring between **120 and 365 days** before the disputed transaction
- With **2 matching data points** across the disputed transaction *and* the priors, from this list:
  - IP address
  - Device ID / fingerprint
  - Shipping address (physical goods only)
  - Customer account ID / login
- **At least one of the matches must be IP address or device ID/fingerprint** (the "anchor" requirement)

**Submission channels:**
- **Acquirer / Verifi VROL pre-arbitration** is the canonical channel. Visa expects CE 3.0 submissions through the VROL pre-arbitration questionnaire.
- **Shopify Payments dispute evidence API** has no CE 3.0–structured fields. Submitting through it puts CE 3.0 data in free-text/PDF, with unknown downstream routing.

**Liability outcome (when accepted):** Dispute liability shifts to the issuer. Transaction is excluded from VAMP ratio numerator per Visa's VAMP fact sheet.

### Mastercard First-Party Trust

**Applies to:** First-party fraud disputes on Mastercard CNP transactions.

**Evidence framework:** Three categories — Device, Delivery, Identity — submitted with transaction context. Unlike CE 3.0, FPT does *not* strictly require prior transactions; some pre-auth submissions can qualify a brand-new customer.

**Submission paths:**
1. **Pre-authorization** — via Mastercard's 3DS Identity Check Insights API. Requires merchant or their payment partner to run a 3DS server or use Mastercard's 3DS Smart Interface API. *Structurally unavailable to a Shopify app — Shopify Payments owns the auth path.*
2. **Post-dispute** — via the Ethoca Consumer Clarity Merchant Transactions API. When a Mastercard dispute is filed, Mastercard requests evidence from Ethoca. *Requires commercial Ethoca data partner enrollment.*

**Regional availability:**
- US pilot: 2023
- US full availability: October 2024
- Global: June 2025 (Canada, LATAM including Brazil, Caribbean, Asia-Pacific)

**Liability outcome (when accepted):** Dispute deflected before becoming a formal chargeback. Does not register in EFM or ECP monitoring ratios.

### Programs side-by-side

| | CE 3.0 (Visa) | FPT (Mastercard) |
|---|---|---|
| Card network | Visa | Mastercard |
| Trigger | Post-dispute | Pre-auth OR post-dispute |
| Evidence model | 2 prior undisputed transactions + 2 matching points (IP/device anchor required) | 3 categories: Device, Delivery, Identity |
| Requires prior history? | Yes | No (pre-auth path can qualify new customers) |
| Network submission path | Verifi VROL | 3DS Identity Check Insights / Ethoca Consumer Clarity |
| Available via Shopify dispute API? | No structured fields | No |
| Available to a third-party Shopify app today? | Via partner channel only | Via Ethoca partner channel only |
| Ratio impact when accepted | Excluded from VAMP | Excluded from EFM/ECP |

The two programs are conceptually similar but operationally separate. DisputeDesk handles both, but the submission story is different for each.

---

## 3. Feature scope, restructured

The v1 four-pillar plan stays, but **what each pillar does has changed** to reflect the access reality:

### Pillar 1 — Qualification Engine (buildable now, no permissions needed)

For every dispute, determine whether it would qualify for CE 3.0 or FPT, and explain why or why not.

### Pillar 2 — Evidence Package Generator (buildable now, no permissions needed)

Generate CE 3.0– and FPT–formatted evidence documents from Shopify data.

### Pillar 3 — Submission Router (best-effort now, full automation later)

Route the generated evidence to whatever channel is available for that merchant, with a clear "manual handoff" path when direct submission isn't possible.

### Pillar 4 — Session Evidence Capture (privacy-safe v1, richer v2)

Capture the device, IP, behavioral, and session signals that strengthen CE 3.0 / FPT eligibility for *future* disputes. Start privacy-safe; expand later under legal review.

### Pillar 5 — Ratio & Compliance Dashboard

Show the merchant their VAMP, EFM, and ECP ratios, threshold proximity, and the counterfactual impact of DisputeDesk's work.

Pillars are no longer numbered as a build sequence — see Section 8 for the actual phased rollout.

---

## 4. Pillar 1 — Qualification Engine

### User story

> When a chargeback notification arrives, I want to know immediately whether this dispute can win via CE 3.0 or FPT, what evidence I have, and what's missing.

### Behavior

On `disputes/create` webhook:

1. Fetch the disputed order, customer, and card network
2. Identify card network and reason code
3. For Visa 10.4 → run CE 3.0 qualification check
4. For Mastercard first-party-fraud reason codes → run FPT readiness check
5. Surface one of four states in the dashboard:
   - **Qualifies (high confidence)** — all criteria met, evidence available
   - **Qualifies (low confidence)** — criteria met but data quality is weak (e.g., guest checkout, no device match)
   - **Partial** — close but missing one thing (e.g., only 1 prior order in window, or anchor data point missing)
   - **Does not qualify** — fall back to standard representment

### CE 3.0 qualification logic

The v1 pseudocode had a logic error. Corrected version:

```typescript
function qualifiesForCE30(
  disputedOrder: Order,
  customerHistory: Order[]
): QualificationResult {
  if (disputedOrder.cardNetwork !== "visa") return notApplicable();
  if (disputedOrder.reasonCode !== "10.4") return notApplicable();

  const priors = customerHistory.filter(o =>
    o.id !== disputedOrder.id &&
    !o.disputed &&
    daysBetween(o.createdAt, disputedOrder.createdAt) >= 120 &&
    daysBetween(o.createdAt, disputedOrder.createdAt) <= 365
  );

  if (priors.length < 2) return notQualifying("fewer_than_two_priors");

  // Match between disputed order and each prior, not just among priors.
  const matchPoints: MatchPoint[] = [];

  if (matchesAcross(disputedOrder, priors, "ip")) matchPoints.push("ip");
  if (matchesAcross(disputedOrder, priors, "deviceFingerprint")) matchPoints.push("device");
  if (matchesAcross(disputedOrder, priors, "shippingAddress")) matchPoints.push("shipping");
  if (matchesAcross(disputedOrder, priors, "customerAccountId")) matchPoints.push("account");

  // Visa CE 3.0 requires at least one anchor match (IP or device).
  const hasAnchor = matchPoints.includes("ip") || matchPoints.includes("device");

  if (matchPoints.length < 2) return notQualifying("insufficient_match_points");
  if (!hasAnchor) return notQualifying("no_ip_or_device_anchor");

  return qualifying({
    program: "ce_30",
    matchPoints,
    qualifyingPriors: priors.slice(0, 2), // submit top 2; keep others as supporting
    confidence: confidenceScore(matchPoints, priors),
  });
}

function matchesAcross(disputed: Order, priors: Order[], field: string): boolean {
  // Returns true if disputed.field equals priors[i].field for at least 2 priors.
  const disputedValue = normalize(disputed[field]);
  if (!disputedValue) return false;
  const matchingPriors = priors.filter(p => normalize(p[field]) === disputedValue);
  return matchingPriors.length >= 2;
}
```

The corrections vs. v1: matching is now disputed-vs-prior (not just among priors), the IP/device anchor is enforced, and normalization is explicit (must be implemented per field).

### FPT readiness logic

FPT doesn't require prior transactions, so the check is whether we have *sufficient evidence* across the three categories:

```typescript
function readyForFPT(disputedOrder: Order, sessionData: SessionData | null): FPTReadinessResult {
  if (disputedOrder.cardNetwork !== "mastercard") return notApplicable();
  if (!isFPTReasonCode(disputedOrder.reasonCode)) return notApplicable();
  if (!isFPTRegion(disputedOrder.merchantRegion)) return notApplicable();

  const device = scoreDeviceEvidence(disputedOrder, sessionData);
  const delivery = scoreDeliveryEvidence(disputedOrder);
  const identity = scoreIdentityEvidence(disputedOrder);

  // Mastercard FPT requires evidence across all three categories.
  // We use threshold scoring rather than binary because FPT applies AI risk modeling.
  const allCategoriesPresent = device.score > 0 && delivery.score > 0 && identity.score > 0;
  const overallStrong = (device.score + delivery.score + identity.score) >= 2.0; // out of 3.0

  return {
    program: "fpt",
    categories: { device, delivery, identity },
    ready: allCategoriesPresent && overallStrong,
    submissionChannel: pickBestFPTChannel(merchant),
  };
}
```

The exact scoring is data we'll calibrate against actual outcomes once we have submission data. For v1, conservative thresholds.

### Edge cases

- **Guest checkout:** no `customer.id`; match on email + shipping + device. Lower confidence.
- **Address normalization:** "123 Main St" vs. "123 Main Street" must match. Use a library (libpostal or similar).
- **Multiple shipping addresses:** legit customers ship to work, home, gifts. Don't penalize, but note in confidence score.
- **Subscription orders:** recurring orders may need different treatment under Visa's subscription-specific rules. Flag and handle separately.
- **Digital goods:** no shipping address. Anchor must be IP or device; account ID supports.
- **Refunded prior orders:** exclude (signal of customer friction).
- **B2B orders:** flag, may not fit CE 3.0 patterns. Defer to a later release.

### Data model

```
DisputeQualification
├── id: uuid
├── shop_id: uuid (fk → Shop)
├── shopify_dispute_id: string
├── shopify_order_id: string
├── card_network: enum [visa, mastercard, amex, discover, other]
├── reason_code: string
├── program_evaluated: enum [ce_30, fpt, both, none]
├── ce30_status: enum [qualifies, partial, does_not_qualify, not_applicable]
├── ce30_match_points: [enum [ip, device, shipping, account]]
├── ce30_has_anchor: boolean
├── ce30_qualifying_priors: [shopify_order_id, ...]
├── fpt_status: enum [ready, partial, not_ready, not_applicable]
├── fpt_category_scores: jsonb {device: float, delivery: float, identity: float}
├── confidence: enum [high, medium, low]
├── confidence_reasons: [string, ...]
├── missing_evidence: [string, ...] // for partial states
├── evaluated_at: timestamp
└── evidence_package_id: uuid (fk → EvidencePackage, nullable)
```

### Performance

- Qualification check completes in under 5 seconds (webhook handler timeout)
- Index on `(customer_id, created_at)` and `(email_hash, created_at)` for guest checkout match
- Normalized address and fingerprint hashes stored in a separate table to avoid recompute

### What this pillar does NOT do

- Submit anything to anyone. That's Pillar 3.
- Promise liability shift. The output is "this would qualify *if* submitted through a recognized channel."

---

## 5. Pillar 2 — Evidence Package Generator

### User story

> When a dispute qualifies, I want DisputeDesk to assemble the formatted evidence document automatically, with matching data points clearly highlighted, ready for submission through whatever channel is available.

### Output formats

Two formats per dispute:

1. **CE 3.0 Evidence Package** (for Visa 10.4 disputes that qualify)
2. **FPT Evidence Package** (for Mastercard first-party-fraud disputes that are ready)

Each is a structured PDF with the same general shape:

**Page 1 — Cover & Summary**
- Merchant name, dispute ID, transaction details
- Program invoked
- One-line qualification statement
- Confidence indicator

**Page 2 — Qualification Evidence Table**
For CE 3.0:
- Disputed order row: date, amount, IP, device fingerprint hash, shipping, account ID
- Prior order 1 row: same columns, with matches highlighted (where matched)
- Prior order 2 row: same
- Match summary: "IP (3 of 3 orders), Shipping (3 of 3 orders) — anchor satisfied via IP"

For FPT:
- Three-category breakdown (Device, Delivery, Identity) with evidence per category

**Pages 3+ — Supporting Documentation**
- Order details, tracking, delivery confirmation
- Customer session history (when captured)
- Customer communications
- Any merchant-specific notes

**Final Page — Merchant Statement**
- Template language asserting the customer relationship

### Data model

```
EvidencePackage
├── id: uuid
├── qualification_id: uuid (fk → DisputeQualification)
├── package_type: enum [ce_30, fpt, standard_representment]
├── pdf_url: string (signed S3 URL)
├── pdf_generated_at: timestamp
├── language: enum [en, pt, es, fr, de, it]
├── submitted_through: enum [shopify_dispute_api, manual_acquirer, ethoca, verifi, not_submitted]
├── submitted_at: timestamp (nullable)
├── submission_response: jsonb (nullable)
└── outcome: enum [pending, won, lost, withdrawn, unknown] (nullable)
```

### Localization

Templates in i18n files for all 6 DisputeDesk languages. Numbers (IPs, transaction IDs) stay native. Merchant chooses submission language based on their acquirer region.

### Technical

- PDF generation: Puppeteer in a container or Lambda, HTML templates
- Templates versioned; track which template version generated each package
- Cache PDFs; regenerate only when underlying data changes
- Signed URLs with short TTL
- Never include card numbers, CVV, or other PCI-restricted data

### What this pillar does NOT do

- Submit anything. Output is a PDF + structured data.

---

## 6. Pillar 3 — Submission Router

This is where the v1 plan was most wrong. v2 is honest about what's actually available.

### Available channels and when to use them

| Channel | What it is | CE 3.0 | FPT | Available to DisputeDesk today? |
|---|---|---|---|---|
| Shopify dispute evidence API (uncategorized_text + uncategorized_file) | Best-effort: pass CE 3.0/FPT data as free text + PDF attachment through Shopify's standard schema. Routing to CE 3.0 / FPT by Shopify Payments is unconfirmed. | Partial | Partial | Yes |
| Shopify dispute evidence API (structured fields only) | Standard representment — tracking, customer comms, policies. No CE 3.0 / FPT recognition. | No | No | Yes |
| Manual acquirer handoff | Generate package, merchant uploads to their acquirer's VROL/Ethoca portal manually. | Yes | Yes | Yes (workflow only — merchant does the upload) |
| Verifi VROL direct integration | Direct CE 3.0 pre-arbitration submission via Verifi's API. | Yes | No | No — requires commercial Verifi partnership |
| Ethoca Consumer Clarity API | Direct FPT post-dispute submission via Ethoca. | No | Yes | No — requires commercial Ethoca partnership |
| Mastercard 3DS Identity Check Insights | FPT pre-authorization via 3DS Smart Interface. | No | Yes | No — Shopify Payments owns the auth path |

### v1 submission strategy (what we can do today)

1. **Run qualification (Pillar 1) and generate package (Pillar 2)**
2. **For every qualifying dispute, do both:**
   - Submit a best-effort package through the Shopify dispute API, putting the CE 3.0 / FPT structured summary in `uncategorized_text` and the full PDF in `uncategorized_file`
   - Provide the merchant with a downloadable copy and clear instructions for manual acquirer submission if they want belt-and-suspenders
3. **Track outcomes** — record win/loss per channel to learn what works
4. **Be honest in copy:** "DisputeDesk has generated a CE 3.0-formatted evidence package and submitted it through Shopify. For maximum effect, you can also upload this package directly to your acquirer's dispute portal."

### Long-term submission strategy (requires partnerships)

The submission story is the v2 product, not v1. Order of investment:

1. **Verifi partnership exploration** — Verifi runs VROL and is the official CE 3.0 channel. Inquire about merchant-side or app-side integration paths. Likely requires processing volume + commercial relationship.
2. **Ethoca partnership exploration** — Ethoca (Mastercard subsidiary) runs FPT post-dispute. Same approach.
3. **Shopify partnership exploration** — long shot, but worth conversations. If Shopify Payments adds CE 3.0 structured fields, the picture changes for everyone. DisputeDesk would want to be in Shopify's ear about that with merchant demand data.

### Data model

The `submitted_through` field on `EvidencePackage` (defined in Pillar 2) captures which channel was used. A separate `SubmissionLog` table tracks per-channel performance:

```
SubmissionLog
├── id: uuid
├── evidence_package_id: uuid
├── channel: enum
├── submitted_at: timestamp
├── confirmation_id: string (nullable, channel-specific)
├── raw_response: jsonb
├── final_outcome: enum [won, lost, withdrawn, pending, unknown]
├── outcome_recorded_at: timestamp (nullable)
└── notes: text
```

This lets us answer: "When DisputeDesk submits CE 3.0 packages via Shopify uncategorized_text vs. manual acquirer upload, what's the win rate difference?" That's the data that justifies (or kills) future partnership investments.

### What this pillar honestly does in v1

It's mostly a workflow + tracking tool, not an automation engine. The merchant might still need to do something manually. The product value is: the package itself is excellent, the routing decision is made for the merchant, and the outcomes are tracked.

---

## 7. Pillar 4 — Session Evidence Capture

The v1 framing was too aggressive on privacy-sensitive fingerprinting. v2 starts with privacy-safe capture and gates richer fingerprinting on legal review and merchant opt-in.

### v1 capture set (privacy-safe defaults)

Captured automatically when the merchant installs the DisputeDesk app embed / pixel:

- Shopify `cart_token` (the join key to match session to order)
- Session start timestamp
- User agent string
- IP address (hashed at rest, raw available for matching with short TTL)
- IP-derived geo (country, region — coarse)
- Customer account login state at checkout
- Customer ID (if logged in)
- Customer account age (derived from Shopify customer record)
- Pages viewed in this session (via Shopify Web Pixel)
- Time on checkout page

This set is enough to support CE 3.0 IP matching, FPT identity and device coarse signals, and the "is this a returning customer" check that helps confidence scoring.

### v2 capture set (richer, gated on legal review)

Added only after privacy review per region:

- Device fingerprint (canvas, WebGL, audio, fonts — composite hash)
- Mouse / scroll behavioral entropy
- Detailed network signals (ASN, connection type)
- Cross-session linkage via storefront cookie

These are the signals that strengthen FPT Device category and give CE 3.0 a hard device-ID anchor. They're also the most likely to trigger LGPD / GDPR / CCPA scrutiny. Don't ship them in v1.

### Installation

Likely combination, in order of preference:
1. **App embed block** (theme app extension) — merchant toggles on in theme editor
2. **Shopify Web Pixel** — sandboxed event capture for behavioral signals
3. **Checkout UI extension** — order-context capture at checkout

The v1 framing of "without me having to install anything" was wrong. The merchant will need to enable an app embed and approve scopes. Be honest about that.

### Data flow

```
[Storefront]                      [DisputeDesk Backend]              [Shopify]
     |                                    |                              |
     |--privacy-safe session data-------->|                              |
     |   (debounced, on order intent)     |                              |
     |                                    |--store CheckoutSession------>|
     |                                    |                              |
     |                                    |<--orders/create webhook------|
     |                                    |                              |
     |                                    |--match session→order-------->|
     |                                    |   (via cart_token)           |
```

### Data model

```
CheckoutSession
├── id: uuid
├── shop_id: uuid
├── cart_token: string (join key)
├── session_started_at: timestamp
├── order_placed_at: timestamp (nullable)
├── shopify_order_id: string (nullable)
├── ip_hash: string (sha256 of raw IP + per-shop salt)
├── ip_raw: string (encrypted, decryptable for matching, 18-month TTL)
├── ip_geo: jsonb (country, region only in v1)
├── user_agent: string
├── customer_id: string (nullable)
├── customer_account_age_days: int (nullable)
├── session_history: jsonb (page views, time on page)
├── retention_expires_at: timestamp (18 months default)
└── consent_signals: jsonb (DNT, GPC, etc.)
```

### Privacy & compliance

Non-negotiable:

- Disclosed in merchant privacy policy — provide template language
- Honor Do Not Track and Global Privacy Control signals
- Auto-delete session data 18 months after collection (covers the 365-day CE 3.0 window plus buffer)
- Hash IPs at rest; decrypt only for matching during qualification
- Never capture form input *values*
- Merchant-facing data export and deletion API for handling subject access requests
- Brazil LGPD: register as data processor on behalf of the merchant; merchant is controller

### Why this pillar still matters even though submission is gated

Every dispute that lands today on a merchant *without* checkout capture has limited CE 3.0 / FPT eligibility because the matching data isn't there. Capture is a forward-looking investment: it doesn't help with disputes filed before install, but it builds the evidence base for every dispute after install. Without capture, CE 3.0 qualification rate stays low because matching data is sparse.

---

## 8. Pillar 5 — Ratio & Compliance Dashboard

Largely unchanged from v1, but moved later in the build sequence because it's a derivative of the other pillars.

### Core widgets

**Current ratios strip:**
- Displayed Shopify chargeback rate
- Calculated VAMP ratio
- Calculated Mastercard ECM ratio
- Calculated Mastercard EFM ratio
- Each with status color (green / yellow / red) keyed to threshold proximity

**VAMP ratio trend chart:** 12-month line chart, threshold line at 1.50%, optional counterfactual line showing "ratio without DisputeDesk wins"

**Monthly impact summary:**
- Disputes qualified for CE 3.0 / FPT
- Packages submitted
- Wins (by channel)
- Estimated VAMP transactions removed
- Estimated VAMP enforcement fees avoided ($8/transaction)
- Estimated recovered revenue

**Threshold alerts:**
- Yellow warning when ratio approaches 80% of threshold
- Red alert when within 20% of threshold or above
- Email + in-app notification

### Calculations

VAMP ratio per Visa fact sheet:
```
VAMP_ratio = (count(TC40_fraud) + count(TC15_disputes)) / count(TC05_settled)
```

Approximated from Shopify data with documented caveat:
- "TC40_fraud" ≈ disputes with `reason: fraudulent` and `kind: chargeback`
- "TC15_disputes" ≈ all other disputes
- "TC05_settled" ≈ all paid orders excluding refunds/voids

Excluded from numerator when applicable:
- Disputes won via documented CE 3.0 submission
- Disputes resolved via RDR
- Disputes won via documented FPT submission

Always shown as "calculated estimate" — only the acquirer has the authoritative number. The dashboard is a working approximation, not an audit.

### Data model

```
RatioSnapshot
├── id: uuid
├── shop_id: uuid
├── period_month: date
├── settled_count: int
├── tc40_count: int
├── tc15_count: int
├── vamp_ratio_calculated: float
├── ce30_excluded_count: int
├── fpt_excluded_count: int
├── rdr_excluded_count: int
├── mc_ecm_chargeback_count: int
├── mc_ecm_ratio: float
├── mc_efm_fraud_count: int
├── mc_efm_ratio: float
└── calculated_at: timestamp
```

Nightly batch job.

---

## 9. Technical architecture

### High-level

```
                    ┌─────────────────────────┐
                    │  Shopify Storefront     │
                    │  ┌───────────────────┐  │
                    │  │ App Embed +       │──┼──┐
                    │  │ Web Pixel         │  │  │ session data
                    │  └───────────────────┘  │  │
                    └─────────────────────────┘  │
                                                  ▼
┌─────────────────────────────────────────────────────────────┐
│                  DisputeDesk Backend                         │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Ingestion    │  │ Qualification│  │ Evidence         │  │
│  │ (webhooks +  │─▶│ Engine       │─▶│ Generator        │  │
│  │  pixel data) │  │              │  │ (PDF)            │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│         │                  │                   │             │
│         ▼                  ▼                   ▼             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Postgres + S3                            │   │
│  └──────────────────────────────────────────────────────┘   │
│         │                  │                                 │
│         ▼                  ▼                                 │
│  ┌──────────────┐  ┌──────────────────┐                    │
│  │ Submission   │  │ Ratio Calculator │                    │
│  │ Router       │  │ (nightly job)    │                    │
│  └──────────────┘  └──────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────┐
│ Shopify Dispute  │
│ Evidence API     │ ← only channel available in v1
└──────────────────┘
   (Verifi VROL,
    Ethoca API:
    future)
```

### Stack

- App framework: existing DisputeDesk Shopify embedded app
- Backend: existing stack
- Database: Postgres
- Queue: BullMQ or SQS
- PDF: Puppeteer in Lambda or container
- Pixel/embed CDN: Cloudflare (latency budget 50ms)

### Key Shopify APIs

| API | Use |
|---|---|
| `disputes/create` webhook | Trigger qualification |
| `orders/create` webhook | Match session to order |
| GraphQL Admin — `order(id)` | Disputed order context |
| GraphQL Admin — `customer(id).orders` | Prior orders for qualification |
| GraphQL Admin — `disputeEvidenceUpdate` mutation | Submit evidence (legacy schema only) |
| `stagedUploadsCreate` mutation | Upload file evidence |
| Web Pixel API | Behavioral capture |
| Checkout UI Extension | Order-context capture |

### Data source truth table

| Data point | Available from Shopify? | Available from pixel? | Needed for CE 3.0? | Needed for FPT? | Reliability |
|---|---|---|---|---|---|
| Customer ID | Yes (logged in) | Inherited | Yes | Yes | High |
| Email | Yes | Inherited | Supporting | Supporting | High |
| IP address | Order `client_details` | Yes | Yes (anchor candidate) | Yes (Device cat.) | Medium |
| Device fingerprint | No | Yes (v2 capture only) | Yes (anchor candidate) | Yes (Device cat.) | Medium–High |
| Shipping address | Yes | No | Yes (physical goods) | Yes (Delivery cat.) | High |
| Billing address | Yes | No | Supporting | Yes (Identity cat.) | High |
| Prior undisputed orders | Yes | No | Yes (required) | Supporting | High |
| Tracking / delivery confirmation | Via fulfillment APIs | No | Supporting | Yes (Delivery cat.) | Medium |
| Account login state | Yes | Yes | Yes | Yes (Identity cat.) | Medium |
| Account age | Derived from `customer.created_at` | No | Supporting | Yes (Identity cat.) | High |
| Session behavior | No | Yes (privacy-safe v1) | Supporting | Yes (Device cat.) | Medium |

### Failure modes

| Failure | Handling |
|---|---|
| Shopify webhook delivery delayed | Idempotency key, retry, hard alert at T-72h before evidence deadline |
| Pixel data missing for a dispute | Fall back to order-level data; flag as "partial qualification" |
| Shopify dispute API rejects submission | Log raw response, alert merchant, offer manual handoff |
| Customer changed email between orders | Use customer ID if logged in; else device fingerprint or IP linkage |
| Address mismatch from minor variation | Normalize (libpostal); flag near-matches for human review |
| Shopify changes dispute evidence schema | Versioned templates; alert and retest on API version updates |
| Pixel breaks merchant checkout performance | Async load, 50ms hard timeout, fail-open (never block checkout) |

---

## 10. Phased rollout

The v1 plan had everything sequential. v2 reflects the reality that submission is gated separately from the rest, so partnership conversations should start in parallel with engineering.

### Phase 1 — Qualification Engine (Weeks 1–6) — `EPIC-LSE-1`
Engineering:
- Shopify webhook ingestion for disputes
- CE 3.0 qualification logic (with corrected match-anchor rules)
- Internal dashboard showing qualification results
- 5–10 friendly beta merchants

In parallel:
- Begin Verifi partnership conversations
- Begin Ethoca partnership conversations
- Begin Shopify Partners outreach

### Phase 2 — Evidence Generator + Best-Effort Submission (Weeks 7–12) — `EPIC-LSE-2`
Engineering:
- PDF generation for CE 3.0 packages
- Best-effort submission via Shopify dispute API (uncategorized fields)
- Manual handoff workflow + merchant-facing acquirer upload instructions
- EN + PT-BR localization (other languages later)
- Win/loss tracking per channel

### Phase 3 — FPT Readiness (Weeks 13–18) — `EPIC-LSE-3`
Engineering:
- Mastercard first-party-fraud reason code detection
- FPT readiness scoring (three-category framework)
- FPT evidence package generator
- Manual handoff workflow for FPT

In parallel:
- Continue Ethoca conversations
- If Verifi partnership progressing, design direct submission integration

### Phase 4 — Session Capture (Weeks 19–26) — `EPIC-LSE-4`
Engineering:
- App embed block
- Shopify Web Pixel for behavioral capture
- Checkout UI extension
- Match-back logic
- Privacy-safe capture set (v1 set only)

Legal:
- LGPD / GDPR / CCPA review
- Merchant privacy policy templates
- Subject-access / deletion API

### Phase 5 — Dashboard + Polish (Weeks 27–32) — `EPIC-LSE-5`
Engineering:
- VAMP / EFM / ECP ratio widgets
- Threshold alerts
- Counterfactual impact line
- Remaining four languages
- Public launch

### Phase 6 — Direct Network Submission (Weeks 33+ or whenever partnerships close) — `EPIC-LSE-6`
- Verifi VROL integration when available
- Ethoca Consumer Clarity integration when available
- Migrate eligible merchants from best-effort to direct submission

### Honest timeline note

The v1 plan said 28 weeks. v2 says 32 weeks for Phases 1–5 — and that excludes the partnership-gated submission work, which has its own unpredictable timeline. The reviewer was right that 28 weeks was aggressive. Plan for 9–10 months to a full public launch with all five core pillars, and treat Phase 6 (direct submission) as a continuous parallel effort that may not deliver until year 2.

---

## 11. Open questions

These need to be resolved during or before the relevant phase:

1. **Does Shopify Payments backend route any evidence as CE 3.0 today?** Even without structured app fields. Answerable via Shopify Partner support inquiry — Phase 1.
2. **Does Stripe (Shopify Payments' underlying processor) support CE 3.0 routing for its direct customers?** If yes but Shopify doesn't expose it, that's a "Shopify is the bottleneck" story we should document and use to lobby. Answerable via Stripe documentation review — Phase 1.
3. **What does Shopify's December 2025 "AI-powered defense" feature actually do?** Is it competition, complementary, or both? Answerable via direct testing on a beta store — Phase 1.
4. **Verifi VROL access requirements for a third-party app.** Answerable via direct outreach — start in Phase 1.
5. **Ethoca data partner enrollment for a third-party app.** Answerable via direct outreach — start in Phase 1.
6. **FPT scoring calibration.** Mastercard's AI risk model is opaque. We'll need real submission outcomes (post-Phase 3) to tune category scoring.
7. **Subscription / recurring billing CE 3.0 rules.** Visa publishes separate guidance for subscriptions. Read in Phase 2.
8. **B2B / high-AOV merchant patterns.** May not fit CE 3.0's "2 prior transactions" rule cleanly. Defer to a separate enterprise track.

---

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Shopify adds CE 3.0 fields and commoditizes Pillars 1–2 | Medium | Medium–High | Move fast; build the Verifi/Ethoca partner moat; lean into PT-BR / LATAM positioning where Shopify is weaker. |
| Shopify "AI-powered defense" expands into CE 3.0 / FPT before we do | Medium | High | Be the better, more transparent option. Shopify's AI is a black box; DisputeDesk shows the merchant exactly what's submitted and why. |
| Verifi / Ethoca partnerships take 12+ months or never close | Medium | Medium | The product is valuable as readiness + best-effort even without direct submission. Worst case, we remain a workflow + intelligence tool. |
| Visa or Mastercard changes program rules mid-build | Medium | High | Encode rules as data, not hardcoded logic. Subscribe to Visa Business News and Mastercard developer updates. |
| Pixel breaks merchant checkout | Low | Very High | Async load, 50ms timeout, fail-open. Comprehensive monitoring. |
| LGPD / GDPR enforcement action | Low | Very High | Pre-launch legal review. Conservative defaults in v1. Clear merchant docs. |
| Merchants don't understand the value | High | Medium | Newsletter (April / May issues onwards) builds the education layer. Marketing emphasizes "stay off Visa's watch list" over "recover money." |
| Competitor (Chargeflow, Disputifier, Signifyd, Riskified) ships parity | Medium | Medium | The Brazil / PT-BR positioning is a 12–24 month moat. The depth of CE 3.0 / FPT readiness (vs. generic "automated representment") is the technical moat. |

---

## 13. Positioning

### Internal name
Liability-Shift Engine

### Public-facing pitch
> DisputeDesk identifies when a dispute is not just fightable, but liability-shift eligible. Instead of sending generic evidence and hoping for a win, DisputeDesk checks whether the cardholder's prior purchase history, device signals, delivery proof, and account history meet the stricter rules used by Visa Compelling Evidence 3.0 and Mastercard First-Party Trust to reject first-party fraud claims. We generate the qualifying evidence package, submit it through the best available channel, and track outcomes so you know what's working.

### What we don't claim
- "We guarantee liability shift" — we can't, because the issuer decides
- "We submit CE 3.0 / FPT directly to the network" — we don't have that access in v1, and saying so would be misleading
- "Our AI wins disputes" — the AI competition is crowded; the differentiator is the program-specific rule logic, not generic AI

### What we do claim
- We are the only Shopify-native tool that qualifies disputes against CE 3.0 and FPT rules
- We generate evidence packages formatted for those programs
- We submit through every channel available and track outcomes per channel
- We tell merchants exactly what we sent and why
- We're bilingual EN + PT-BR from launch, with four more languages on roadmap

---

## 14. Notes to self

- Newsletter education layer (April / May 2026 issues onwards) is directly tied to this product. Every issue teaches a concept this feature uses. Funnel.
- The biggest risk is Shopify expanding their AI-powered defense feature into CE 3.0 / FPT territory before we do. Move fast on Phases 1–3.
- The PT-BR / Brazil moat is structural — FPT launched in LATAM, no PT-BR-native tool exists, you're physically in Rio. Don't deprioritize this just because EN is "the default."
- Don't overbuild Phase 5 (dashboard) before Phases 1–4 are working. The dashboard is the marketing artifact; the qualification + evidence engine is the value.
- Partnership conversations (Verifi, Ethoca, Shopify) take months. Start them in week 1, not when engineering is "ready."
- Revisit open questions every 2 weeks during build.
- v2 is much more honest than v1. Don't slide back into v1's overconfidence when writing marketing copy.

---

## 15. Epic breakdown

The PRD is broken into seven epics under the `LSE-` track (Liability-Shift Engine). LSE-0 is foundational (pre-Phase 1); each remaining phase in §10 maps to one epic. All epic files live under [`docs/epics/`](epics/):

| Epic | Phase | Title | Detail doc |
|------|-------|-------|------------|
| **LSE-0** | Pre-Phase 1 (Weeks 0–4) | Network Reason Code Foundation | [EPIC-LSE-0-reason-codes.md](epics/EPIC-LSE-0-reason-codes.md) |
| **LSE-1** | Phase 1 | CE 3.0 Qualification Engine | [EPIC-LSE-1-qualification-engine.md](epics/EPIC-LSE-1-qualification-engine.md) |
| **LSE-2** | Phase 2 | Evidence Package Generator + Best-Effort Submission | [EPIC-LSE-2-evidence-package.md](epics/EPIC-LSE-2-evidence-package.md) |
| **LSE-3** | Phase 3 | FPT Readiness | [EPIC-LSE-3-fpt-readiness.md](epics/EPIC-LSE-3-fpt-readiness.md) |
| **LSE-4** | Phase 4 | Session Evidence Capture | [EPIC-LSE-4-session-capture.md](epics/EPIC-LSE-4-session-capture.md) |
| **LSE-5** | Phase 5 | Ratio & Compliance Dashboard | [EPIC-LSE-5-ratio-dashboard.md](epics/EPIC-LSE-5-ratio-dashboard.md) |
| **LSE-6** | Phase 6 | Direct Network Submission | [EPIC-LSE-6-direct-submission.md](epics/EPIC-LSE-6-direct-submission.md) |

**LSE-0 is a horizontal foundation, not a Phase 0 of CE 3.0.** It adds Visa- and Mastercard-network-level reason codes (10.x / 11.x / 12.x / 13.x and 48xx) — replacing today's reliance on Shopify's coarse 14-value enum (`FRAUDULENT`, `PRODUCT_NOT_RECEIVED`, …) for submission phrasing and evidence-checklist tailoring. The current rebuttal engine collapses multiple Visa reason codes (13.1, 13.2, 13.3, etc.) into a single `PRODUCT_NOT_RECEIVED` template, which is lossy. LSE-0 makes the rebuttal speak the issuer's actual language, retroactively improves the standard representment flow, and is a prerequisite for LSE-1's CE 3.0 detection (Visa 10.4) and LSE-3's FPT detection (Mastercard 4837 / 4863).
