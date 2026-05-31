# Guided Shopify Admin click demo — built to convert merchants to install DisputeDesk

## Context

Shopify's App Store submission form has an optional **Demo store URL** that lets a prospective merchant click through and see the app before installing. Empirically merchants are more likely to install apps with one filled in.

The decision: **skip the real Shopify dev store**, build a self-contained guided click-through demo of the embedded experience hosted at `demo.disputedesk.app`. Stale data is fine. No real orders, no real checkout. Visitors land on the strongest auto-built dispute, are guided through the value path, and every CTA funnels toward installing on their own store.

The demo is **not** a static product preview — it's a guided conversion surface. A merchant who spends 60 seconds inside it should walk away understanding what DisputeDesk does, what it automates, what they still control, and why to install today.

### Research findings (what informed the plan)

1. **Shopify policy** — Best-practices doc wording is *"Provide a link to a development store that showcases your app. Link directly to the page that best demonstrates your app's functionality."* It says development store but does **not** prohibit a non-Shopify URL. The Partners form accepts any HTTPS URL. Multiple App Store apps (PayWhirl's `demo.paywhirl.com`, Debutify's `debutify.com/demo`) already do this. **Conclusion: hosting on our own domain is allowed.**

2. **What successful apps do** — three patterns:
   - **A — real dev store deep-linked.** Common for storefront apps (themes, reviews, page builders). Less useful for backend/automation apps.
   - **B — vendor-hosted demo on own domain.** PayWhirl, Debutify, Fivetran's "Guided Demo." Full-fidelity click-through of the vendor UI.
   - **C — interactive product tour (Arcade / Storylane / Navattic).** Cheap, polished, but breaks the illusion within 2 clicks because every hotspot is scripted.
   - For an automation/backend admin app like DisputeDesk, **Pattern B is the strongest fit** — the value of the app is what's on the screen inside the Shopify Admin iframe.

3. **Best-practice principles to design for:**
   - **Funnel to install.** Every screen needs a persistent "Install on your Shopify store" CTA.
   - **Deep link to the most-impressive page** — not the empty dashboard. Shopify's docs literally say so.
   - **Stale data is fine; empty data is not.** Reviewers spend ~60 seconds. Empty states bounce them.
   - **Don't simulate the storefront — simulate the Admin.** Our value is admin-side.
   - **Pair the demo URL with a 60-second video** (Shopify best-practices recommends 2-3 min listing video). Out of scope here; flagged for follow-up.

### Constraints from the user

- **Self-contained.** Do not refactor the live embedded routes (`app/(embedded)/app/*`). They're tightly coupled to Polaris + App Bridge web components (`<s-page>`, `<s-app-nav>`) + next-intl + Shopify session context — extracting them risks the live app and is multi-day work. Demo routes are built fresh using our existing UI primitives in `components/ui/` (Tailwind + CVA).
- **Hand-built Shopify chrome.** No screenshot-based hacks. `components/demo/AdminShell.tsx` renders top bar + sidebar with Tailwind that reads as "**Shopify-style demo environment**" — explicitly not a pixel-perfect fake of Shopify Admin. Reviewers must not mistake the demo subdomain for actual Shopify.
- **Guided, not just clickable.** A lightweight walkthrough layer (step indicators + contextual callouts) leads the merchant through the value path. Without it, visitors poke around but don't understand the value.
- **Interactive inside DisputeDesk areas.** Inert Shopify sidebar is fine, but DisputeDesk-side buttons ("Review evidence", "Preview defense package", "View submission summary", "See why this case is strong") must reveal real demo content on click — not just navigate or do nothing.

## Recommended approach

### Guided demo behavior (the heart of the plan)

The demo is not only a static product preview. It guides the merchant through the ideal DisputeDesk value path:

