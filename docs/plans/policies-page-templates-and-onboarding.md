# Plan: Policies Page — Suggested Templates & First-Visit Onboarding

**Current state (as of implementation):** The Policies page has five policy types (Terms, Refund, Shipping, Privacy, Contact). A Policy Library with template cards, “Use Template” and “Upload Your Own,” and Settings → Policy templates (explicit language choice for template text: en, de, fr, es, pt, sv) are implemented. Migrations 025–027; see `docs/technical.md` (Policy Templates & Store Policy Upload).

---

## Goal

When a merchant connects a new store and lands on the Policies page (either by navigating directly or via the setup wizard), they should:

1. **See suggested templates** they can use to define policies.
2. **Clearly understand** they must define policies by either:
   - Using DisputeDesk’s suggested templates, or
   - Uploading their own policy documents.

---

## 1. When to Show the “Define Policies” Experience

**Trigger: “needs to define policies”**

- **Primary:** The shop has **no policy snapshots** for this shop (i.e. `GET /api/policies?shop_id=...` returns an empty list, or we add a small API that returns `{ hasPolicies: boolean }` for the active shop).
- **Optional enhancement:** Support a **referral from the wizard** (e.g. `?from=setup` or step context) so we can show a short “You’re on the Policies step” line and the same templates/upload CTA. Same page, same UX; wizard just deep-links here.

**Result:** One experience for “first time on Policies with no policies” whether they arrived by:
- Clicking **Policies** in the nav, or
- Clicking **Open Policies** in the setup wizard (step: Business Policies).

No separate “wizard-only” Policies view is required; the portal Policies page is the single source of truth.

---

## 2. Suggested Templates — What They Are

**Purpose:** Give merchants ready-made, dispute-friendly policy text they can use as-is or customize, so they can quickly “define” policies even before they have a formal PDF from their lawyer.

**Suggested policy types (align with existing `policy_snapshots` and UI):**

| Type        | Slug/Key   | Used in evidence as   |
|------------|------------|------------------------|
| Refund     | `refunds`  | refund_policy          |
| Shipping   | `shipping` | shipping_policy       |
| Terms      | `terms`    | cancellation_policy   |

(Privacy is shown in the UI but not in `policy_snapshots`; we can add a 4th template for storefront consistency but it won’t be used in packs until we support it in the DB.)

**Template format options:**

- **Option A — Static files (recommended for v1):**  
  One file per template: e.g. `public/policy-templates/refund-policy.md` (or `.html` / `.txt`). Content is short, dispute-oriented boilerplate (return window, conditions, exclusions). Frontend offers “Use template” → open/download/copy, and “Upload your policy” for that type.
- **Option B — Database + i18n:**  
  New table `policy_templates` (id, type, locale, title, body_markdown or body_html). Seed with en-US (and optionally more locales). API `GET /api/policy-templates` returns list; “Use template” fetches body and lets user copy or “Apply” (see below).
- **Option C — Hybrid:**  
  Templates live as static files or in DB; “Use template” either downloads a PDF/DOCX (generated or pre-built) or shows text in a modal with “Copy” / “Download as .txt”.

**Recommendation:** Start with **Option A**: static Markdown (or HTML) files in `public/policy-templates/` or under `content/policy-templates/`, one per type (refund, shipping, terms). No DB migration. Easy to edit and localize later. “Use template” = link to view/download + “Upload your policy” for that type.

**Content of each suggested template:**

- **Refund policy:** Return window (e.g. 14/30 days), eligible items, refund method, exclusions (e.g. final sale), how to request.
- **Shipping policy:** Processing time, carriers, delivery estimates, international vs domestic, tracking, lost package process.
- **Terms of service (dispute-relevant slice):** Payment terms, cancellations, refunds, disputes, limitation of liability (one short paragraph each).

Keep each to ~1–2 short pages so they’re usable in evidence and not overwhelming.

---

## 3. Policies Page Layout (Redesigned)

**A. When the shop has no policies (empty state / first visit)**

1. **Headline + subline**  
   - Headline: e.g. “Define your store policies”  
   - Subline: “Policies are included in dispute evidence. Use our suggested templates or upload your own.”

2. **“Suggested templates” section**  
   - Card or list for each of: Refund Policy, Shipping Policy, Terms of Service (and optionally Privacy).  
   - Per template:
     - Title + 1-line description.
     - Actions: **Use template** (opens or downloads the template so they can copy/adapt or upload after editing), **Download** (if we serve a file).
   - Optional: short “Why these matter for disputes” line above or below the list.

3. **“Or upload your own”**  
   - Primary CTA: **Upload Policy** (existing or new button).  
   - Clarify: “Upload a PDF or DOCX for each policy type below.”

4. **Policy slots (same four as today)**  
   - Terms of Service, Refund Policy, Privacy Policy, Shipping Policy.  
   - Each row: name, type badge, “No policy added” (or placeholder) and actions: **Upload** or **Use template** (for the three we support in snapshots).  
   - When a policy exists (we have a URL from `policy_snapshots`): show Preview / Download as today.

So the flow is obvious: **define policies via templates or upload**, then see the four slots with clear “add” actions until each has a document.

**B. When the shop already has at least one policy**

- Keep the same headline/subline and the **“Suggested templates”** block (collapsed or short) so new merchants who land later still see the option.
- Emphasize the **list of four policy types** with status (added / not added) and Preview/Download where we have a URL.
- “Upload Policy” remains visible for adding or replacing.

