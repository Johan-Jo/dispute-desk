# DisputeDesk — Admin Guide

This guide covers every section of the internal admin panel at `/admin`. The panel is protected by a shared secret — only internal operators should have access.

---

## Getting Started

### Login

1. Navigate to `/admin/login`.
2. Enter the admin secret (configured as `ADMIN_SECRET` in your environment).
3. Click **Sign In**. You'll be redirected to the Dashboard.

Your session is stored in a cookie (`dd_admin_session`) and persists across browser tabs.

---

## Dashboard

**Path:** `/admin`

The main dashboard gives you a real-time snapshot of the platform:

| Card | What It Shows |
|------|---------------|
| **Active Shops** | Number of installed shops (with uninstalled count) |
| **Total Disputes** | All disputes across all shops |
| **Evidence Packs** | Total packs generated |
| **Queued Jobs** | Jobs waiting to run (with failed count) |

Below the cards:
- **Plan Distribution** — How many shops are on each plan (Free, Starter, Pro).
- **Pack Status Breakdown** — How many packs are in each status (draft, processing, completed, etc.).

---

## Shops

**Path:** `/admin/shops`

### Shop List

A searchable table of all installed shops. Each row shows:
- Domain
- Plan (Free / Starter / Pro)
- Install date
- Status (Active or Uninstalled)

Use the search bar to filter by domain name.

### Shop Detail

**Path:** `/admin/shops/[id]`

Click any shop domain to see its detail page:

- **Stats:** dispute count, pack count, current plan, install date, status.
- **Admin Overrides:** You can manually change:
  - **Plan** — Override the shop's billing plan.
  - **Pack Limit Override** — Set a custom pack limit (leave blank for plan default).
  - **Admin Notes** — Free-text notes visible only to operators.

Click **Save Overrides** to apply changes.

---

## Job Monitor

**Path:** `/admin/jobs`

Monitor all background jobs (dispute sync, pack builds, PDF rendering, Shopify saves).

### Status Tabs

| Tab | Shows |
|-----|-------|
| All | Every job regardless of status |
| Queued | Jobs waiting to be picked up by the worker |
| Running | Currently processing |
| Failed | Jobs that exhausted all retries |
| Completed | Successfully finished jobs |

### Actions

- **Retry** — Available on failed jobs. Re-queues the job for another attempt.
- **Cancel** — Available on queued or running jobs. Stops the job.

Stale jobs (stuck in "running" for too long) are highlighted with a yellow background.

---

## Billing Dashboard

**Path:** `/admin/billing`

Read-only view of revenue and usage:

- **MRR Card** — Current monthly recurring revenue.
- **Plan Cards** — Active shop count per plan tier.
- **Per-Shop Usage Table** — For the current month:
  - Shop domain, plan, packs used vs. limit.
  - Color-coded usage bar (green = under 50%, yellow = 50-80%, red = over 80%).

---

## Audit Log

**Path:** `/admin/audit`

Every significant action in the system is logged here.

### Filtering

- **Shop ID** — Show events for a specific shop.
- **Event Type** — Filter by event type (e.g., `shop.install`, `pack.built`, `dispute.synced`).

### Features

- **View Payload** — Toggle to see the full JSON payload for any event.
- **Export CSV** — Download the filtered log as a CSV file (opens in a new tab).

---

## Resources Hub (Content Management)

**Path:** `/admin/resources`

The Resources Hub is a full editorial CMS for managing articles, guides, templates, and other public content across 6 locales (English, German, French, Spanish, Portuguese, Swedish).

### Resources Dashboard

**Path:** `/admin/resources`

Your editorial operations center:

| Section | What It Shows |
|---------|---------------|
| **KPI Cards** | Published count, scheduled count, in-review count, drafts count |
| **Upcoming Scheduled** | Next posts about to go live (title, locale, date) |
| **Translation Gaps** | Content missing translations in one or more locales |
| **Queue Health** | Publishing queue status (pending, processing, succeeded, failed) |
| **Recently Edited** | Last-modified content items |

### Content List

**Path:** `/admin/resources/list`

Browse and manage all content:

- **Status Tabs** — Filter by workflow status (All, Drafting, In Review, Scheduled, Published, Archived).
- **Search** — Find content by topic, pillar, or keyword.
- **Filters** — Filter by content type and topic.
- **Multi-select** — Select multiple items for bulk actions.
- **Pagination** — Navigate through large content libraries.

