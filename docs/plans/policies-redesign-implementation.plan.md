# Policies Redesign — Implementation Plan

**Status:** Awaiting approval
**Created:** 2026-06-16
**Source:** Claude Design handoff bundle (`Policies Redesign.dc.html` + chat transcript)

## 1. What the design asks for (from the handoff + chat)

The design session landed on a single, decided direction (the user explicitly chose "version A" and, in the final message, stripped it further):

- **Real Shopify policy status is the spine.** One status row per policy: **Live on store** or **Not published**, with the live URL and a next action. Echoes Shopify's own Settings → Policies list.
- **Retire the own / template / mixed flow chooser entirely.** Also remove **templates, file upload, external-URL linking, and the template-language switcher** — none survive. (Rationale from the user: a policy is only valid evidence if it was *published on Shopify at the time of the transaction*, so DisputeDesk-stored text can never be valid; the only meaningful action is to publish on Shopify.)
- **Missing policy → forward to Shopify.** The sole action for a Not-published policy is "Publish in Shopify" → opens the Shopify policy editor. Two-step loop: (1) create & publish in Shopify, (2) refresh to capture as evidence.
- **Auto-sync on page load + manual "Refresh from store" + a "last synced" timestamp.**
- **Two surfaces, one source of truth:** full controls on the **Policies page**; a **condensed** status overview in the **onboarding wizard** with a "Publish missing" CTA and an "I'll finish later" escape.
- **Scope:** the 4 core policies — Returns & Refunds, Shipping & delivery, Privacy, Terms of service.
- **Look:** match the existing DisputeDesk / Shopify-Polaris aesthetic (the design uses the app's existing palette — `#1D4ED8` blue, `#202223`/`#6D7175` text, `#E1E3E5` borders, amber accents for required gaps, green for live). The EstimatePro design system in the bundle is explicitly NOT used.

## 2. Why this is mostly a front-end change

The backend already supports the spine — verified:
- `GET /api/policies?shop_id=…` returns, per policy type, the latest snapshot's `policy_type`, `source`, `published_url`, `captured_at`.
- "Live" = a row exists with `source === 'shopify_published'` (and a `published_url`). "Not published" = no such row.
- `POST /api/policies/refresh` re-ingests `shop.shopPolicies` (auto-sync + manual refresh both call it).
- The publish deep link is the already-fixed `redirectTopLevel(https://admin.shopify.com/store/{handle}/settings/legal)`.

**No DB migration. No new API.** This is a rewrite of one shared component plus copy/i18n and cleanup of now-dead code.

## 3. Scope of work

### 3.1 Rewrite `components/setup/steps/BusinessPoliciesStep.tsx` (the core)
Shared by both surfaces ([app/(embedded)/app/policies/page.tsx](../../app/(embedded)/app/policies/page.tsx) and the onboarding wizard [app/(embedded)/app/setup/[step]/page.tsx](../../app/(embedded)/app/setup/[step]/page.tsx)). Replace the entire own/template/mixed UI with:

- **Data:** on mount, resolve shop → `POST /api/policies/refresh` (auto-sync) → `GET /api/policies` → derive a 4-row status map. Manual **Refresh from store** repeats it. Track `lastSynced`.
- **Full (Policies page) variant:**
  - Summary/sync card: store domain + Connected dot + "Last synced X ago" + Refresh button; "N of 4 policies live" headline, evidence-framing sentence, progress bar.
  - Status list: 4 rows (icon, title, Required/Optional chip, description; Live rows show the clickable storefront URL + green "Live on store" badge; Not-published rows show amber "Not published" + "Publish in Shopify"). Not-published row expands an inline 2-step publish flow ("Open Shopify policy editor" + refresh note).
  - Footer info note.
- **Condensed (onboarding) variant:** centered header, status band (N of 4 live + synced + progress), compact 4-row list, actions row ("Publish missing in Shopify" + "I'll finish later"), "manage anytime from Policies" footnote. Variant chosen by URL (`/setup`) — the generic step-component map passes no extra props.
- **`onSaveRef`:** becomes a no-op that marks the step reviewed (`POST /api/setup/step {reviewed:true}`) so the wizard "Save & Continue" / page "Save" buttons still resolve. Nothing else to persist.

### 3.2 i18n
- Add new keys under `setup.policies.*` (row titles/descriptions, status labels: Live / Not published / Required / Optional, summary copy, sync labels, publish-flow copy, onboarding copy, footer notes) across **all 6 locales** (en/de/es/fr/pt/sv) in the same change.
- Remove now-unused keys (flow chooser, template, upload, URL, language-switcher copy) — or leave them orphaned? **Decision needed (see §6).**

### 3.3 Dead-code cleanup (after the UI no longer references them)
Now unused by the new flow:
- `POST /api/policies/apply` (template draft writer), `POST /api/policies/upload`, `GET /api/policies/content`, `GET /api/policy-templates/[type]/content`, `GET /api/policy-templates`, `PATCH/GET /api/shop/policy-template-lang`.
- `lib/policy-templates/`, `content/policy-templates/`, the `policy_template_lang` column usage.
- The template-language switcher + preview modal (gone with the rewrite).

**Recommendation:** do the UI rewrite + i18n first (the visible deliverable), then a *separate* cleanup commit for the dead routes/assets so the risky deletion is isolated and easy to review/revert. The design chat itself notes "the template/apply/upload routes can be retired."

### 3.4 Docs
Update `docs/technical.md` policies section to describe the status-list spine and the retirement of templates/upload/URL.

## 4. What I will NOT change
- The published-policy ingest, `policy_snapshots` schema, the collector, the PDF disclosure line, the scope/re-auth work — all stay. This is purely the merchant-facing policies UI.
- The portal policies page (`app/(portal)/portal/policies/page.tsx`) is a different component/surface — out of scope unless you want it aligned too (it can be a follow-up).

## 5. Verification
- `npm run release:verify` (lint, tsc, i18n parity, vitest, build) green.
- Manual on dev: Policies page shows the 4-row status list reflecting real `shop.shopPolicies` (live rows with URLs, missing rows with Publish CTA); Refresh updates "last synced"; the onboarding step shows the condensed variant with "finish later"; "Publish in Shopify" / "Open Shopify policy editor" deep-link lands on `…/settings/legal`.
- I cannot click the deep link headlessly — that final check is yours (consistent with prior sessions).

## 6. Decisions I need from you before building

1. **Dead-code cleanup scope:** (a) rewrite UI only, leave the now-orphaned template/upload/URL routes + `content/policy-templates/` in place for a later cleanup; or (b) rewrite UI **and** delete the dead routes/assets in a follow-up commit this session. *(Recommend: (b), as a separate isolated commit.)*
2. **Required vs Optional:** the design marks **Refunds + Shipping = Required**, Privacy + Terms = Optional. Confirm that's the right required set (matches current `policyIsRequired`). 
3. **Onboarding "blocking":** the design lets merchants "finish later" — i.e. the policies step is **never a hard blocker** to completing onboarding. Confirm.
4. **Ship target:** dev only for review first, or straight through to prod once verified (you've authorized prod releases this session)?

## 7. Rollout
Branch → PR to `develop` → your review → (with approval) promote to `master`. Commits/PRs carry **no Claude attribution** (per the new repo rule).
