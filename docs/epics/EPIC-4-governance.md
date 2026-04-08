# EPIC 4 — Governance Controls and Review Queue

> **Status:** Done
> **Week:** 3–4
> **Dependencies:** EPIC 1, EPIC 2

## Goal

Merchants configure rules controlling whether disputes get auto-packed or routed to a manual review queue. Completeness gates prevent premature actions.

## Implementation

### 4.1 — Rule Evaluator

`lib/rules/evaluateRules.ts` — deterministic rule engine:

- Fetches enabled rules for shop, ordered by priority (ascending).
- Matches each rule against dispute context (reason, status, amount).
- All match conditions are AND-joined; empty match = match all.
- First matching rule wins.
- Default (no match): `{ mode: "review" }`.
- Every rule application is logged as `rule_applied` audit event with rule ID, match conditions, and resulting action.

### 4.2 — Rule Execution on Dispute Sync

`lib/disputes/syncDisputes.ts` — modified to call `evaluateRules()` for each new dispute:

- If result is `auto_pack` → triggers `runAutomationPipeline()`.
- If result is `review` → sets `needs_review = true` on the dispute row.
- Replaces the previous "always automate" behavior with rule-based routing.

### 4.3 — Rules CRUD API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rules?shop_id=` | GET | List all rules for a shop (priority order) |
| `/api/rules` | POST | Create a new rule |
| `/api/rules/:id` | GET | Get a single rule |
| `/api/rules/:id` | PATCH | Update rule (name, match, action, enabled, priority) |
| `/api/rules/:id` | DELETE | Delete a rule (with audit log) |
| `/api/rules/reorder` | POST | Reorder rules (sets priority = index) |
| `/api/disputes/:id/approve` | POST | Approve dispute from review queue (clears `needs_review`, triggers automation, logs `rule_overridden`) |

The disputes list API (`/api/disputes`) now supports `?needs_review=true|false` filter.

### 4.4 — Review Queue UI

Both the Shopify embedded app and the external portal disputes pages now have:

- **Tab switcher**: "All Disputes" / "Review Queue" tabs.
- Review Queue tab filters to `needs_review=true` disputes, sorted by due date.
- **Approve button** on each row in review mode — calls the approve endpoint, clears `needs_review`, and triggers automation pipeline.

### 4.5 — Rules Settings UI

`app/(portal)/portal/rules/page.tsx`:

- Lists all rules with priority order, match summary, action badge (Auto-Pack / Review).
- **Add Rule** form: name, multi-select dispute reasons, optional amount range, action mode toggle.
- **Enable/disable** toggle per rule.
- **Reorder** with up/down arrows (first-match-wins priority).
- **Delete** with audit logging.
- Explanatory text: "First matching rule wins. No match → Review Queue."

### 4.6 — Completeness Gate

Both pack preview pages (embedded + portal) now show a warning banner when `completeness_score < 60`:

- Yellow warning banner: "Missing recommended evidence."
- Lists required checklist items that are not present.
- Guidance only — merchant can proceed. Does not hard-block.

### 4.7 — Schema Migration

`supabase/migrations/011_rules_name.sql` — adds `name` column to the `rules` table.

## Key Files

| File | Purpose |
|------|---------|
| `lib/rules/evaluateRules.ts` | Rule engine — match + evaluate + audit log |
| `lib/disputes/syncDisputes.ts` | Modified: calls evaluateRules before automation |
| `app/api/rules/route.ts` | List + create rules |
| `app/api/rules/[id]/route.ts` | Get + update + delete single rule |
| `app/api/rules/reorder/route.ts` | Reorder rules by priority |
| `app/api/disputes/[id]/approve/route.ts` | Approve from review queue |
| `app/api/disputes/route.ts` | Modified: added `needs_review` filter |
| `app/(embedded)/app/disputes/page.tsx` | List + status filter; **View details** to detail (portal list has Review Queue tab + row Approve) |
| `app/(portal)/portal/disputes/page.tsx` | Modified: review queue tab + approve |
| `app/(portal)/portal/rules/page.tsx` | Rules settings CRUD UI |
| `app/(embedded)/app/packs/[packId]/page.tsx` | Modified: completeness gate banner |
| `app/(portal)/portal/packs/[packId]/page.tsx` | Modified: completeness gate banner |
| `supabase/migrations/011_rules_name.sql` | Add name column to rules |

## Acceptance Criteria

- [x] Rules apply deterministically; same dispute + same rules = same outcome.
- [x] Every rule application logged in `audit_events` with full payload.
- [x] Review queue shows disputes needing review, sorted by due date.
- [x] Completeness gate warns but does not hard-block.
- [x] Rules UI allows CRUD + enable/disable + reorder.
- [x] Override rate trackable from audit events (`rule_overridden` event type).