Click any row to open the content in the editor.

### Content Editor

**Path:** `/admin/resources/content/[id]`

The full block-based editor for creating and editing content.

#### Locale Switching

- **Desktop:** Click locale tabs at the top of the editor (each shows a flag and completion percentage).
- **Mobile:** Tap the globe button to open the locale picker as a bottom sheet.

Each locale is independently editable. Changes to one locale don't affect others.

#### Block Types

The editor supports 13 block types:

| Block | Use For |
|-------|---------|
| **Rich HTML** | Existing HTML content, complex formatting |
| **Paragraph** | Plain text paragraphs |
| **Heading** | H2, H3, H4 section headings |
| **List** | Bullet or numbered lists |
| **Callout** | Tips, warnings, important notes |
| **Code** | Code snippets with syntax highlighting |
| **Quote** | Blockquotes with optional citation |
| **Divider** | Visual section separator |
| **Image** | Images with URL, alt text, and caption |
| **Key Takeaways** | Summary bullet points (blue gradient card on public site) |
| **FAQ** | Question/answer pairs (expandable on public site) |
| **Disclaimer** | Legal disclaimer text (red-bordered card) |
| **Update Log** | Article revision history with dates |

#### Working With Blocks

1. Click **Add Content Block** at the bottom of the editor.
2. Choose a block type from the dropdown.
3. Edit the block content directly in the inline editor.
4. **Reorder** blocks with the up/down arrow buttons in the block header.
5. **Remove** a block with the trash icon.

#### Sidebar Panels

The right sidebar contains:

| Panel | Purpose |
|-------|---------|
| **Validation Checklist** | Shows what's required before publishing (English title, excerpt, content, slug, content type). Green checkmarks for completed items. |
| **Workflow Status** | Current status badge with available transition buttons. |
| **Metadata** | Content type, search intent, topic, target keyword, priority, author, reviewer. |
| **SEO** | Meta title (60 char limit), meta description (160 char limit) with live character counts. |
| **AI Assistant** | AI-powered tools (see below). |

#### Saving and Publishing

- **Save Draft** — Saves all changes without changing workflow status.
- **Schedule** — Opens a date/time picker to schedule future publication.
- **Publish** — Moves content to "published" status (available when workflow allows it).

All actions validate against the workflow state machine. Only valid transitions are shown.

#### Mobile Editor

On smaller screens:
- **Tab bar** switches between Content, Metadata, and Checklist views.
- **Bottom action bar** provides Save, Schedule, and Publish buttons.
- **Locale picker** opens as a full-width bottom sheet.

---

## AI Content Generator

The AI generator creates multilingual article drafts from archive/backlog items. It uses OpenAI's GPT-4o model.

### Requirements

The following environment variables must be set:

| Variable | Required | Default |
|----------|----------|---------|
| `OPENAI_API_KEY` | Yes | — |
| `GENERATION_ENABLED` | Yes | `false` |
| `GENERATION_MODEL` | No | `gpt-4o` |

If either `OPENAI_API_KEY` or `GENERATION_ENABLED=true` is missing, generation features are disabled (buttons still visible but return a clear error).

### Generating an Article from the Backlog

1. Navigate to **Backlog** (`/admin/resources/backlog`).
2. Find the archive item you want to generate content from.
3. Click the **Generate** button (purple sparkle icon) on that row.
4. Wait ~15-20 seconds. The system:
   - Reads the archive item metadata (title, keyword, content type, pillar).
   - Calls GPT-4o once per locale (6 calls in parallel).
   - Creates a new `content_items` entry with status `drafting`.
   - Inserts localized content for all 6 locales.
   - Records a revision entry with token usage.
5. You're automatically redirected to the editor with the generated draft.

### What Gets Generated

For each locale, the AI produces:
- **Title** — Localized article title
- **Excerpt** — 1-2 sentence summary (max 300 chars)
- **Slug** — URL-friendly identifier
- **Meta title** — SEO title (max 60 chars)
- **Meta description** — SEO description (max 160 chars)
- **Body content** — Full article with HTML structure, key takeaways, FAQ, and disclaimer

### Content Types and Generation

| Content Type | AI-Generated? | Notes |
|-------------|---------------|-------|
| Cluster Article | Yes | Primary use case, 1500-2500 words |
| Pillar Page | Yes | Comprehensive guide, 3000-5000 words. Extra editorial review recommended. |
| Legal Update | Yes | **Mandatory legal review.** Auto-routed to `in_legal_review` status. |
| Glossary Entry | Yes | Short definitions, 200-400 words |
| FAQ Entry | Yes | 5-8 question/answer pairs |
| Template | No | Manual creation only |
| Case Study | No | Requires real merchant data |

