# DisputeDesk Core Workspace — Product Specification

## A. Executive Summary

DisputeDesk's core product surface — the dispute workspace — must be rebuilt around a single organizing principle: **evidence intelligence, not evidence storage**.

The current product has strong backend infrastructure (conditional evidence requirements, waive flow, audit trail, automation pipeline) but the merchant-facing experience treats dispute response as a filing task rather than a strategic argument. The rebuttal system exists in code but is disconnected from the UI. Evidence is presented as a checklist rather than as support for specific claims. The submission flow doesn't show *what* is being submitted or *why*.

The redesign merges the dispute detail page and evidence pack page into a **unified dispute workspace** with three coherent views:

1. **Case Overview** — what this dispute is, what the status is, what to do next
2. **Evidence & Argument** — what we know, what we're arguing, what supports each claim
3. **Submit & Review** — final preview of exactly what goes to the bank, with override controls

The rebuttal / cover argument becomes a **first-class visible artifact** — not a hidden export. The merchant can see, at any point, the structured argument being built from their evidence. This is the product's strategic differentiator: not just automation, but **explainable dispute intelligence**.

---

## B. Product Thesis

### Why this workspace is the heart of the product

Every merchant interaction with DisputeDesk culminates in one question: *"Is this dispute going to be handled correctly?"* The workspace is where that confidence is built or lost. It's the only surface where the merchant sees the full picture — the dispute facts, the evidence collected, the argument being made, and the submission state.

### Why evidence visibility matters

Merchants don't trust black boxes. When a dispute is lost, the first question is *"What did we submit?"* If the answer is opaque, the merchant loses trust in the platform. When evidence is visible — with provenance, relevance, and quality indicators — the merchant becomes a participant in the process, not a spectator.

### Why showing the reasoning is strategically important

Competitors automate evidence collection. Some generate cover letters. But none make the *reasoning* visible. When a merchant can see "We are arguing that the order was delivered because tracking shows delivery confirmation on March 3" — and see the tracking data right below that claim — they understand the product's value at a visceral level. This is what creates retention and willingness to pay.

### Why the rebuttal layer should be visible throughout

The rebuttal is not a PDF artifact. It's the *translation* of raw evidence into a legal argument. Hiding it until export time means the merchant never sees the most valuable thing DisputeDesk does. The rebuttal should be visible alongside evidence so the merchant can see: this evidence supports this claim. This claim addresses the issuer's reason for the dispute.

---

## C. Recommended Information Architecture

### Decision: Tabbed workspace within the dispute detail route

**Route:** `/app/disputes/:id` (single route, no separate pack page)

The evidence pack detail page (`/app/packs/:packId`) is **absorbed** into the dispute workspace. Merchants no longer navigate to a separate pack page. Instead, the dispute workspace has tabs that progressively reveal depth.

**Top-level tabs:**

| Tab | Purpose | Primary user mode |
|-----|---------|-------------------|
| **Overview** | Triage + status + next action | Fast scan |
| **Evidence** | Evidence by category + argument map | Deep review |
| **Argument** | Structured rebuttal + claim-evidence links | Strategy review |
| **Submit** | Final preview + readiness + action | Decision point |
| **Activity** | Full audit trail + timeline | Governance |

**Why tabs, not pages:** The merchant should never lose context about which dispute they're working on. Tabs keep the dispute header (ID, reason, amount, deadline) persistent. Navigation between evidence review and submission preview is instant — no page loads, no back-button confusion.

**Why not a sidebar layout:** Sidebar layouts work for reference panels but fail for deep review. Evidence items need full-width rendering. The argument map needs space. A sidebar would compress the most important content.

### Tab order rationale

1. **Overview first** — every visit starts with "what's the status?" Most merchants stop here for triage.
2. **Evidence second** — for merchants who want to inspect or add evidence. This is the work surface.
3. **Argument third** — the rebuttal and claim structure. Visible but not the first thing shown (most merchants trust automation).
4. **Submit fourth** — the action tab. Only visited when ready to act.
5. **Activity last** — governance and audit. Important but not operational.