1. **Land on the strongest auto-built fraud dispute** (`dp-2401`) — not the dashboard.
2. **Explain what DisputeDesk detected** — dispute reason, risk signals, why the case is strong.
3. **Show collected evidence grouped by strength** — what was auto-pulled from order/payment/fulfillment/customer-history.
4. **Show the generated defense package preview** — the actual PDF-like artifact that gets submitted.
5. **Show automation/review controls** — auto-submit vs review-mode parking, automation rules.
6. **End on a clear install CTA** — the final conversion screen.

Every meaningful page answers four questions visibly:
- What problem does this solve?
- What did DisputeDesk automate?
- What does the merchant still control?
- Why install now?

Implementation: a lightweight walkthrough layer (`components/demo/GuidedTour.tsx`) — step indicator pill at the top ("Step 2 of 6"), dismissible contextual callouts anchored to key UI elements, and a "Next →" button that advances through the path. No hotspots-on-screenshots — the callouts anchor to real, clickable UI.

### Architecture: one new route group, no edits to embedded

```
app/
  (demo)/
    demo/
      layout.tsx              ← AdminShell + GuidedTour wraps every demo page
      page.tsx                ← Dashboard (KPI row + recent disputes + activity)
      disputes/
        page.tsx              ← Disputes list (table view)
        [id]/page.tsx         ← Dispute detail — hero landing page (dp-2401)
      packs/page.tsx          ← Evidence pack library
      analytics/page.tsx      ← Trends widget (one chart, stats)
      settings/page.tsx       ← Visual only; toggles inert
      install/page.tsx        ← Final conversion screen (end of guided path)
```

The `(demo)` route group is **public, no auth, statically rendered** (`force-static`). It does not touch Supabase. It does not call any DisputeDesk API. Each page reads fixture data at build time.

### Fixture content — six disputes covering every capability

In `lib/demo/fixtures/disputes.ts`. Picked to make each page feel populated AND show off DisputeDesk's range:

1. **`dp-2401` — Fraud, Strong auto-built pack** — hero landing page. AVS/CVV match, device fingerprint, IP geolocation, 3DS authenticated. Hero copy: "Auto-built in 4 seconds. Ready to save to Shopify."
2. **`dp-2402` — Product not received, Strong** — delivered + signature tracking, AfterShip events.
3. **`dp-2403` — Subscription / recurring** — policy citation + prior successful charges.
4. **`dp-2404` — Coverage gate (Shopify Protect)** — purple banner: "Covered by Shopify — no action needed."
5. **`dp-2405` — Fatal-loss gate (refund issued)** — amber banner: "Already refunded — chargeback is structurally unwinnable."
6. **`dp-2406` — Weak / review-mode parked** — needs merchant input; demonstrates review workflow.

Dashboard totals (`lib/demo/fixtures/dashboardStats.ts`) computed from these six so numbers stay consistent.

### Shopify Admin facsimile shell

`components/demo/AdminShell.tsx` renders a **Shopify-style demo environment** — visibly admin-shaped but explicitly not a pixel-perfect Shopify clone (a small "DisputeDesk demo · not the real Shopify Admin" tag in the top bar makes this honest):

- **Top bar:** dark `#1A1A1A` strip. Left: Shopify wordmark + fake store-name dropdown ("Demo store") + small "Demo" tag. Right: prominent **"Install DisputeDesk on your Shopify store →"** button.
- **Left sidebar:** ~280 px wide, white background. Standard Shopify Admin items as inert links (Home, Orders, Products, Customers, Marketing, Discounts, Content, Analytics, Apps). **DisputeDesk highlighted under Apps** with the purple shield icon. Inert items show a dismissible "This is a demo — install to explore" toast on click.
- **Main content area:** light grey `#F1F2F4` (matches `EmbeddedAppChrome`), renders the actual demo page underneath the GuidedTour overlay.

Hand-built with Tailwind. Reads as Shopify-style without claiming to be Shopify.

### Fake interactivity inside DisputeDesk areas

Inert Shopify sidebar is fine, but **DisputeDesk-side controls must feel alive**. Each click reveals real demo content, not a "demo only" toast:

- **"Review evidence"** → expands a panel showing the 8 collected evidence items grouped by strength (Strong / Moderate / Supplemental).
- **"Preview defense package"** → opens a modal showing the actual PDF-shaped artifact (rendered as static HTML matching the real `@react-pdf` template).
- **"View submission summary"** → shows the bank-rebuttal narrative + which fields are mapped to which Shopify evidence slots.
- **"See why this case is strong"** → opens a side drawer with the strength breakdown (AVS match, CVV match, 3DS authenticated, fulfillment delivered, prior successful charges).
- **"Needs merchant input"** (on `dp-2406`, the weak dispute) → shows the review-mode checklist of what's missing and what the merchant would need to add.

These are pre-built static views — no real computation. The point is the merchant sees the depth, not just the surface.

### Funnel CTAs (outcome-based copy)

Three pinned CTAs across the demo. Copy is outcome-based — what the merchant *gets*, not what they do:

1. **Top bar, right-aligned** — **"Install DisputeDesk on your Shopify store →"**
2. **Floating bottom-right pill** — **"Try this with your own disputes"**
3. **Inline contextual card** below the auto-built pack on `dp-2401` — **"Want DisputeDesk to prepare cases like this for your store? Install now"**

All three resolve to the same App Store URL via the existing `NEXT_PUBLIC_SHOPIFY_APP_STORE_URL` env (verified by `scripts/verify-app-store-url.mjs`); fallback `https://disputedesk.app/install`.

### Final conversion screen

At the end of the guided tour (Step 6) — and reachable any time via `/demo/install` or by clicking the floating CTA — show a dedicated conversion page:

> **Ready to automate your Shopify chargeback workflow?**
>
> - Auto-build dispute evidence packs from order, payment, fulfillment, and customer history
> - Review before submission — or let DisputeDesk submit automatically when the case is Strong
> - Use automation rules safely with built-in coverage and fatal-loss gates
> - Keep recovered revenue — no success fees, flat monthly plans
>
> **[ Install DisputeDesk from the Shopify App Store → ]**

Below the primary CTA: a small "Not ready? See pricing" link to the marketing site, and three logo placeholders ("Used by 100+ Shopify merchants") to soften the hard close. Page is `components/demo/InstallConversion.tsx`.

### Deployment & domain

- Add `demo.disputedesk.app` as a Vercel custom domain pointing at the same Next.js deployment.
- `middleware.ts` host-based rewrite block: when `host === "demo.disputedesk.app"`, rewrite `/*` → `/demo/*`; on the main `disputedesk.app` host, leave `/demo/*` accessible directly for dev/QA.
- `next.config.js` headers: add a CSP block for `/demo/*` matching marketing-page CSP (no Shopify framing, no App Bridge — this is a public marketing surface).
- `app/(demo)/demo/*` use `export const dynamic = "force-static"` — pure fixtures, CDN-cacheable, near-instant TTFB.
- `robots.txt` allows indexing of the demo subdomain.

### Wiring it into the listing

- In Shopify Partners → Apps → DisputeDesk → **Distribution → Manage listing → Demo store URL**:
  `https://demo.disputedesk.app/disputes/dp-2401`
  (deep-links straight to the Fraud Strong auto-built pack — the hero page).
- Update [`docs/shopify-app-review-checklist.md`](../docs/shopify-app-review-checklist.md) §1 with a Demo store URL bullet + one-paragraph subsection on the hosted-demo decision.
- Update [`docs/technical.md`](../docs/technical.md) with a *Demo subdomain* section: route group, fixture location, deployment notes.

### Critical files

