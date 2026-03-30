# Resources Hub — Editor Guide

## Overview

The Resources Hub admin provides a full editorial CMS for managing articles, templates, case studies, and other content across 6 locales. Access it at `/admin/resources`.

### In-admin help (operators)

The full **Admin Guide** lives at **`/admin/help`** (also linked from the Resources Hub sidebar as **Help**). That page uses the main Admin navigation shell; the guide itself uses a sticky filter bar and horizontal section pills instead of a second sidebar. It covers login, platform dashboards, the Resources Hub screens, the block editor, **AI Content Generator** (backlog generation, env vars, editor AI assistant tools), **Autopilot Mode** (cron, burst, warnings), SEO/Indexing, CMS settings, and the workflow state machine. For a printable Markdown version of the same material, see [`docs/admin-guide.md`](admin-guide.md).

**AI generation from backlog:** Use **Backlog** → **Generate** on an archive row (requires `OPENAI_API_KEY` and `GENERATION_ENABLED=true`). Target article length comes from archive **`page_role`**, **`complexity`**, **search intent**, and optional **`target_word_range`** (see **`docs/technical.md`** CH-7). See the Admin Guide section *AI Content Generator*.

**Autopilot:** Configure under **Settings** → **AI Autopilot** (master toggle, articles per day, notification email) and **Workflow** → **Default CTA** (must match a `content_ctas` row, e.g. Free Trial → `free_trial`). Production also needs `CRON_SECRET` on Vercel and `RESEND_API_KEY` for email. See *Autopilot Mode* in the Admin Guide for prerequisites, schedule (08:00 / 09:00 UTC), and manual cron tests.

## Public article pages (readers)

Published items appear on the marketing site (for example `/resources/{pillar}/{slug}` and locale-prefixed paths such as `/sv/resources/...`). The sticky bar on each article has **Back to resources** and **Share** (native share where available, otherwise copy link). There is no DisputeDesk “saved articles” library or account-backed reading list for visitors; keeping a link is via the browser, **Share**, or bookmarks outside the app.

## Admin Screens

| Screen | Path | Purpose |
|--------|------|---------|
| Dashboard | `/admin/resources` | KPI cards, upcoming scheduled, translation gaps, queue health, recently edited |
| Content List | `/admin/resources/list` | All content with status tabs, search, filters, multi-select; **Reset & rebuild** on selected rows (AI-generated only) archives items, clears publish queue, and returns linked archive topics to backlog — then run autopilot in Settings to regenerate |
| Editor | `/admin/resources/content/[id]` | Block editor, locale switching, metadata (**Article language** → `source_locale`), validation, publishing |
| Backlog | `/admin/resources/backlog` | Ideas pipeline: Brief column, drag-to-reorder queue (saved order + priority for autopilot), clear backlog, **Generate** (AI) |
| Calendar | `/admin/resources/calendar` | Agenda + grid views of scheduled publications |
| Queue | `/admin/resources/queue` | Publishing queue monitor with retry for failed items |
| Settings | `/admin/resources/settings` | Publishing, translation, workflow, **AI autopilot**, and legal configuration |
| Help | `/admin/help` | Searchable in-app guide (linked from Resources Hub sidebar and top-level Admin nav; page uses Admin shell + sticky section nav) |

## Block Editor

The content editor uses a custom block system. Content is stored in `content_localizations.body_json` as `{ mainHtml, keyTakeaways, faq, disclaimer, updateLog }`.

### Available Block Types

| Block | Purpose |
|-------|---------|
| Rich HTML | Legacy HTML content (migrated from existing articles) |
| Paragraph | Plain text paragraph |
| Heading | H2/H3/H4 section headings |
| List | Bullet or numbered lists |
| Callout | Important notes, tips, warnings |
| Code | Code snippets with language tag |
| Quote | Blockquotes with optional citation |
| Divider | Horizontal rule separator |
| Image | Image with URL, alt text, caption |
| Key Takeaways | Bullet points rendered in the blue gradient card |
| FAQ | Question/answer pairs |
| Disclaimer | Legal disclaimer text (red left-border card) |
| Update Log | Article revision history entries |

### Editing Workflow

1. **Navigate** to Content List → click title or Edit.
2. **Switch locale** using the tabs (desktop) or globe button (mobile).
3. **Edit fields**: title, slug (auto-generated), excerpt, content blocks.
4. **Add blocks** using the "Add Content Block" button.
5. **Reorder** blocks with up/down arrows.
6. **Check sidebar**: validation checklist, workflow status, metadata, SEO, **AI Assistant** (readability, meta, related topics — see Admin Guide at `/admin/help`).
7. **Save Draft** to persist without publishing.
8. **Schedule** or **Publish** when ready.

### Locale Completeness

Each locale shows a completion percentage based on:
- Title filled
- Excerpt filled
- Content present (body_json non-empty)
- Slug set

### Publishing Requirements

The validation checklist must be satisfied before publishing:
- English title (required)
- English excerpt (required)
- English content (required)
- Slug set (required)
- Content type set (required)
- Author assigned (optional)
- Meta title (optional)
- Meta description (optional)

### Internal links inside article body

When adding links to other Resources articles, use canonical URLs in this format:
- English: `/resources/{pillar}/{slug}`
- Other locales: `/{locale}/resources/{pillar}/{slug}`

Avoid root-slug links like `https://disputedesk.app/{slug}` — they are non-canonical and can break navigation.

### Missing read time on cards

If older/newly generated rows show no read-time label, call `POST /api/admin/resources/reading-time-backfill` (admin session) to compute `reading_time_minutes` from each localization HTML body where the field is currently null. There is no Settings UI for this; use your API client or curl against the deployed app.

## Workflow Statuses

Content moves through: `idea` → `backlog` → `brief_ready` → `drafting` → `in_translation` → `in_editorial_review` → `in_legal_review` → `approved` → `scheduled` → `published` → `archived`.

Transitions are validated server-side. The editor shows available transitions based on the current status.

### Publish troubleshooting (important)

If Content List shows **Published** but the **Published** date is `—` and the article is missing from the public hub:
- Go to **Settings** and click **Repair stuck publishes**.
- Go to **Queue**, click **Retry** on failed rows, then run **Process publish queue now**.
- Recheck the content row: a real publish sets `published_at`; only then will the article appear on public pages.

## Settings

Settings auto-save as you edit. Configuration options:
- **Publishing**: default publish time (UTC), weekend publishing, auto-save drafts.
- **Translation**: skip incomplete translations, locale priority order.
- **Workflow**: require reviewer, archive health threshold, default CTA.
- **AI Autopilot**: enable/disable automatic generate-and-publish, articles per day, notification email (see Admin Guide).
- **Legal**: default disclaimer text, legal review team email.

## Mobile Editor

On screens below `lg` breakpoint:
- Tab bar switches between Content, Metadata, and Checklist views.
- Locale picker opens as a bottom sheet modal.
- Bottom action bar provides Save, Schedule, and Publish buttons.
- Block reordering available via up/down buttons (drag disabled on mobile).