### Persistent elements (outside tabs)

- **Dispute header bar**: ID, reason badge, amount, phase badge, deadline countdown, Shopify link
- **Status banner**: One-line status with primary CTA (contextual: "Add evidence" / "Review & submit" / "Submitted")
- **Page-level back action**: Returns to dispute list

---

## D. Page-by-Page Specification

### D.1 Overview Tab

**Purpose:** Fast operational triage. Answer "what is this, what's happening, what do I do?"

**Users:** All merchants, every visit. Ops teams doing bulk triage.

**State model:** Derived from dispute status + pack readiness + submission state.

**Section order:**

1. **Status Card** (full width)
   - Normalized status with semantic label ("Needs response — evidence ready")
   - Deadline with urgency indicator (green >7d, amber 2-7d, red <48h)
   - Primary CTA button (contextual)
   - Automation badge if auto-handled

2. **Case Summary** (2-column grid)
   - Left: Dispute facts
     - Reason (translated, with family grouping)
     - Phase (inquiry / chargeback)
     - Amount + currency
     - Order name + link
     - Customer name
     - Opened date
   - Right: Response state
     - Evidence completeness (% with bar)
     - Submission readiness badge
     - Pack status
     - Warnings count
     - Waived items count

3. **Argument Preview** (collapsed card, expandable)
   - One-paragraph summary of the rebuttal argument
   - "View full argument →" link to Argument tab
   - If no argument exists: "Generate argument" CTA

4. **Evidence Snapshot** (horizontal cards)
   - Category badges showing what's collected vs missing
   - Format: `✓ Order facts` `✓ Shipping` `⚠ Payment verification` `✗ Customer comms`
   - Click any badge → jumps to Evidence tab, scrolled to that category

5. **Key Dates Timeline** (compact)
   - Order date
   - Dispute opened
   - Evidence last updated
   - Submission date (if submitted)
   - Deadline
   - Resolution date (if resolved)

**Empty state:** "This dispute was just synced. DisputeDesk is analyzing it." + Generate pack CTA.

**Loading state:** Skeleton cards for each section.

**Error state:** Banner with retry action.

### D.2 Evidence Tab

**Purpose:** Deep evidence review. Add, inspect, waive, replace evidence. Understand gaps.

**Users:** Merchants preparing evidence. Ops teams reviewing before submission.

**State model:** From pack checklist_v2 + evidence_items + waived_items.

**Section order:**

1. **Evidence Categories** (vertical stack of expandable category cards)

   Each category is a card with:
   - Category name + icon
   - Item count badge (e.g., "3 items")
   - Relevance indicator for this dispute reason (high / medium / low)
   - Expand to show individual items

   **Categories (in order):**

   | Category | Fields | Source |
   |----------|--------|--------|
   | Order Facts | order_confirmation, billing_address_match | auto_shopify |
   | Payment Verification | avs_cvv_match, payment_details | auto_shopify |
   | Fulfillment & Delivery | shipping_tracking, delivery_proof | auto_shopify |
   | Customer Communication | customer_communication, correspondence | auto_shopify + manual |
   | Policies & Disclosures | refund_policy, shipping_policy, cancellation_policy | auto_policy |
   | Identity & History | customer_tenure, prior_orders, activity_log | auto_shopify |
   | Merchant Evidence | supporting_documents, product_description | manual_upload |

   **Per item within a category:**
   - Label + status badge (Available / Missing / Unavailable / Waived)
   - Priority indicator (Critical / Recommended / Optional)
   - Source badge (From Shopify / Uploaded / From policies)
   - "Why this matters" — one line connecting to dispute outcome
   - Expandable content viewer (show the actual data)
   - Actions: Upload / Replace / Waive / Unwaive

2. **Gaps Analysis** (card below categories)
   - Summary: "2 high-impact items missing, 1 recommended"
   - Each gap: label + why it matters + what to do + source hint
   - Waive buttons inline

3. **Upload Zone** (sticky bottom bar or card)
   - "Add evidence" button → opens file picker
   - Associates upload with a specific evidence field (dropdown selector)
   - Drag-drop support

