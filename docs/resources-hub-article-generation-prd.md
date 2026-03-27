# DisputeDesk Resources Hub — Article Generation Engine (Phase 2 stub)

This document reserves scope for a **future** pipeline that generates drafts from the archive. **Not implemented in phase 1.**

## Goals

- Archive item → structured brief → draft `body_json` per locale.
- Human review and approval before any publish.
- Revision history preserved.

## Placeholders

- **Prompt architecture:** TBD — model routing, system prompts, few-shot examples.
- **Source-of-truth rules:** TBD — cite internal docs, Shopify policies, card-network public docs only.
- **Factuality / review:** Mandatory legal/editorial review for `legal_update` and jurisdiction-scoped content.
- **Multilingual flow:** Generate per `target_locale_set`; no auto-publish without completeness.
- **Tone / style:** Per-locale style guides (formality, terminology).
- **Human approval:** All generated content starts as `drafting` / `in-editorial-review`.
- **Analytics:** Track edit distance, time-to-publish, rejection reasons.

## Integration points

- `content_archive_items` → `content_items` + `content_localizations`.
- `content_revisions` for every save.
- `content_publish_queue` only after approval.
