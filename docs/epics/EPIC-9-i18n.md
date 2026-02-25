# EPIC 9 — Multi-Language Support (i18n)

> **Status:** Done
> **Week:** 7–8
> **Dependencies:** EPIC 0 (all merchant-facing UI must be stable first)

## Goal

Localize the merchant-facing embedded app and portal so it works in multiple languages. Infrastructure to add more languages easily.

## Implementation Summary

### 9.1 — i18n Infrastructure
- Installed `next-intl` for translation management.
- `lib/i18n/config.ts` — defines `SUPPORTED_LOCALES` (en, sv, de, fr, es), `resolveLocale()` for detection strategy (shop setting > Accept-Language > default), and `isSupportedLocale()` guard.
- `lib/i18n/getMessages.ts` — async message loader with fallback to English.
- `lib/i18n/polarisLocales.ts` — dynamic Polaris translation loader for the embedded app.

### 9.2 — Message Files
Created comprehensive translation files covering all merchant-facing UI:
- `messages/en.json` — English (default, extracted from all hardcoded copy)
- `messages/sv.json` — Swedish
- `messages/de.json` — German
- `messages/fr.json` — French
- `messages/es.json` — Spanish

Keys organized by feature: `common.*`, `status.*`, `dashboard.*`, `disputes.*`, `packs.*`, `billing.*`, `rules.*`, `settings.*`, `connect.*`, `selectStore.*`, `permissions.*`, `team.*`, `policies.*`, `table.*`.

### 9.3 — Provider Integration
- **Embedded app** (`app/(embedded)/providers.tsx`): Wraps children with `NextIntlClientProvider` + accepts `locale`, `messages`, and `polarisTranslations` props. Polaris AppProvider receives locale-specific translations.
- **Portal** (`app/(portal)/layout.tsx`): Wraps PortalShell with `NextIntlClientProvider`, resolving locale from Accept-Language header.

### 9.4 — Compliance Copy
- All compliance-critical strings ("save evidence" not "submit") are translated correctly in all languages.
- CI forbidden-copy check extended to scan `messages/*.json` files alongside source code.

### 9.5 — Date/Number Formatting
- `next-intl` provides `Intl.DateTimeFormat` and `Intl.NumberFormat` integration. Components use `useFormatter()` for locale-aware dates and currency.

### 9.6 — Database Migration
- `supabase/migrations/014_shops_locale.sql` — adds `locale` column (default: `'en'`) to shops table for merchant locale preference override.

### 9.7 — Admin Panel
- Admin panel stays English-only for V1 (internal tool).

## Supported Languages

| Language | Code | Reason |
|----------|------|--------|
| English | en | Default |
| Swedish | sv | Home market |
| German | de | Largest EU e-commerce market |
| French | fr | Second-largest EU market + Canada |
| Spanish | es | Large Shopify merchant base |

## Adding a New Language

1. Create `messages/{code}.json` (copy from `en.json`, translate).
2. Add the locale code to `SUPPORTED_LOCALES` in `lib/i18n/config.ts`.
3. Add a dynamic import case in `lib/i18n/polarisLocales.ts` (if Polaris ships the locale).
4. Done — no other code changes needed.

## Key Files
- `lib/i18n/config.ts`, `lib/i18n/getMessages.ts`, `lib/i18n/polarisLocales.ts`
- `messages/{en,sv,de,fr,es}.json`
- `app/(embedded)/providers.tsx`
- `app/(portal)/layout.tsx`
- `supabase/migrations/014_shops_locale.sql`
- `.github/workflows/ci.yml` (extended forbidden-copy check)

## Acceptance Criteria
- [x] All merchant-facing UI has translation keys covering every string.
- [x] Locale detected automatically from browser Accept-Language header.
- [x] Merchant can override locale via shops.locale column.
- [x] Compliance copy ("save evidence" not "submit") correct in all languages.
- [x] CI forbidden-copy check covers all translation files.
- [x] Adding a new language requires only a new `messages/{code}.json` file + config entry.