**Critical design rule:** Evidence items must show their *content*, not just their *label*. A tracking number should be visible. A policy excerpt should be readable. An uploaded file should be previewable. The merchant must be able to verify what's being submitted.

### D.3 Argument Tab

**Purpose:** Show the structured rebuttal / cover argument. Make the reasoning visible.

**Users:** Merchants who want to understand or customize the argument.

**Layout:**

1. **Argument Header**
   - "Dispute Response Argument"
   - Generation status: Auto-generated / Merchant-edited / Not yet generated
   - "Regenerate" button (if auto) / "Edit" button

2. **Argument Map** (the core differentiator — see section F)

   Visual structure showing:

   ```
   ┌─────────────────────────────────────────────────────┐
   │  ISSUER CLAIM                                       │
   │  "Customer claims item was not received"             │
   ├─────────────────────────────────────────────────────┤
   │                                                     │
   │  COUNTERCLAIM 1: Order was shipped and delivered     │
   │  ├─ Evidence: Tracking #1Z999AA... (USPS)      [✓]  │
   │  ├─ Evidence: Delivery confirmed Mar 3          [✓]  │
   │  └─ Strength: Strong                                │
   │                                                     │
   │  COUNTERCLAIM 2: Customer was notified               │
   │  ├─ Evidence: Shipping confirmation email       [✓]  │
   │  ├─ Evidence: Delivery notification             [⚠]  │
   │  └─ Strength: Moderate (missing delivery notif)      │
   │                                                     │
   │  COUNTERCLAIM 3: Shipping policy was disclosed       │
   │  ├─ Evidence: Policy snapshot from store         [✓]  │
   │  └─ Strength: Strong                                │
   │                                                     │
   └─────────────────────────────────────────────────────┘
   ```

3. **Rebuttal Text** (below the map, editable)

   Structured sections, not one monolithic paragraph:

   - **Summary** — 2-3 sentence overview
   - **Per-claim sections** — each counterclaim becomes a paragraph, with inline evidence references: "As shown in [Tracking Confirmation], the order was shipped via USPS..."
   - **Conclusion** — closing statement

   Each section has:
   - Editable text area
   - "Auto-generated" / "Merchant-edited" indicator
   - Evidence links (clickable, scrolls to Evidence tab)

4. **Argument Strength Summary**
   - Overall: Strong / Moderate / Weak
   - Per-claim breakdown
   - Missing evidence that would strengthen the case

### D.4 Submit Tab

**Purpose:** Final review and submission action. The merchant sees exactly what will be sent.

**Users:** Merchants ready to submit. Ops teams approving submissions.

**Layout:**

1. **Readiness Assessment** (full-width card)
   - Submission readiness badge: Ready / Ready with warnings / Blocked
   - Completeness score
   - If warnings: list of warnings with severity
   - If blocked: list of blockers with resolution actions

2. **Submission Preview** (the critical section)

   Show exactly what will be sent to Shopify, field by field:

   | Shopify Field | Content Preview | Source |
   |--------------|-----------------|--------|
   | Shipping Documentation | "Tracking: 1Z999AA... (USPS), Delivered Mar 3" | Auto |
   | Customer Communication | "Order confirmation email sent Jan 15..." | Auto |
   | Refund Policy | "30-day return policy, accepted at checkout..." | Policy |
   | Cancellation Rebuttal | "The order was delivered as confirmed by..." | Generated |
   | Access Activity Log | "Customer account created Jan 2023, 12 prior orders" | Auto |

   Each row shows:
   - Shopify evidence field name
   - Content preview (truncated, expandable)
   - Source indicator
   - Include/exclude toggle

3. **Excluded Evidence** (collapsed)
   - Items present but not being submitted
   - Reason for exclusion
   - "Include" action

4. **Override Section** (if warnings present)
   - Warning message explaining risk
   - "Submit anyway" button with required reason selection
   - Audit note field

5. **Action Bar** (sticky bottom)
   - Primary: "Submit to Shopify" (or "Submit with warnings")
   - Secondary: "Export PDF" / "Save draft"
   - Disabled states with reason tooltips

