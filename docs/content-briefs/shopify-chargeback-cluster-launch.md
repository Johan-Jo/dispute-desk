# Shopify chargeback cluster — launch base (8 pages)

Focused **Shopify** chargeback authority cluster. No mediation, arbitration, small-claims, or generic legal expansion in this batch.

## PART 1 — Audit (seed / typical launch catalog)

**Closest existing “hub-like” article (not a formal pillar type in CMS):**  
`Chargebacks FAQ: Timelines, Fees, and Next Steps` — broad lifecycle and fees; **not** Shopify-admin–first.

**Existing overlap to avoid when generating:**

| Published-style topic (seed slugs) | Risk |
|-----------------------------------|------|
| `chargeback-prevention-checklist` | Prevention checklist vs our **evidence checklist** — keep new page **Shopify evidence fields + submission**, not general prevention. |
| `chargebacks-faq-timelines-fees-next-steps` | Lifecycle/fee explainer — pillar must be **Shopify Admin + Shopify Payments flow**, link to FAQ only for “deeper generic context,” not repeat. |
| `how-to-build-a-chargeback-evidence-pack` | Narrative “how to build” — new **Shopify Chargeback Evidence Checklist** is **scannable checklist + Admin mapping**, not a second long how-to. |
| `chargeback-rebuttal-letter-template` | Template doc — do not merge into issuer-response page; keep issuer page about **Shopify outcomes and next steps**. |

**Decision:** **New** flagship article — `Shopify Chargebacks: The Practical Merchant Guide` — as **`pillar_page`** under **`chargebacks`**. Do **not** remove or rewrite existing articles in this task; **differentiate** via Shopify surface area, internal links, and angles below.

---

## PART 2 & 3 — Eight pages (priority order)

| # | Working title | Type | Primary keyword (draft) |
|---|---------------|------|-------------------------|
| 1 | Shopify Chargebacks: The Practical Merchant Guide | pillar_page | Shopify chargebacks |
| 2 | Chargeback Inquiry vs Chargeback on Shopify | cluster_article | Shopify chargeback inquiry |
| 3 | Issuer Claim in Shopify: What It Means and What to Check | cluster_article | Shopify issuer claim |
| 4 | Issuer Response in Shopify: Why You Won or Lost | cluster_article | Shopify chargeback issuer response |
| 5 | Shopify Protect: What It Covers and What It Doesn’t | cluster_article | Shopify Protect chargebacks |
| 6 | Proof of Delivery Isn’t Always Enough in a Chargeback | cluster_article | Shopify chargeback proof of delivery |
| 7 | Visa Compelling Evidence 3.0 for Shopify Merchants | cluster_article | Visa compelling evidence 3.0 Shopify |
| 8 | Shopify Chargeback Evidence Checklist | cluster_article | Shopify chargeback evidence checklist |

Structured editorial detail lives in **`notes`** JSON on each `content_archive_items` row (see seed script). **Generation metadata** for target length uses database columns **`page_role`**, **`complexity`**, and optional **`target_word_range`** (migration `033`); the seed script sets **`page_role` / `complexity`** per row (pillar + high; support articles + medium; evidence checklist + checklist + medium). The same keys can be supplied inside **`notes`** JSON if columns are empty. Summaries below remain the editorial reference.

---

## PART 7 — Internal linking plan

- **Pillar (1)** → links (descriptive anchors) to **all 7** support URLs.  
- **Support pages** → each links **up** to pillar: “Shopify chargebacks: practical guide” (vary anchor text slightly per page).  
- **Cross-links (natural):**
  - (2) Inquiry vs chargeback ↔ (4) Issuer response  
  - (3) Issuer claim ↔ (4) Issuer response  
  - (6) Proof of delivery ↔ (8) Evidence checklist  
  - (7) CE 3.0 ↔ (8) Evidence checklist  
  - (5) Shopify Protect ↔ (6), (8) where relevant  

Anchor text: use **specific phrases** (e.g. “issuer claim deadline in Shopify Admin,” “Visa Compelling Evidence 3.0 fields”) — avoid repeating “chargeback guide” everywhere.

---

## Brief summaries (editorial)

### 1. Pillar — Shopify Chargebacks: The Practical Merchant Guide
**Purpose:** Single **start here** article for Shopify merchants: how disputes show up in **Shopify Admin**, inquiry → claim → response, deadlines in plain language, when **Shopify Protect** matters, and **hub links** to the seven support articles.  
**Avoid:** Generic “what is a chargeback” essay; duplicating the FAQ article body; long prevention checklist (point to existing prevention content only if needed).

### 2. Chargeback Inquiry vs Chargeback on Shopify
**Purpose:** Disambiguate **inquiry** vs **chargeback** in Shopify’s UI and emails; what merchants should do in each phase.  
**Avoid:** Re-stating full lifecycle (pillar + FAQ).

### 3. Issuer Claim in Shopify
**Purpose:** Define **issuer claim** in Shopify context; what to verify (amount, reason code, evidence window).  
**Avoid:** Generic card-network legal theory.

### 4. Issuer Response in Shopify
**Purpose:** Explain **won/lost** outcomes as shown to merchants; realistic next steps (accept vs appeal if applicable).  
**Avoid:** Duplicating rebuttal letter template content.

### 5. Shopify Protect
**Purpose:** Practical coverage boundaries for **Shopify Protect** vs chargebacks; what merchants still must prove.  
**Avoid:** Marketing hype; fine print without operational takeaway.

### 6. Proof of Delivery Isn’t Always Enough
**Purpose:** Why tracking alone loses disputes; what **strong** evidence looks like for common reason codes **in Shopify**.  
**Avoid:** Rebuilding the full “evidence pack” article.

### 7. Visa Compelling Evidence 3.0 (Shopify)
**Purpose:** CE 3.0 **for operators** using Shopify: what to gather and where it maps in evidence submission.  
**Avoid:** Replacing general Visa legal docs; stay merchant-operational.

### 8. Shopify Chargeback Evidence Checklist
**Purpose:** **Scannable** checklist tied to **Shopify** dispute workflow (not generic chargeback advice).  
**Avoid:** Paraphrasing `how-to-build-a-chargeback-evidence-pack`; keep table/checklist format distinct.

---

## System integration

- Rows are created in **`content_archive_items`** with **`proposed_slug`**, **`priority_score`** (pillar highest), **`status` = `backlog`**, **`primary_pillar` = `chargebacks`**, plus **`page_role`** and **`complexity`** for scalable **target word range** in generation (see `docs/technical.md` CH-7).  
- **One** article generation uses **`executeAutopilotTick`** / **`GET /api/cron/autopilot-generate`** with **`autopilotArticlesPerDay: 1`** so a single tick processes **one** archive row (highest priority).

---

## Recommended title/slug tweaks before generating the remaining 7

- Keep slugs **stable** once published; prefer **short, descriptive** English slugs (already set in seed).  
- If **similarity guard** blocks generation, slightly narrow titles (e.g. add “in Shopify Admin”) rather than changing primary intent.
