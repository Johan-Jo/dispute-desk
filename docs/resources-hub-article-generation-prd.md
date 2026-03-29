# DisputeDesk Resources Hub — Article Generation Pipeline

## Overview

AI-powered pipeline that turns archive items into reviewable, localized drafts. Generated content enters the same editorial workflow as manually created content. **Manual “Generate”** produces drafts (`drafting` / `in-legal-review` for legal updates — values match `content_items.workflow_status` / `lib/resources/workflow.ts`). **Autopilot** (when enabled in CMS + cron) may create items as **published** and enqueue the publish pipeline — see `docs/technical.md` (Resources Hub autopilot).

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
- **Token limits:** ~4000 output tokens per locale; larger system + user prompts (SEO + anti-repetition + optional peer list)
- **Temperature:** `0.3` for `legal_update`, `0.4` for other content types (see `lib/resources/generation/generate.ts`)

## Prompt Architecture

### System Prompt
Contains (built-in default in `lib/resources/generation/prompts.ts`; overridable via CMS `generationSystemPrompt`):
- B2B ecommerce / chargeback operations positioning, SEO and conversion guidance, originality rules
- Instruction to treat **similar published articles** (injected in the user prompt) as duplication constraints
- Output format: structured JSON matching `body_json` shape (`title`, `meta_title`, etc.)

### User message — similar published articles
Before each generation, the pipeline loads **up to ~10 published** localizations (same locale and `route_kind`, scored by content type / pillar / keyword / title overlap) and adds a compact **“Existing DisputeDesk articles with topical overlap”** block (title, slug, excerpt, headings, intro snippet). This is required for meaningful deduplication; system-prompt-only guidance is not enough.

### Default user suffix (anti-repetition)
When `generationUserPromptSuffix` is **omitted** from `cms_settings.settings_json`, a long built-in **Originality and anti-repetition** block is appended. If the key is present as an empty string, that block is skipped (advanced override).

### Post-generation similarity guard
After each locale response: reject if slug already exists for that locale+route, or if title / title+excerpt is too close to peers (word Jaccard thresholds in `similarity.ts`). **One automatic retry** with a stronger instruction; if the second output still fails, the pipeline errors and does **not** create a `content_items` row for that run.

### Archive idempotency
If `content_archive_items.created_from_archive_to_content_item_id` is already set, `runGenerationPipeline` returns an error immediately (prevents duplicate drafts from concurrent or duplicate “Generate” clicks).

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

1. **Trigger:** Admin clicks "Generate Draft" from backlog or archive item (or autopilot cron).
2. **Idempotency check:** If archive row already has `created_from_archive_to_content_item_id`, abort with error (linked id returned for diagnostics).
3. **Brief creation:** System builds structured brief from archive item metadata.
4. **Similar peers:** For each target locale, fetch similar published articles; pass into `buildUserPrompt`.
5. **Processing:** API calls OpenAI once per locale (plus up to **one extra call per locale** if similarity guard fails the first time).
6. **Draft creation:** New `content_items` row with `workflow_status = "drafting"` (or `in_legal_review` / `published` per mode), linked back to archive item via `created_from_archive_to_content_item_id`.
7. **Localization:** `content_localizations` rows created per successful locale.
8. **Revision:** Initial generation recorded in `content_revisions` (token usage includes retries).
9. **Review routing:** `legal_update` content auto-transitions to `in_legal_review`; others stay as `drafting` (manual generate). Autopilot uses published + publish queue per existing cron.

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