6. **Post-Submit State**
   - Success: "Evidence submitted to Shopify" + "Open in Shopify Admin" link
   - Read-only view of what was submitted
   - Timestamp and actor

### D.5 Activity Tab

**Purpose:** Full audit trail and governance. Who did what, when, and why.

**Users:** Merchants reviewing history. Admins auditing actions. Support debugging.

**Layout:**

1. **Event Timeline** (full-width, chronological)
   - Each event: timestamp, actor badge (System / Merchant / Shopify), event description, expandable payload
   - Event types grouped by category with icons:
     - Evidence events (added, removed, waived, unwaived, replaced)
     - Argument events (generated, edited, regenerated)
     - Submission events (attempted, succeeded, failed, overridden)
     - Status events (status changed, synced, closed)
     - Admin events (override, policy change)

2. **Filters** (top bar)
   - By event category
   - By actor
   - By date range

3. **Override Log** (highlighted section if overrides exist)
   - Each override: who, when, what warning was overridden, reason given
   - Visually distinct from normal events

---

## E. Argument Map Model

### Structure

For each dispute, the argument map contains:

```typescript
interface ArgumentMap {
  disputeId: string;
  issuerClaim: {
    text: string;           // "Customer claims item was not received"
    reasonCode: string;     // "PRODUCT_NOT_RECEIVED"
    source: "shopify";
  };
  counterclaims: ArgumentNode[];
  overallStrength: "strong" | "moderate" | "weak" | "insufficient";
  generatedAt: string;
  editedByMerchant: boolean;
}

interface ArgumentNode {
  id: string;
  claimText: string;        // "Order was shipped and delivered"
  whyItMatters: string;     // "Delivery confirmation is the strongest defense..."
  supportingEvidence: EvidenceLink[];
  gaps: EvidenceGap[];
  strength: "strong" | "moderate" | "weak";
  rebuttalParagraph: string; // The actual text that goes in the response
}

interface EvidenceLink {
  evidenceField: string;     // "shipping_tracking"
  label: string;             // "USPS Tracking #1Z999AA..."
  status: "available" | "waived";
  relevance: "direct" | "supporting";
}

interface EvidenceGap {
  evidenceField: string;
  label: string;
  impact: "would_strengthen" | "would_help" | "nice_to_have";
  suggestion: string;        // "Upload delivery photo if available"
}
```

### Reason-to-Argument Templates

Each dispute reason produces a default argument structure:

**PRODUCT_NOT_RECEIVED:**
1. Counterclaim: "Order was shipped and delivered" → shipping_tracking, delivery_proof
2. Counterclaim: "Customer was notified of shipment" → customer_communication
3. Counterclaim: "Shipping terms were disclosed" → shipping_policy

**FRAUDULENT:**
1. Counterclaim: "Transaction was verified" → avs_cvv_match, billing_address_match
2. Counterclaim: "Order was fulfilled to verified address" → shipping_tracking, delivery_proof
3. Counterclaim: "Customer has legitimate purchase history" → activity_log, customer_tenure

**PRODUCT_UNACCEPTABLE:**
1. Counterclaim: "Product matched description" → product_description
2. Counterclaim: "Return/refund policy was disclosed" → refund_policy
3. Counterclaim: "Customer was contacted for resolution" → customer_communication

**SUBSCRIPTION_CANCELED:**
1. Counterclaim: "Cancellation terms were disclosed" → cancellation_policy
2. Counterclaim: "Customer was notified of renewal" → customer_communication
3. Counterclaim: "Service was delivered during billing period" → activity_log

### Visual approach

The argument map should be rendered as **nested cards**, not a tree diagram. Each counterclaim is a card containing its evidence links. The evidence links are inline badges that, when clicked, scroll to the corresponding evidence in the Evidence tab. Strength is shown as a colored indicator (green/amber/red) next to each counterclaim.

### Interaction with rebuttal