### Per-Locale Writing Style

The AI adapts its output per locale:

| Locale | Language | Style |
|--------|----------|-------|
| en-US | American English | Professional, direct |
| de-DE | German | Formal (Sie-form), technically precise |
| fr-FR | French | Formal (vous-form), regulatory sensitivity |
| es-ES | Spanish | Professional, Latin American awareness |
| pt-BR | Brazilian Portuguese | Professional |
| sv-SE | Swedish | Semi-formal, concise Nordic style |

### Reviewing Generated Content

Generated drafts are **never auto-published**. After generation:

1. The draft appears in the editor with `drafting` status.
2. Review and edit the generated content in each locale.
3. Use the **AI Assistant** (sidebar) to improve specific sections.
4. Move through the editorial workflow: `drafting` → `in_editorial_review` → `approved` → `scheduled` / `published`.

For **legal_update** content, the draft starts in `in_legal_review` status. It must be explicitly approved before publishing.

### AI Writing Assistant

The editor sidebar includes three AI-powered tools:

#### Improve Readability
- Analyzes the current content blocks.
- Returns a simplified, more readable version.
- Click **Apply** to replace the content, or **Dismiss** to discard.

#### Generate Meta Description
- Creates an SEO-optimized meta description (max 160 chars) from the article content.
- Click **Apply** to set it in the SEO panel.

#### Suggest Related Topics
- Recommends 3-5 related article topics based on the current content.
- Useful for planning additional backlog items.

### Cost Awareness

- Each article generation uses ~1,200-1,600 tokens per locale (~8,000-10,000 total for 6 locales).
- Generation only happens on explicit "Generate" clicks — never automatically.
- Token usage is recorded per revision for cost tracking.

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "Generation not enabled" | Set `GENERATION_ENABLED=true` and `OPENAI_API_KEY` in `.env.local` |
| "OpenAI API error 401" | Check that `OPENAI_API_KEY` is valid (starts with `sk-`) |
| Partial locale failures | The system continues with successful locales. Check the response for error details per locale. |
| Generated content quality | Edit the generated draft manually. Use the AI Assistant to improve readability. Add source citations where the AI was too general. |

---

## Backlog (Ideas Pipeline)

**Path:** `/admin/resources/backlog`

Manage content ideas before they become articles.

### Stats Cards

| Card | Shows |
|------|-------|
| Ideas | Items with `idea` status |
| In Backlog | Items with `backlog` status |
| Brief Ready | Items ready for drafting |
| High Priority | Items with priority score ≥ 70 |

### Features

- **Search** by title or keyword.
- **Filters** by priority (High/Medium/Low) and status (Idea/Backlog/Brief Ready).
- **Reorder** items with up/down arrows to adjust priority visually.
- **Generate** — Trigger AI draft generation from this item (see AI Content Generator above).
- **Draft** — Manually convert to a content item for hand-writing.

---

## Publishing Calendar

**Path:** `/admin/resources/calendar`

Visualize your content publishing schedule.

### Views

- **Agenda View** — Chronological list grouped by date. Shows time, title, content type, locale, and status.
- **Calendar View** — Month grid with dots indicating scheduled posts per day.

### Navigation

- Use left/right arrows to navigate between months.
- The header shows total scheduled posts and how many are coming this week.

### Queue Health Panel

Below the calendar, three status cards show:
- System status (Operational / Down)
- Queue size (pending items)
- Publishing cadence

---

## Publishing Queue

**Path:** `/admin/resources/queue`

Monitor the publish queue that processes scheduled content.

### Status Tabs

| Tab | Description |
|-----|-------------|
| All Items | Everything in the queue |
| Pending | Waiting for scheduled time |
| Processing | Currently being published |
| Succeeded | Successfully published |
| Failed | Publication failed (with error details) |

### Per-Item Details

Each queue item shows:
- Title, content type, locale
- Scheduled date/time
- Creation date
- Attempt count
- Error message (for failed items, shown in a red box)

### Actions

- **View** — Open the content in the editor.
- **Retry** — Re-attempt publication for failed items.

---

## Settings

**Path:** `/admin/resources/settings`

Configure CMS behavior. All changes auto-save (debounced 800ms).