- **New routes:** `app/(demo)/demo/{layout,page,disputes/page,disputes/[id]/page,packs/page,analytics/page,settings/page,install/page}.tsx`
- **New chrome components:** `components/demo/{AdminShell,DemoTopBar,InertSidebar,InstallCTA,DemoToast}.tsx`
- **New guided-tour components:** `components/demo/{GuidedTour,TourStepIndicator,TourCallout}.tsx` — overlay layer driven by a step state (`useTourStep()`).
- **New fake-interactivity components:** `components/demo/{ReviewEvidencePanel,DefensePackagePreview,SubmissionSummaryDrawer,CaseStrengthDrawer,MerchantInputChecklist}.tsx` — pre-built static views unlocked by DisputeDesk-side buttons.
- **New page components:** `components/demo/{DemoDashboard,DemoDisputesList,DemoDisputeDetail,DemoEvidencePack,DemoAnalytics,DemoSettings,InstallConversion}.tsx` — built fresh with `components/ui/` primitives (Tailwind + CVA). Do NOT import from `app/(embedded)/`.
- **New fixtures:** `lib/demo/fixtures/{disputes,packs,dashboardStats,analytics,activity,evidenceItems,defensePackage}.ts`
- **Edited:** `middleware.ts` (host-based rewrite for `demo.disputedesk.app`), `next.config.js` (CSP for `/demo/*`)
- **Docs:** `docs/shopify-app-review-checklist.md`, `docs/technical.md`

### What we are NOT doing (explicit scope guard)

- **No edits to `app/(embedded)/`** — embedded app is live and stable; leave it alone.
- **No `TEST_STORE_DOMAINS` change** — the demo route does not go through `useDemoData()`.
- **No real Shopify dev store**, no `seed-teststore.mjs` run, no Shopify Payments test-mode disputes.
- **No Arcade / Storylane** layer — the demo *is* the product, not a slideshow.
- **No storefront simulation** — admin-side only.
- **No listing video** — separate follow-up.

## Verification

1. `npm run dev` → visit `http://localhost:3000/demo/disputes/dp-2401`. Page renders inside the Admin facsimile with the guided-tour overlay showing Step 1 of 6. No Shopify session needed. Network tab shows zero API calls and zero Supabase calls.
2. Click "Next →" through all six tour steps. Each step's callout is anchored to a real UI element on the page. Step 6 lands on `/demo/install`.
3. On `dp-2401`, click each DisputeDesk-side button — "Review evidence", "Preview defense package", "View submission summary", "See why this case is strong" — each reveals real demo content (panel, modal, drawer), not a generic toast.
4. On `dp-2406` (weak dispute), click "Needs merchant input" → shows the checklist of what's missing.
5. Click through Dashboard → Disputes → each of the six fixture disputes. Every page populated, no empty states, no React errors in console.
6. Click any inert Shopify sidebar item (Home, Orders, Products) → dismissible "this is a demo" toast appears.
7. Click any "Install on your store" CTA from any page → redirects to the App Store listing URL (or `/install` fallback).
8. After Vercel deploy: `curl -I https://demo.disputedesk.app/disputes/dp-2401` returns `200` with `cache-control: s-maxage=…` confirming static generation.
9. Lighthouse on the demo URL ≥ 90 perf / ≥ 95 accessibility.
10. `npm run release:verify` (lint + tsc + vitest + build) passes — the new route group must not regress anything.

## Sources

- [Shopify Dev — Best practices for apps in the Shopify App Store](https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices) — official guidance on demo URL, screenshots, video.
- [Shopify Dev — Submit your app for review](https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review) — install-flow restrictions don't apply to demo URL.
- [PayWhirl Demo Store](https://demo.paywhirl.com/) — vendor-hosted demo on own domain.
- [Debutify Demo](https://debutify.com/demo) — another vendor-hosted demo.
- [Cartcoders — Shopify App Store Listing That Converts](https://cartcoders.com/blog/shopify-apps/shopify-app-store-listing-that-converts/) — screenshot/video/CTA conversion patterns.
- [Shopify Dev — Development stores](https://www.shopify.com/partners/blog/development-stores) — password-bypass on listing-linked dev stores (the alternative we're rejecting).
