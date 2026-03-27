# DisputeDesk Resources Hub — Editor guide

## Prerequisites

- Admin access (`ADMIN_SECRET` login at `/admin/login`).
- Migration `030_resources_hub.sql` applied to Supabase.
- Optional: run `npm run seed:resources` (requires service role in `.env.local`) to load demo content.

## Creating content

1. Open **Admin → Resources** (`/admin/resources`).
2. Content is stored in Supabase tables `content_items` (global) and `content_localizations` (per locale).
3. Phase 1 admin UI for `/admin/resources/content/[id]` is a **JSON inspector** — use Supabase Table Editor for bulk edits until the full block editor ships.

## Localizing content

Supported DB locales: `en-US`, `de-DE`, `fr-FR`, `es-ES`, `pt-PT`, `sv-SE`.

Each `content_localizations` row must have: `title`, `slug`, `excerpt`, `body_json`, `meta_title`, `meta_description`, `og_title`, `og_description` before publish validation passes.

Set `translation_status` to `complete` when a locale is ready.

## Scheduling publishing

1. Insert a row into `content_publish_queue` with `content_localization_id`, `scheduled_for`, `status = pending`.
2. Cron calls `GET /api/cron/publish-content?secret=CRON_SECRET` (or `POST` with `x-cron-secret`).
3. Worker runs `publishLocalization` — validates tags (≥3), author, primary CTA, body, metadata — then sets `is_published` and `workflow_status = published`.

## Converting archive to draft

1. Find a row in `content_archive_items` (Admin → Resources → Archive).
2. Create a new `content_items` row and copy fields; link `created_from_archive_to_content_item_id` on the archive row.

## Publishing failures

- Check **Admin → Resources → Calendar** (queue table) for `last_error` and `attempts`.
- Fix data in `content_localizations` / `content_items`, then re-queue or reset status to `pending`.

## Locale completeness

Launch items should have **all six** locales with `translation_status = complete` before treating the launch as done. The admin JSON view lists all localizations per item.

## Public URLs

- Hub: `/resources` (default), `/sv/resources`, `/de/resources`, etc.
- Article: `/resources/{pillar}/{slug}`.