### Publishing Settings

| Setting | Description |
|---------|-------------|
| **Default publish time** | UTC time for scheduled posts (e.g., 09:00) |
| **Weekend publishing** | Allow/disallow Saturday and Sunday publishing |
| **Auto-save drafts** | Automatically save editor changes every 30 seconds |

### Translation Settings

| Setting | Description |
|---------|-------------|
| **Skip incomplete translations** | Don't publish localizations that aren't fully translated |
| **Locale priority** | Drag to reorder which locales are prioritized. English is always required. |

### Workflow Settings

| Setting | Description |
|---------|-------------|
| **Require reviewer** | Content must have an assigned reviewer and be approved before publishing |
| **Archive health threshold** | Minimum backlog items before queue health warnings |
| **Default CTA** | Default call-to-action for new articles (None, Free Trial, Demo Request, Newsletter, Download) |

### Legal & Disclaimer

| Setting | Description |
|---------|-------------|
| **Default legal disclaimer** | Auto-applied to new articles unless overridden |
| **Legal review team email** | Email for legal review notifications |

---

## Workflow Reference

Content follows a defined state machine. Only valid transitions are allowed:

```
idea → backlog → brief_ready → drafting → in_translation
                                    ↓
                            in_editorial_review → in_legal_review → approved
                                                                       ↓
                                                              scheduled → published → archived
```

| Status | Meaning |
|--------|---------|
| `idea` | Initial concept, no content yet |
| `backlog` | Accepted idea, waiting for brief |
| `brief_ready` | Brief written, ready for drafting |
| `drafting` | Content being written or generated |
| `in_translation` | English done, translations in progress |
| `in_editorial_review` | Content ready for editor review |
| `in_legal_review` | Requires legal team sign-off (mandatory for legal_update content) |
| `approved` | All reviews passed, ready to schedule |
| `scheduled` | Queued for future publication |
| `published` | Live on the public site |
| `archived` | Removed from public view, preserved for reference |

---

## Autopilot Mode

Autopilot generates and publishes articles automatically without manual approval. Configure in **Settings > AI Autopilot**.

| Setting | Description |
|---------|-------------|
| **Enable autopilot** | Master toggle — when on, the cron job runs daily at 08:00 UTC |
| **Articles per day** | How many articles to generate daily (after initial 5-day burst) |
| **Notification email** | Receive an email with the article link after each publish |

### 5-Day Initial Burst

When first enabled, autopilot publishes 1 article per day for 5 consecutive days. After the burst completes, it continues at the configured rate.

### How It Works

1. Daily cron (`/api/cron/autopilot-generate`) picks the highest-priority backlog item.
2. AI generates content for all 6 locales in parallel.
3. Content is created with `published` status (bypasses editorial and legal review).
4. All localizations are enqueued in the publish queue.
5. The publish cron processes them within 15 minutes.
6. Email notification sent with article link.
7. Search engines notified via IndexNow + Google sitemap ping.

> **Warning:** Autopilot bypasses editorial and legal review. Review generated content regularly to maintain quality.

---

## SEO & Search Engine Indexing

After each article is published, search engines are automatically notified:

| Method | Search Engines | Speed |
|--------|---------------|-------|
| **IndexNow** | Bing, Yandex, Seznam, Naver | Instant (minutes) |
| **Sitemap ping** | Google | Hours to days |

Requires `INDEXNOW_KEY` environment variable (any random 8-128 character string).

### Sitemap

A dynamic sitemap at `/sitemap.xml` lists all published articles with `hreflang` alternates for each locale. It also includes static pages (resources, glossary, templates, case studies).

### Robots.txt

Served at `/robots.txt`. Allows all crawlers on public pages and blocks admin, API, app, portal, and auth routes.

---

## In-Admin Help

The full admin guide is available at `/admin/help` (also accessible via the "Help" link in the admin navigation sidebar). It provides the same content as this document in a searchable, navigable UI with:

- Left sidebar with section links
- Scroll-spy highlighting the current section
- Search/filter to jump to sections

---

## Keyboard Shortcuts & Tips

- **Cmd/Ctrl + S** in the editor area triggers Save Draft (browser form behavior).
- The editor auto-generates a slug from the English title. You can override it manually.
- Locale completeness percentages update in real-time as you fill in fields.
- The validation checklist in the sidebar highlights required items that are still incomplete.
- Toast notifications appear at the bottom-right for all save, publish, and error events.