The argument map *generates* the rebuttal text. Each counterclaim's `rebuttalParagraph` becomes a section of the final rebuttal. When the merchant edits a paragraph, the argument map updates to show "Merchant-edited" on that node. When evidence changes (new upload, waive), the affected counterclaim's strength recalculates.

---

## F. Missing Evidence & Blockers System

### Blocker levels

| Level | Meaning | Submit allowed? | UI treatment |
|-------|---------|----------------|--------------|
| **Info** | Optional evidence missing | Yes, freely | Gray badge, no banner |
| **Caution** | Recommended evidence missing | Yes, with note | Amber banner, optional note |
| **Critical** | High-impact evidence missing | Yes, with confirmation | Red banner, requires reason |
| **Hard stop** | Platform-mandated blocker | No | Disabled submit, must resolve |

### Per-item explanation

For each missing item, the product shows:

```
┌─ ⚠ AVS/CVV Verification Result ────────────────────┐
│                                                      │
│  WHY: Banks weigh AVS/CVV heavily in fraud cases.    │
│       Cases with matching AVS/CVV have 2x higher     │
│       win rates.                                     │
│                                                      │
│  STATUS: Unavailable — payment gateway did not        │
│          return AVS/CVV codes for this transaction.   │
│                                                      │
│  SOURCE: Would come from Shopify payment data         │
│          (auto-collected when available).              │
│                                                      │
│  IMPACT: Critical for fraud disputes.                 │
│          Optional for other dispute types.             │
│                                                      │
│  ACTIONS: [Waive] [Upload manually] [Add note]        │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## G. Submission Readiness & Override Model

### Readiness states

| State | Condition | CTA | Color |
|-------|-----------|-----|-------|
| `ready` | All critical present/waived | "Submit to Shopify" | Green |
| `ready_with_warnings` | Critical non-blocking missing | "Review & submit" | Amber |
| `blocked` | Blocking items missing | "Resolve blockers" (disabled submit) | Red |
| `submitted` | Already sent to Shopify | "Open in Shopify Admin" | Blue |
| `draft` | Pack not yet built | "Generate evidence" | Gray |
| `building` | Pack in progress | Spinner | Gray |
| `failed` | Build/save failed | "Retry" | Red |

### Override flow

When merchant submits with warnings:

1. **Warning modal** appears:
   - "You are submitting with {N} high-impact items missing"
   - List of missing items with their impact
   - "This may reduce your chances of winning this dispute"

2. **Reason required** (select from list):
   - "I've provided all available evidence"
   - "The missing evidence doesn't apply to this case"
   - "Deadline is approaching — submitting what we have"
   - "Other" (requires note)

3. **Confirmation button**: "Submit anyway"

4. **Audit logged**: `submitted_with_warnings` event with:
   - Missing items at time of submission
   - Override reason
   - Actor
   - Timestamp

5. **Post-submit display**: Submit tab shows amber banner: "Submitted with {N} warnings on {date} by {actor}. Reason: {reason}"

---

## H. PDF/Export Model

### Export sections

1. **Cover Page**
   - DisputeDesk logo + shop name
   - "Evidence Pack — Dispute #{id}"
   - Dispute reason, amount, order reference
   - Generation date
   - Completeness score (color-coded)
   - Argument strength indicator

2. **Case Summary** (1 page)
   - Dispute facts table
   - Response status
   - Key dates

3. **Argument Summary** (1-2 pages)
   - The full rebuttal text
   - Per-claim breakdown with supporting evidence references
   - Argument strength per claim

4. **Evidence Index** (1 page)
   - Table of all evidence items: label, source, status, included/excluded
   - Page references to appendix

5. **Evidence Appendix** (variable)
   - Per-category sections with full evidence content
   - Order data rendered as structured tables
   - Tracking data with carrier/number/dates
   - Policy text (full or truncated with URL)
   - Uploaded files embedded or linked

6. **Waived Items Note** (if any)
   - List of waived items with merchant's reason

7. **Audit Trail** (1-2 pages)
   - Key events: pack created, evidence added, submitted
   - Timestamps and actors

---

## I. Data Model Implications

### New/Modified Entities

```
argument_maps
  id              uuid PK
  dispute_id      uuid FK → disputes
  pack_id         uuid FK → evidence_packs
  issuer_claim    jsonb    { text, reasonCode }
  counterclaims   jsonb    ArgumentNode[]
  overall_strength text    (strong/moderate/weak/insufficient)
  generated_at    timestamptz
  edited_at       timestamptz
  edited_by       text

