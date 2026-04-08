# EPIC 10 — Comprehensive User Help System

> **Status:** DONE

## Overview

Knowledge-base-style help center available on both the external portal (`/portal/help`) and the embedded Shopify app (`/app/help`). Articles are authored as structured TypeScript + i18n keys — no external CMS or markdown files required.

## Delivered

### Data Layer

- **`lib/help/categories.ts`** — 6 help categories (Getting Started, Disputes, Evidence Packs, Automation & Rules, Billing & Plans, Saving to Shopify) with icon references and i18n keys.
- **`lib/help/articles.ts`** — 29 articles with slug, category, title/body i18n keys, related article cross-links, and search tags. Includes Evidence pack templates, Defining store policies, Rule presets, and **Installing from the Shopify App Store** (`shopify-app-store-install`).

### Portal Surface

- **`app/(portal)/portal/help/page.tsx`** — Help index with live search (client-side, filters by title + tags), category grid cards, and per-category article listings.
- **`app/(portal)/portal/help/[slug]/page.tsx`** — Article detail page with breadcrumb navigation, paragraph/list rendering, related articles, and back link.

### Embedded App Surface

- **`app/(embedded)/app/help/page.tsx`** — Polaris-based help index with search, category grid, and article listings.
- **`app/(embedded)/app/help/[slug]/page.tsx`** — Polaris article detail with back action, content rendering, and related articles.

### Navigation

- "Help" added to portal sidebar (`portal-shell.tsx`).
- "Help" secondary action added to embedded app dashboard.

### i18n

- Full `help.*` namespace added to `messages/en.json` (titles, bodies, UI strings for all articles).
- Translated into Swedish (`sv`), German (`de`), French (`fr`), and Spanish (`es`).

## Content Highlights

- Help articles in `messages/en-US.json` and `messages/en.json` are updated when product UX changes (e.g. embedded Rules starter rows + **Save starter rules**, activated packs in the setup wizard, template install `activate`); portal Help and embedded Help resolve the same `help.articles.*` keys for shared articles.
- Compliance-critical article: **"DisputeDesk does NOT submit to card networks"** clearly explains the save-vs-submit distinction in all 5 languages.
- **Shopify App Store install** (`shopify-app-store-install`): merchant-facing steps for apps.shopify.com vs website onboarding; embedded override stresses opening the app from Admin.
- **Embedded disputes list UX:** `viewing-filtering-disputes`, `review-queue`, and `approving-disputes` use `help.embedded.articles.*` overrides in `lib/help/embedded.ts` so in-app Help describes the toolbar (Search, Filter, Export, More actions → Sync now), columns aligned with dashboard Recent Disputes (including **View details**), no review-queue tab on the embedded list, and approval on the **dispute detail** page — while portal Help can still describe the portal list (tabs, etc.) via shared `help.articles.*` where they differ.
- Plan comparison article covers Free/Starter/Pro feature and limit breakdown.
- Completeness score article explains thresholds and auto-save behavior.
- Evidence checklist article explains required vs. recommended items per dispute reason.

## Technical Notes

- Zero external dependencies: articles are TypeScript objects with i18n keys resolved at render time via `next-intl`.
- Search is client-side (filter by title + tags), debounce not needed at 25 articles but architecture supports scaling.
- Article body content uses `\n\n` paragraph separators, with basic list detection for rendering.
