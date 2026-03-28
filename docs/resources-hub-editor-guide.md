# Resources Hub — Editor Guide

## Overview

The Resources Hub admin provides a full editorial CMS for managing articles, templates, case studies, and other content across 6 locales. Access it at `/admin/resources`.

### In-admin help (operators)

The full **Admin Guide** lives at **`/admin/help`** (also linked from the Resources Hub sidebar as **Help**). It covers login, platform dashboards, the Resources Hub screens, the block editor, **AI Content Generator** (backlog generation, env vars, editor AI assistant tools), **Autopilot Mode** (cron, burst, warnings), SEO/Indexing, CMS settings, and the workflow state machine. For a printable Markdown version of the same material, see [`docs/admin-guide.md`](admin-guide.md).

**AI generation from backlog:** Use **Backlog** → **Generate** on an archive row (requires `OPENAI_API_KEY` and `GENERATION_ENABLED=true`). See the Admin Guide section *AI Content Generator*.

**Autopilot:** Configure under **Settings** → **AI Autopilot** (master toggle, articles per day, notification email). Autopilot runs the daily generation cron and can publish without manual review—see *Autopilot Mode* in the Admin Guide for risks and behavior.

## Admin Screens

| Screen | Path | Purpose |
|--------|------|---------|
| Dashboard | `/admin/resources` | KPI cards, upcoming scheduled, translation gaps, queue health, recently edited |
| Content List | `/admin/resources/list` | All content with status tabs, search, filters, multi-select |
| Editor | `/admin/resources/content/[id]` | Block editor, locale switching, metadata, validation, publishing |
| Backlog | `/admin/resources/backlog` | Ideas pipeline with priority scoring and convert-to-draft |
| Calendar | `/admin/resources/calendar` | Agenda + grid views of scheduled publications |
| Queue | `/admin/resources/queue` | Publishing queue monitor with retry for failed items |
| Settings | `/admin/resources/settings` | Publishing, translation, workflow, **AI autopilot**, and legal configuration |
| Help | `/admin/help` | Searchable in-app guide (Resources Hub sidebar + top-level Admin nav) |

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

## Workflow Statuses

Content moves through: `idea` → `backlog` → `brief_ready` → `drafting` → `in_translation` → `in_editorial_review` → `in_legal_review` → `approved` → `scheduled` → `published` → `archived`.

Transitions are validated server-side. The editor shows available transitions based on the current status.

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