rebuttal_drafts (rename from pack_narratives for clarity)
  id              uuid PK
  pack_id         uuid FK → evidence_packs
  locale          text
  content         text     (full rebuttal text)
  sections        jsonb    { summary, claims: [{id, text}], conclusion }
  source          text     (GENERATED / MERCHANT_EDITED)
  version         int
  created_at      timestamptz
  updated_at      timestamptz

evidence_requirements (admin-configurable policies)
  id              uuid PK
  reason_code     text     (FRAUDULENT, PRODUCT_NOT_RECEIVED, etc.)
  field           text     (avs_cvv_match, shipping_tracking, etc.)
  priority        text     (critical/recommended/optional)
  blocking        boolean
  expected_source text
  help_text       text
  dismissable     boolean  default true
  created_at      timestamptz
  updated_at      timestamptz

submission_attempts
  id              uuid PK
  pack_id         uuid FK → evidence_packs
  dispute_id      uuid FK → disputes
  method          text     (auto/manual)
  readiness       text     (ready/ready_with_warnings/blocked)
  warnings        jsonb    (missing items at time of submit)
  override_reason text
  override_note   text
  shopify_result  text     (success/failed/uncertain)
  submitted_at    timestamptz
  actor_type      text
  actor_id        text
```

### Existing entities that gain fields

```
evidence_packs
  + argument_map_id  uuid FK → argument_maps (nullable)
  + rebuttal_version int (tracks which rebuttal draft was last submitted)

