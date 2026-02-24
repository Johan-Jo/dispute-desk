# EPIC 9 — Multi-Language Support (i18n)

> **Status:** Pending
> **Week:** 7–8
> **Dependencies:** EPIC 0 (all merchant-facing UI must be stable first)

## Goal

Localize the merchant-facing embedded app so it works in multiple languages. Start with a small set of high-value languages, with infrastructure to add more easily.

## Tasks

### 9.1 — i18n Infrastructure
- Install `next-intl` (or lightweight alternative).
- Create locale JSON files under `messages/`:
  - `messages/en.json` (English — default, extract from existing hardcoded copy)
  - `messages/sv.json` (Swedish)
  - `messages/de.json` (German)
  - `messages/fr.json` (French)
  - `messages/es.json` (Spanish)
- Locale detection strategy:
  - Primary: Shopify shop locale (from shop/update webhook or API).
  - Fallback: browser `Accept-Language` header.
  - Override: merchant setting (store in `shops` table as `locale` column).

### 9.2 — Extract All Hardcoded Copy
- Audit all files in `app/`, `components/`, `lib/constants/copyStrings.ts`.
- Replace every user-facing string with a translation key: `t("disputes.syncButton")`.
- Organize keys by page/feature:
  - `common.*` — shared (buttons, errors, status labels)
  - `disputes.*` — dispute list/detail
  - `packs.*` — pack preview, checklist
  - `settings.*` — policies, rules, billing
  - `save.*` — save-to-shopify flow (compliance-critical copy)

### 9.3 — Polaris Locale Swap
- Swap `enTranslations` in `providers.tsx` for the active locale's Polaris translation bundle.
- Polaris ships translations for: en, fr, de, es, ja, pt-BR, and more.

### 9.4 — Compliance Copy Translations
- The "save evidence" vs "submit" distinction must be maintained in ALL languages.
- Translation review required for `save.*` keys — legal/compliance implications.
- Update CI forbidden-copy grep to check all `messages/*.json` files, not just source code.

### 9.5 — Date/Number Formatting
- Use `Intl.DateTimeFormat` and `Intl.NumberFormat` (built into JS) for:
  - Due dates, timestamps (locale-aware).
  - Currency amounts (dispute amounts, billing prices).
- Don't hardcode date formats like `MM/DD/YYYY`.

### 9.6 — Admin Panel
- Admin panel (EPIC 8) stays English-only for V1 — it's internal.
- Add as future task if needed.

### 9.7 — Database Migration
- Add `locale` column to `shops` table (default: `'en'`).
- Migration: `ALTER TABLE shops ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';`

## Key Files
- `messages/en.json`, `messages/sv.json`, `messages/de.json`, etc.
- `app/providers.tsx` (locale provider setup)
- `lib/i18n/config.ts` (supported locales, detection logic)
- `middleware.ts` (locale detection from Shopify session or header)
- All `app/**/*.tsx` pages (string extraction)
- `lib/constants/copyStrings.ts` (migrate to translation keys)

## Initial Languages
| Language | Code | Reason |
|----------|------|--------|
| English | en | Default |
| Swedish | sv | Home market |
| German | de | Largest EU e-commerce market |
| French | fr | Second-largest EU market + Canada |
| Spanish | es | Large Shopify merchant base |

More languages added based on merchant demand post-launch.

## Acceptance Criteria
- [ ] All merchant-facing UI renders correctly in all supported languages.
- [ ] Locale detected automatically from Shopify shop or browser.
- [ ] Merchant can override locale in settings.
- [ ] Compliance copy ("save evidence" not "submit") correct in all languages.
- [ ] CI forbidden-copy check covers all translation files.
- [ ] Dates and currency amounts formatted per locale.
- [ ] Adding a new language requires only a new `messages/{code}.json` file.