**C. Demo mode / no store**

- Keep current behavior (e.g. disabled actions, “Connect your store” messaging). No need to change that in this plan.

---

## 4. Suggested Templates — Implementation Outline

**4.1 Create template content (v1, English)**

- Add 3 (or 4) files, e.g.:
  - `content/policy-templates/refund-policy.md`
  - `content/policy-templates/shipping-policy.md`
  - `content/policy-templates/terms-of-service.md`
  - (optional) `content/policy-templates/privacy-policy.md`
- Content: short, dispute-relevant boilerplate as above. No PII, no store-specific names; placeholders like “[Your store name]” are fine.

**4.2 Expose templates to the frontend**

- Either:
  - **Static:** Next.js serves them from `public/` or we read from `content/` at build time and pass as props or JSON, or
  - **API:** `GET /api/policy-templates` that reads from files or DB and returns `{ templates: [ { type, name, description, url or contentPreview } ] }`.
- Frontend uses this list to render the “Suggested templates” section and “Use template” links.

**4.3 “Use template” behavior**

- **Minimal v1:** Open template in new tab (e.g. `/portal/policies/templates/refunds`) or download a generated/static file so the merchant can edit and re-upload.
- **Better v1:** Template page or modal with “Copy to clipboard” and “Upload your policy” CTA that goes to the same upload flow we’ll use for the policy type.

**4.4 Upload flow (existing or new)**

- Today there is no API that inserts into `policy_snapshots`; the list only reads. Plan should assume we add:
  - **Upload API:** e.g. `POST /api/policies` (or `/api/policies/upload`) with `shop_id`, `policy_type` (`refunds` | `shipping` | `terms`), and file (PDF/DOCX). Server stores file (e.g. in Supabase storage), then inserts a `policy_snapshots` row with `url` pointing to the stored file (or a public URL).
- Policies page then shows “Upload” per type; after upload, that type shows Preview/Download and no longer shows “No policy added.”

(If upload is out of scope for this plan, “Use template” can still link to static content and “Upload” can be a disabled or “Coming soon” CTA until the API exists.)

---

## 5. Wizard Alignment

- **Portal wizard** (e.g. `app/(portal)/portal/setup/[step]/page.tsx`): Step `business_policies` already links to `/portal/policies`. No change needed except that the Policies page itself will now show the new first-visit experience when the shop has no policies.
- **Copy:** Update the step’s “ask” text to something like: “Define your policies using our suggested templates or by uploading your own. When you’re done, come back and click Save & Continue.” So it matches the new messaging.
- **Embedded app** (Shopify): If it uses a different Business Policies step (e.g. form with URLs), that can stay as-is for now; this plan focuses on the portal Policies page and suggested templates there.

---

## 6. Copy and i18n

- Add message keys for:
  - “Define your store policies”
  - “Policies are included in dispute evidence. Use our suggested templates or upload your own.”
  - “Suggested templates”
  - “Use template”, “Download template”
  - “Or upload your own”, “Upload Policy”
  - “No policy added”
  - Per-template short descriptions (e.g. “Standard refund and return terms for dispute evidence.”)
- Reuse existing keys where possible (e.g. “Upload Policy”, policy type names). Add new keys to `messages/en.json` (and other locales as needed).

---

## 7. Implementation Order (Suggested)

1. **Content:** Add the 3 (or 4) suggested template files (Markdown or HTML) under `content/policy-templates/` or `public/`.
2. **API (optional but useful):** `GET /api/policy-templates` returning list of templates with name, type, description, and URL or path for “Use template”.
3. **Policies page — empty state:** When `policy_snapshots` is empty for the shop, show the new layout: headline, “Suggested templates” section (with “Use template” / “Download”), “Or upload your own”, and the four policy slots with “No policy added” + Upload / Use template.
4. **Policies page — with policies:** Keep the four-slot list; add a compact “Suggested templates” section so the two paths (templates vs upload) remain visible.
5. **Upload API + UI:** Implement `POST /api/policies/upload` (or equivalent) and wire “Upload” to it so that after upload, the corresponding slot shows the document and Preview/Download.
6. **Wizard copy:** Update the Business Policies step description to the new “Define your policies…” text.
7. **i18n:** Add all new strings and, if needed, localized template content later.

---

## 8. Success Criteria

- Merchant who just connected a store and opens Policies (direct or via wizard) immediately sees that they must **define policies** and has two clear options: **suggested templates** and **upload**.
- Suggested templates exist for Refund, Shipping, and Terms (and optionally Privacy) and are easy to use (view/copy/download).
- After implementation, “Use template” and “Upload” are the primary actions; once a policy is added, Preview/Download behave as today (with URLs from `policy_snapshots`).

---

## Summary

| Item | Action |
|------|--------|
| **When** | Show new experience when shop has no policy snapshots (and optionally when `?from=setup`). |
| **Templates** | Create 3–4 suggested policy templates (refund, shipping, terms, optional privacy) as static content; expose via route or API. |
| **Page** | Redesign Policies page with “Define your policies”, “Suggested templates” section, and “Or upload your own” + four policy slots with clear add/preview/download. |
| **Wizard** | Keep linking to `/portal/policies`; update step copy to match new messaging. |
| **Upload** | Plan for (or implement) policy upload API and wire to policy_snapshots so Preview/Download work. |

This plan is ready for review. Once you’re happy with it, implementation can start with template content and the empty-state UI, then API and upload flow.