disputes
  + workspace_last_tab  text (persists merchant's last-viewed tab)
```

---

## J. Implementation Priorities

### MVP (delivers strongest merchant value immediately)

1. **Tabbed workspace** — merge dispute detail + pack detail into unified `/app/disputes/:id` with Overview, Evidence, Submit, Activity tabs
2. **Rebuttal visibility** — surface existing narrative system in a "Rebuttal" section on the Submit tab (no argument map yet)
3. **Submission preview** — show exactly what will be sent to Shopify, field by field, on the Submit tab
4. **Evidence content rendering** — show actual data (tracking numbers, policy text, order details) inside evidence items, not just labels
5. **Override audit** — log warnings-overridden submissions with reason

### Phase 2 (strategic depth)

6. **Argument tab** — full argument map with claim-evidence linking
7. **Structured rebuttal** — section-based rebuttal editor with evidence references
8. **Argument strength scoring** — per-claim strength indicators
9. **Evidence category grouping** — replace flat checklist with category cards
10. **PDF with rebuttal** — include argument summary in export

### Phase 3 (strategic moat)

11. **AI argument generation** — auto-generate counterclaims from dispute reason + evidence
12. **Win-rate correlation** — "cases with this evidence type win X% more often"
13. **Admin evidence policies** — configurable requirement rules per reason code
14. **Submission attempt history** — multiple submission tracking
15. **Template playbooks** — reason-code-specific evidence + argument playbooks

---

## K. Non-Negotiable Design Rules

1. **The merchant must always see what is being submitted and why.** No hidden logic, no opaque automation.

2. **The rebuttal is not an export artifact — it is a visible, editable argument.** If the merchant can't see the reasoning, the product is failing.

3. **"Required" means platform-mandated, not strategically recommended.** Copy must never mislead about what is truly blocking vs. strongly advised.

4. **Every section answers three questions: What is this? What's the status? What should I do?** Passive information displays are not acceptable.

5. **Evidence items show their content, not just their labels.** A tracking number must be visible. A policy must be readable. An upload must be previewable.

6. **Override actions are audited with reasons, always.** The merchant must know they are taking risk, and the system must record that they chose to.

7. **The dispute workspace is one route, not scattered pages.** Context must never be lost when switching between evidence review and submission.

8. **Dead sections are hidden, not shown empty.** If there's no rebuttal yet, show a generation CTA — not an empty text area. If there are no blockers, don't show a "Blockers" section with "None".

9. **Automation is visible, not silent.** If DisputeDesk auto-collected evidence or auto-generated an argument, show the merchant what happened and give them control.

10. **The product must work at zero evidence and at complete evidence.** Empty states, partial states, and complete states all need intentional design.

---

## L. Interaction Model

### Merchant journey: dispute arrives → evidence submitted

```
1. DISPUTE SYNCED
   → Dashboard shows new dispute
   → Merchant clicks → lands on Overview tab

2. OVERVIEW TAB (triage)
   → Sees: reason, amount, deadline, auto-build status
   → If pack exists: sees completeness snapshot
   → If no pack: clicks "Generate evidence pack"
   → Decision: needs attention? → continue to Evidence tab
   → Decision: looks good? → jump to Submit tab

3. EVIDENCE TAB (deep review)
   → Reviews evidence by category
   → Sees gaps with explanations
   → Uploads additional evidence
   → Waives items that don't apply
   → Checks: is everything I can provide here?
   → Moves to Argument tab or Submit tab

4. ARGUMENT TAB (strategy review — Phase 2)
   → Sees structured argument map
   → Reviews each counterclaim + supporting evidence
   → Edits rebuttal text if needed
   → Checks: is the argument strong enough?

5. SUBMIT TAB (action)
   → Sees full submission preview
   → Reviews what will be sent to Shopify
   → Sees warnings if any
   → Clicks "Submit to Shopify"
   → If warnings: override flow with reason
   → Post-submit: read-only confirmation view

6. POST-SUBMIT
   → Overview tab shows "Submitted" status
   → Activity tab shows submission event
   → Merchant waits for Shopify/issuer resolution
   → Dispute status updates via sync
```

### Quick triage path (confident in automation)

```
Dashboard → Dispute Overview → "Submit to Shopify" (if ready) → Done
```

Total: 3 clicks from dashboard to submission for well-automated disputes.

### Deep review path (manual or complex cases)

```
Dashboard → Overview → Evidence → Argument → Submit → Override flow → Done
```

Full investigation flow with every detail inspectable.

---

## M. UX Copy System

### Readiness states
- Ready: "Ready to submit"
- Warnings: "Ready to submit — {N} high-impact items could strengthen your case"
- Blocked: "Cannot submit — {N} required items missing"
- Draft: "Evidence pack not yet generated"
- Building: "Generating evidence pack..."
- Submitted: "Submitted to Shopify on {date}"
- Failed: "Submission failed — retry when ready"

### Blocker messages
- Hard stop: "This item is required by the payment network. Resolve it to unlock submission."
- Critical: "This evidence strongly impacts your chances. Submit without it only if unavailable."
- Caution: "Recommended evidence. Including it may improve your outcome."
- Info: "Optional evidence. Include if easily available."

### Evidence explanations (per field, connecting to outcome)
- Shipping tracking: "Shows the carrier confirmed shipment — required to win 'item not received' disputes"
- AVS/CVV: "Shows card security checks passed — banks weigh this heavily in fraud cases"
- Refund policy: "Shows the customer agreed to your terms — protects against buyer's remorse claims"
- Customer communication: "Shows you attempted to resolve the issue — banks favor merchants who engage"

### Override warnings
- "You are submitting with {N} high-impact items missing. This may reduce your chances of winning."
- "DisputeDesk recommends adding {item} before submitting. Continue only if this evidence is unavailable."

### Submission outcomes
- Success: "Evidence submitted to Shopify. The bank will review your response."
- Failed: "Submission failed. Check your Shopify connection and try again."
- Uncertain: "Evidence was sent but we couldn't confirm delivery. Check Shopify Admin."

### Tone rules
- Professional but not corporate
- Clear but not oversimplified
- Serious but not alarming
- Direct instructions, not passive descriptions
- Always explain "why" alongside "what"
