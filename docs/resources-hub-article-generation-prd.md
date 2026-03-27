# DisputeDesk Resources Hub — Article Generation Pipeline

## Overview

AI-powered pipeline that turns archive items into reviewable, localized drafts. Generated content enters the same editorial workflow as manually created content. **No content is auto-published** — all generated drafts require human approval.

## Architecture

```
content_archive_items  →  Brief Builder  →  Generation Queue
                                                  ↓
                                          AI Model Call (per locale)
                                                  ↓
                                          content_items + content_localizations
                                          (workflow_status = "drafting")
                                                  ↓
                                          Editorial / Legal Review
                                                  ↓
                                          content_publish_queue (existing cron)
```

## Model Configuration

- **Provider:** OpenAI (GPT-4o default, configurable via `GENERATION_MODEL`)
- **API key:** `OPENAI_API_KEY` environment variable
- **Fallback:** Returns graceful error if key not configured
- **Token limits:** ~4000 output tokens per locale; system prompt ~800 tokens
- **Temperature:** 0.4 for factual content, 0.6 for marketing copy

## Prompt Architecture

### System Prompt
Contains:
- DisputeDesk brand voice and expertise positioning
- Content type-specific instructions (pillar page vs cluster article vs template)
- Source-of-truth rules: cite Shopify docs, card network public rules, regulatory references only
- Output format: structured JSON matching `body_json` shape

### Per-Locale Instructions
Each locale has tone/style modifiers:
| Locale | Formality | Notes |
|--------|-----------|-------|
| en-US | Professional, direct | Primary authoring locale |
| de-DE | Formal (Sie-form) | Technical precision |
| fr-FR | Formal (vous-form) | Regulatory sensitivity |
| es-ES | Professional | Latin American awareness |
| pt-BR | Professional | Brazilian Portuguese |
| sv-SE | Semi-formal | Concise Nordic style |

### Output Format
Model returns JSON:
```json
{
  "title": "...",
  "excerpt": "...",
  "slug": "...",
  "meta_title": "...",
  "meta_description": "...",
  "body_json": {
    "mainHtml": "<h2>...</h2><p>...</p>...",
    "keyTakeaways": ["...", "..."],
    "faq": [{"q": "...", "a": "..."}],
    "disclaimer": "..."
  }
}
```

## Eligible Content Types

| Type | Auto-generation | Notes |
|------|----------------|-------|
| `cluster_article` | Yes | Primary use case |
| `pillar_page` | Yes (with review) | Long-form, requires extra editorial review |
| `template` | No | Manual creation only |
| `case_study` | No | Requires real merchant data |
| `legal_update` | Yes | **Mandatory legal review** |
| `glossary_entry` | Yes | Short definitions |
| `faq_entry` | Yes | Q&A pairs |

## Generation Flow

1. **Trigger:** Admin clicks "Generate Draft" from backlog or archive item.
2. **Brief creation:** System builds structured brief from archive item metadata.
3. **Queue entry:** Generation request enqueued with status `pending`.
4. **Processing:** API route picks up request, calls AI model per locale.
5. **Draft creation:** New `content_items` row with `workflow_status = "drafting"`, linked back to archive item via `created_from_archive_to_content_item_id`.
6. **Localization:** `content_localizations` rows created per target locale.
7. **Revision:** Initial generation recorded in `content_revisions`.
8. **Review routing:** `legal_update` content auto-transitions to `in_legal_review`; others stay as `drafting`.

## Review Requirements

- All generated content: editorial review required
- `legal_update` type: legal review mandatory (auto-routed to `in_legal_review`)
- Jurisdiction-scoped content: legal review mandatory
- Legal review team notified via configured email (from CMS settings)

## AI Writing Assistant (Editor Panel)

In-editor AI tools accessible from sidebar:
- **Improve readability:** Simplify complex sentences, improve flow
- **Generate meta description:** Create SEO-optimized meta description from content
- **Suggest related topics:** Recommend related articles from existing content

## Analytics

- Edit distance between AI-generated and final published version
- Rejection reasons (tracked in revision notes)
- Time from generation to publish
- Generation cost per article (token usage)

## Environment Variables

```
OPENAI_API_KEY=sk-...              # Required for generation
GENERATION_MODEL=gpt-4o            # Optional, defaults to gpt-4o
GENERATION_ENABLED=true            # Feature flag, defaults to false
```

## Integration Points

- `content_archive_items` → source material and metadata
- `content_items` + `content_localizations` → output destination
- `content_revisions` → generation history
- `content_publish_queue` → publish after approval (existing cron)
- CMS settings → legal review email, reviewer requirements
